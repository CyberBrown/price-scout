import { Env } from './types';

const INSERT_PRODUCT_SQL = 'INSERT OR IGNORE INTO tracked_products (sku, name, search_query, our_price, active) VALUES (?, ?, ?, ?, ?)';

/**
 * REST API router for the admin dashboard
 */
export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let response: Response;

    if (path === '/api/products' && request.method === 'GET') {
      const activeOnly = url.searchParams.get('active') === 'true';
      response = await getProducts(env, activeOnly);
    } else if (path === '/api/products' && request.method === 'POST') {
      response = await addProduct(request, env);
    } else if (path === '/api/products/bulk' && request.method === 'POST') {
      response = await bulkImport(request, env);
    } else if (path === '/api/products/activate' && request.method === 'POST') {
      response = await activateProducts(request, env);
    } else if (path === '/api/products/with-prices' && request.method === 'GET') {
      response = await getProductsWithPrices(env, url);
    } else if (path.match(/^\/api\/products\/\d+$/) && request.method === 'PUT') {
      const id = parseInt(path.split('/').pop()!);
      response = await updateProduct(id, request, env);
    } else if (path.match(/^\/api\/products\/\d+$/) && request.method === 'DELETE') {
      const id = parseInt(path.split('/').pop()!);
      response = await deleteProduct(id, env);
    } else if (path.match(/^\/api\/products\/\d+\/prices$/) && request.method === 'GET') {
      const id = parseInt(path.split('/')[3]);
      const days = parseInt(url.searchParams.get('days') || '30');
      response = await getProductPrices(id, days, env);
    } else if (path === '/api/alerts' && request.method === 'GET') {
      const unackOnly = url.searchParams.get('unacknowledged') === 'true';
      response = await getAlerts(unackOnly, env);
    } else if (path.match(/^\/api\/alerts\/\d+\/ack$/) && request.method === 'POST') {
      const id = parseInt(path.split('/')[3]);
      response = await acknowledgeAlert(id, env);
    } else if (path === '/api/dashboard' && request.method === 'GET') {
      response = await getDashboardSummary(env);
    } else if (path === '/api/stats' && request.method === 'GET') {
      response = await getStats(env);
    } else {
      response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(response.body, { status: response.status, headers: newHeaders });

  } catch (err: any) {
    console.error('[price-scout] API error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// --- Handlers ---

async function getProducts(env: Env, activeOnly: boolean = false): Promise<Response> {
  const sql = activeOnly
    ? 'SELECT * FROM tracked_products WHERE active = 1 ORDER BY name'
    : 'SELECT * FROM tracked_products ORDER BY name';
  const { results } = await env.DB.prepare(sql).all();
  return json(results);
}

async function addProduct(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const { sku, name, search_query, our_price, alert_threshold } = body;
  if (!sku || !name || !search_query) {
    return json({ error: 'sku, name, and search_query are required' }, 400);
  }
  const result = await env.DB.prepare(
    'INSERT INTO tracked_products (sku, name, search_query, our_price, alert_threshold) VALUES (?, ?, ?, ?, ?)'
  ).bind(sku, name, search_query, our_price || null, alert_threshold || null).run();
  return json({ id: result.meta.last_row_id, message: 'Product added' }, 201);
}

async function bulkImport(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const products = Array.isArray(body) ? body : (body.products || []);
  if (!Array.isArray(products) || products.length === 0) {
    return json({ error: 'Expected array of products' }, 400);
  }

  let imported = 0;
  let skipped = 0;

  // Process in batches of 40 (D1 batch limit)
  for (let i = 0; i < products.length; i += 40) {
    const batch = products.slice(i, i + 40);
    const stmts: D1PreparedStatement[] = [];
    for (const p of batch) {
      if (!p.sku || !p.name) { skipped++; continue; }
      stmts.push(
        env.DB.prepare(INSERT_PRODUCT_SQL).bind(
          p.sku,
          p.name,
          p.search_query || (p.name + ' price'),
          p.our_price || null,
          p.active !== undefined ? (p.active ? 1 : 0) : 0
        )
      );
    }
    if (stmts.length > 0) {
      const results = await env.DB.batch(stmts);
      for (const r of results) {
        if (r.meta.changes > 0) imported++;
        else skipped++;
      }
    }
  }

  return json({ imported, skipped, total: products.length }, 201);
}

async function activateProducts(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  // Activate by SKU list, or by price threshold, or activate all
  if (body.skus && Array.isArray(body.skus)) {
    const placeholders = body.skus.map(() => '?').join(',');
    await env.DB.prepare(
      'UPDATE tracked_products SET active = 1, updated_at = datetime(\'now\') WHERE sku IN (' + placeholders + ')'
    ).bind(...body.skus).run();
    return json({ message: 'Activated ' + body.skus.length + ' products by SKU' });
  }
  if (body.min_price) {
    const result = await env.DB.prepare(
      'UPDATE tracked_products SET active = 1, updated_at = datetime(\'now\') WHERE our_price >= ?'
    ).bind(body.min_price).run();
    return json({ message: 'Activated products with price >= $' + body.min_price, count: result.meta.changes });
  }
  if (body.all === true) {
    const result = await env.DB.prepare(
      'UPDATE tracked_products SET active = 1, updated_at = datetime(\'now\')'
    ).run();
    return json({ message: 'Activated all products', count: result.meta.changes });
  }
  return json({ error: 'Provide skus[], min_price, or all:true' }, 400);
}

async function updateProduct(id: number, request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const { sku, name, search_query, our_price, alert_threshold, active } = body;
  await env.DB.prepare(
    'UPDATE tracked_products SET sku = ?, name = ?, search_query = ?, our_price = ?, alert_threshold = ?, active = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(sku, name, search_query, our_price || null, alert_threshold || null, active ?? 1, id).run();
  return json({ message: 'Product updated' });
}

async function deleteProduct(id: number, env: Env): Promise<Response> {
  await env.DB.prepare('DELETE FROM tracked_products WHERE id = ?').bind(id).run();
  return json({ message: 'Product deleted' });
}

async function getProductPrices(productId: number, days: number, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM price_snapshots WHERE product_id = ? AND scraped_at >= datetime(\'now\', \'-\' || ? || \' days\') ORDER BY scraped_at DESC'
  ).bind(productId, days).all();
  return json(results);
}

async function getAlerts(unackOnly: boolean, env: Env): Promise<Response> {
  const query = unackOnly
    ? 'SELECT a.*, p.name as product_name, p.sku FROM alerts a JOIN tracked_products p ON a.product_id = p.id WHERE a.acknowledged = 0 ORDER BY a.created_at DESC'
    : 'SELECT a.*, p.name as product_name, p.sku FROM alerts a JOIN tracked_products p ON a.product_id = p.id ORDER BY a.created_at DESC LIMIT 100';
  const { results } = await env.DB.prepare(query).all();
  return json(results);
}

async function acknowledgeAlert(id: number, env: Env): Promise<Response> {
  await env.DB.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').bind(id).run();
  return json({ message: 'Alert acknowledged' });
}

async function getDashboardSummary(env: Env): Promise<Response> {
  const [active, total, unackAlerts, recentSnapshots] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM tracked_products WHERE active = 1').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM tracked_products').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0').first<{ count: number }>(),
    env.DB.prepare(
      'SELECT p.name, p.sku, s.price, s.seller, s.scraped_at FROM price_snapshots s JOIN tracked_products p ON s.product_id = p.id ORDER BY s.scraped_at DESC LIMIT 20'
    ).all()
  ]);

  return json({
    tracked_products: active?.count || 0,
    total_products: total?.count || 0,
    unacknowledged_alerts: unackAlerts?.count || 0,
    recent_prices: recentSnapshots.results || []
  });
}

