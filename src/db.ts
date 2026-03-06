import { Env, TrackedProduct, GoogleShoppingResult, PriceSnapshot, Alert } from './types';

/**
 * Store price snapshots and generate alerts
 */
export async function storeSnapshots(
  env: Env,
  product: TrackedProduct,
  results: GoogleShoppingResult[]
): Promise<void> {
  const batch: D1PreparedStatement[] = [];

  for (const result of results) {
    batch.push(
      env.DB.prepare(
        `INSERT INTO price_snapshots (product_id, seller, price, currency, url, shipping_info, source, raw_data, scraped_at)
         VALUES (?, ?, ?, ?, ?, ?, 'google_shopping', ?, datetime('now'))`
      ).bind(
        product.id,
        result.seller,
        result.price,
        result.currency || 'USD',
        result.url,
        result.shipping || null,
        JSON.stringify(result)
      )
    );
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  // Check for alerts
  await checkAlerts(env, product, results);
}

/**
 * Check if any results should trigger alerts
 */
async function checkAlerts(
  env: Env,
  product: TrackedProduct,
  results: GoogleShoppingResult[]
): Promise<void> {
  if (!product.our_price && !product.alert_threshold) return;

  for (const result of results) {
    // Alert: competitor undercuts our price
    if (product.our_price && result.price < product.our_price) {
      const diff = product.our_price - result.price;
      const pctDiff = ((diff / product.our_price) * 100).toFixed(1);

      // Get the snapshot ID we just inserted
      const snapshot = await env.DB.prepare(
        `SELECT id FROM price_snapshots WHERE product_id = ? ORDER BY id DESC LIMIT 1`
      ).bind(product.id).first<{ id: number }>();

      if (snapshot) {
        await env.DB.prepare(
          `INSERT INTO alerts (product_id, snapshot_id, alert_type, message, created_at)
           VALUES (?, ?, 'undercut', ?, datetime('now'))`
        ).bind(
          product.id,
          snapshot.id,
          `${result.seller} selling "${product.name}" at $${result.price} — $${diff.toFixed(2)} (${pctDiff}%) below our price of $${product.our_price}`
        ).run();
      }
    }

    // Alert: price below threshold
    if (product.alert_threshold && result.price < product.alert_threshold) {
      const snapshot = await env.DB.prepare(
        `SELECT id FROM price_snapshots WHERE product_id = ? ORDER BY id DESC LIMIT 1`
      ).bind(product.id).first<{ id: number }>();

      if (snapshot) {
        await env.DB.prepare(
          `INSERT INTO alerts (product_id, snapshot_id, alert_type, message, created_at)
           VALUES (?, ?, 'price_drop', ?, datetime('now'))`
        ).bind(
          product.id,
          snapshot.id,
          `"${product.name}" at $${result.price} from ${result.seller} — below alert threshold of $${product.alert_threshold}`
        ).run();
      }
    }
  }
}

/**
 * Get all active tracked products
 */
export async function getActiveProducts(env: Env): Promise<TrackedProduct[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM tracked_products WHERE active = 1'
  ).all<TrackedProduct>();
  return results || [];
}
