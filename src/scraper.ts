import { Env, TrackedProduct, GoogleShoppingResult } from './types';

const GOOGLE_SHOPPING_BASE = 'https://www.google.com/search?tbm=shop&q=';

/**
 * Scrape Google Shopping using CF Browser Rendering REST API /json endpoint.
 * Falls back to /screenshot if structured extraction fails.
 */
export async function scrapeGoogleShopping(
  env: Env,
  product: TrackedProduct
): Promise<GoogleShoppingResult[]> {
  const searchUrl = `${GOOGLE_SHOPPING_BASE}${encodeURIComponent(product.search_query)}`;

  try {
    // Attempt 1: Use /json endpoint for structured extraction
    const results = await extractWithJson(env, searchUrl, product);
    if (results.length > 0) return results;

    // Attempt 2: Use /markdown endpoint and parse
    const markdownResults = await extractWithMarkdown(env, searchUrl, product);
    if (markdownResults.length > 0) return markdownResults;

    console.log(`[price-scout] No results extracted for "${product.search_query}", will need Playwright fallback`);
    return [];
  } catch (err) {
    console.error(`[price-scout] Scrape failed for "${product.search_query}":`, err);
    return [];
  }
}

/**
 * Try CF Browser Rendering /json endpoint
 */
async function extractWithJson(
  env: Env,
  url: string,
  product: TrackedProduct
): Promise<GoogleShoppingResult[]> {
  const response = await env.BROWSER.fetch('https://api.cloudflare.com/client/v4/accounts/browser-rendering/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      prompt: 'Extract all product listings with their title, price (as number), currency, seller name, product URL, and shipping info. Return as JSON array.',
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            price: { type: 'number' },
            currency: { type: 'string' },
            seller: { type: 'string' },
            url: { type: 'string' },
            shipping: { type: 'string' }
          },
          required: ['title', 'price', 'seller']
        }
      }
    })
  });

  if (!response.ok) {
    console.log(`[price-scout] /json endpoint returned ${response.status}`);
    return [];
  }

  const data = await response.json() as GoogleShoppingResult[];
  return Array.isArray(data) ? data : [];
}

/**
 * Fallback: Use /markdown endpoint and parse pricing patterns
 */
async function extractWithMarkdown(
  env: Env,
  url: string,
  product: TrackedProduct
): Promise<GoogleShoppingResult[]> {
  const response = await env.BROWSER.fetch('https://api.cloudflare.com/client/v4/accounts/browser-rendering/markdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    console.log(`[price-scout] /markdown endpoint returned ${response.status}`);
    return [];
  }

  const markdown = await response.text();
  return parseMarkdownPricing(markdown);
}

/**
 * Parse pricing data from markdown text
 * Looks for common patterns: $XX.XX, seller names, product titles
 */
function parseMarkdownPricing(markdown: string): GoogleShoppingResult[] {
  const results: GoogleShoppingResult[] = [];
  const pricePattern = /\$(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/g;
  const lines = markdown.split('\n');

  let currentTitle = '';
  let currentSeller = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Capture headings or bold text as potential titles
    const headingMatch = trimmed.match(/^#+\s+(.+)$/) || trimmed.match(/\*\*(.+?)\*\*/);
    if (headingMatch) {
      currentTitle = headingMatch[1];
    }

    // Look for prices
    const priceMatch = trimmed.match(pricePattern);
    if (priceMatch && currentTitle) {
      const priceStr = priceMatch[0].replace(/[$,]/g, '');
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
        results.push({
          title: currentTitle,
          price,
          currency: 'USD',
          seller: currentSeller || 'Unknown',
          url: '',
          shipping: undefined
        });
        currentTitle = '';
        currentSeller = '';
      }
    }
  }

  return results;
}
