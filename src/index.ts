import { Env } from './types';
import { handleApiRequest } from './api';
import { scrapeGoogleShopping } from './scraper';
import { getActiveProducts, storeSnapshots } from './db';

export default {
  /**
   * HTTP handler — serves the REST API for the admin dashboard
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        service: 'price-scout',
        status: 'ok',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }

    return new Response('Not found', { status: 404 });
  },

  /**
   * Cron handler — daily scraping run
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[price-scout] Cron triggered at ${new Date().toISOString()}`);

    const products = await getActiveProducts(env);
    console.log(`[price-scout] Found ${products.length} active products to scrape`);

    let successCount = 0;
    let failCount = 0;

    for (const product of products) {
      try {
        console.log(`[price-scout] Scraping: "${product.search_query}" (SKU: ${product.sku})`);
        const results = await scrapeGoogleShopping(env, product);

        if (results.length > 0) {
          await storeSnapshots(env, product, results);
          successCount++;
          console.log(`[price-scout] ✓ ${product.sku}: ${results.length} results stored`);
        } else {
          failCount++;
          console.log(`[price-scout] ✗ ${product.sku}: no results`);
        }

        // Small delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        failCount++;
        console.error(`[price-scout] Error scraping ${product.sku}:`, err);
      }
    }

    console.log(`[price-scout] Cron complete: ${successCount} success, ${failCount} failed`);
  }
};
