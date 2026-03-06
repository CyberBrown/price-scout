import { Env } from './types';

/**
 * REST API router for the admin dashboard
 */
export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers for solampio admin
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

    // --- Products ---
    if (path === '/api/products' && request.method === 'GET') {
      response = await getProducts(env);
    } else if (path === '/api/products' && request.method === 'POST') {
      response = await addProduct(request, env);
    } else if (path.match(/^\/api\/products\/\d+$/) && request.method === 'PUT') {
      const id = parseInt(path.split('/').pop()!);
      response = await updateProduct(id, request, env);
    } else if (path.match(/^\/api\/products\/\d+$/) && request.method === 'DELETE') {
      const id = parseInt(path.split('/').pop()!);
      response = await deleteProduct(id, env);

    // --- Snapshots / Pricing Data ---
    } else if (path.match(/^\/api\/products\/\d+\/prices$/) && request.method === 'GET') {
      const id = parseInt(path.split('/')[3]);
      const days = parseInt(url.searchParams.get('days') || '30');
      response = await getProductPrices(id, days, env);

    // --- Alerts ---
    } else if (path === '/api/alerts' && request.method === 'GET') {
      const unackOnly = url.searchParams.get('unacknowledged') === 'true';
      response = await getAlerts(unackOnly, env);
    } else if (path.match(/^\/api\/alerts\/\d+\/ack$/) && request.method === 'POST') {
      const id = parseInt(path.split('/')[3]);
      response = await acknowledgeAlert(id, env);

    // --- Dashboard Summary ---
    } else if (path === '/api/dashboard' && request.method === 'GET') {
      response = await getDashboardSummary(env);

    // --- Manual Trigger ---
    } else if (path === '/api/scrape' && request.method === 'POST') {
      // Trigger a manual scrape run
      return new Response(JSON.stringify({ message: 'Use cron trigger or call /api/scrape/:productId' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else {
      response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    // Add CORS headers to all responses
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

async function getProducts(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM tracked_products ORDER BY created_at DESC'
  ).all();
  return json(results);
}

async function addProduct(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const { sku, name, search_query, our_price, alert_threshold } = body;

  if (!sku || !name || !search_query) {
    return json({ error: 'sku, name, and search_query are required' }, 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO tracked_products (sku, name, search_query, our_price, alert_threshold)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(sku, name, search_query, our_price || null, alert_threshold || null).run();

  return json({ id: result.meta.last_row_id, message: 'Product added' }, 201);
}

async function updateProduct(id: number, request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  const { sku, name, search_query, our_price, alert_threshold, active } = body;

  await env.DB.prepare(
    `UPDATE tracked_products SET sku = ?, name = ?, search_query = ?, our_price = ?, alert_threshold = ?, active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(sku, name, search_query, our_price || null, alert_threshold || null, active ?? 1, id).run();

  return json({ message: 'Product updated' });
}

async function deleteProduct(id: number, env: Env): Promise<Response> {
  await env.DB.prepare('DELETE FROM tracked_products WHERE id = ?').bind(id).run();
  return json({ message: 'Product deleted' });
}

async function getProductPrices(productId: number, days: number, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM price_snapshots
     WHERE product_id = ? AND scraped_at >= datetime('now', '-' || ? || ' days')
     ORDER BY scraped_at DESC`
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
  const [products, unackAlerts, recentSnapshots] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM tracked_products WHERE active = 1').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM alerts WHERE acknowledged = 0').first<{ count: number }>(),
    env.DB.prepare(
      `SELECT p.name, p.sku, s.price, s.seller, s.scraped_at
       FROM price_snapshots s JOIN tracked_products p ON s.product_id = p.id
       ORDER BY s.scraped_at DESC LIMIT 20`
    ).all()
  ]);

  return json({
    tracked_products: products?.count || 0,
    unacknowledged_alerts: unackAlerts?.count || 0,
    recent_prices: recentSnapshots.results || []
  });
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