async function getStats(env: Env): Promise<Response> {
  const [total, active, withPrice, snapshotCount] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as c FROM tracked_products').first<{c:number}>(),
    env.DB.prepare('SELECT COUNT(*) as c FROM tracked_products WHERE active = 1').first<{c:number}>(),
    env.DB.prepare('SELECT COUNT(*) as c FROM tracked_products WHERE our_price IS NOT NULL').first<{c:number}>(),
    env.DB.prepare('SELECT COUNT(*) as c FROM price_snapshots').first<{c:number}>(),
  ]);
  return json({
    total_products: total?.c || 0,
    active_products: active?.c || 0,
    products_with_price: withPrice?.c || 0,
    total_snapshots: snapshotCount?.c || 0,
  });
}


async function getProductsWithPrices(env: Env, url: URL): Promise<Response> {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  // Get products that have price snapshots, with min/max/avg competitor prices
  const { results } = await env.DB.prepare(
    `SELECT
      p.id, p.sku, p.name, p.our_price, p.active,
      COUNT(DISTINCT s.seller) as seller_count,
      COUNT(s.id) as snapshot_count,
      MIN(s.price) as min_price,
      MAX(s.price) as max_price,
      ROUND(AVG(s.price), 2) as avg_price,
      MAX(s.scraped_at) as last_scraped
    FROM tracked_products p
    INNER JOIN price_snapshots s ON s.product_id = p.id
    WHERE p.active = 1
    GROUP BY p.id
    ORDER BY p.our_price DESC NULLS LAST
    LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  // For each product, get the top sellers (lowest prices)
  const enriched = [];
  for (const prod of (results || [])) {
    const { results: sellers } = await env.DB.prepare(
      `SELECT seller, MIN(price) as price, url
       FROM price_snapshots
       WHERE product_id = ?
       GROUP BY seller
       ORDER BY price ASC
       LIMIT 10`
    ).bind(prod.id).all();

    enriched.push({
      ...prod,
      sellers: sellers || []
    });
  }

  // Total count for pagination
  const total = await env.DB.prepare(
    `SELECT COUNT(DISTINCT p.id) as c
     FROM tracked_products p
     INNER JOIN price_snapshots s ON s.product_id = p.id
     WHERE p.active = 1`
  ).first<{c: number}>();

  return json({
    products: enriched,
    total: total?.c || 0,
    limit,
    offset
  });
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
