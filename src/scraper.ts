import { Env, TrackedProduct, GoogleShoppingResult } from './types';

const SERPER_API = 'https://google.serper.dev/shopping';

/**
 * Scrape Google Shopping via Serper.dev API
 * Free tier: 2,500 searches/month (we need ~210/month for 7 products daily)
 */
export async function scrapeGoogleShopping(
  env: Env,
  product: TrackedProduct
): Promise<GoogleShoppingResult[]> {
  try {
    const response = await fetch(SERPER_API, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: product.search_query,
        gl: 'us',
        hl: 'en',
        num: 20
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.log('[price-scout] Serper API error ' + response.status + ': ' + errText.substring(0, 200));
      return [];
    }

    const data = await response.json() as any;
    const shopping = data.shopping || [];

    return shopping.map(function(item: any) {
      return {
        title: item.title || 'Unknown',
        price: typeof item.price === 'number' ? item.price : parsePrice(item.price),
        currency: 'USD',
        seller: item.source || item.merchant || 'Unknown',
        url: item.link || '',
        shipping: item.delivery || item.shipping || undefined
      };
    }).filter(function(r: GoogleShoppingResult) { return r.price > 0; });

  } catch (err) {
    console.error('[price-scout] Scrape failed for "' + product.search_query + '":', err);
    return [];
  }
}

function parsePrice(priceStr: any): number {
  if (typeof priceStr === 'number') return priceStr;
  if (typeof priceStr !== 'string') return 0;
  const match = priceStr.match(/([\d,]+\.?\d*)/);
  if (!match) return 0;
  return parseFloat(match[1].replace(/,/g, ''));
}
