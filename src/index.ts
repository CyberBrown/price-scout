import { Env, TrackedProduct } from './types';
import { handleApiRequest } from './api';
import { scrapeGoogleShopping } from './scraper';
import { getActiveProducts, storeSnapshots } from './db';

async function runScrape(env: Env, products?: TrackedProduct[]): Promise<{ success: number; fail: number; details: any[] }> {
  const toScrape = products || await getActiveProducts(env);
  let success = 0;
  let fail = 0;
  const details: any[] = [];

  for (const product of toScrape) {
    try {
      const results = await scrapeGoogleShopping(env, product);
      if (results.length > 0) {
        await storeSnapshots(env, product, results);
        success++;
        details.push({ sku: product.sku, status: 'ok', count: results.length, sample: results.slice(0, 3) });
      } else {
        fail++;
        details.push({ sku: product.sku, status: 'no_results' });
      }
      // Small delay between API calls
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      fail++;
      details.push({ sku: product.sku, status: 'error', error: err.message });
    }
  }

  return { success, fail, details };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        service: 'price-scout', status: 'ok', timestamp: new Date().toISOString()
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Manual scrape — all products
    if (url.pathname === '/api/scrape' && request.method === 'POST') {
      const result = await runScrape(env);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Manual scrape — single product
    if (url.pathname.match(/^\/api\/scrape\/\d+$/) && request.method === 'POST') {
      const id = parseInt(url.pathname.split('/').pop()!);
      const product = await env.DB.prepare('SELECT * FROM tracked_products WHERE id = ?')
        .bind(id).first<TrackedProduct>();
      if (!product) {
        return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404 });
      }
      const result = await runScrape(env, [product]);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const result = await runScrape(env);
    console.log(`[price-scout] Cron: ${result.success} ok, ${result.fail} failed`);
  }
};
