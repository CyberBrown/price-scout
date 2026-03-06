export interface Env {
  DB: D1Database;
  BROWSER: Fetcher;
  ENVIRONMENT: string;
}

export interface TrackedProduct {
  id: number;
  sku: string;
  name: string;
  search_query: string;
  our_price: number | null;
  alert_threshold: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface PriceSnapshot {
  id: number;
  product_id: number;
  seller: string | null;
  price: number;
  currency: string;
  url: string | null;
  shipping_info: string | null;
  source: string;
  raw_data: string | null;
  scraped_at: string;
}

export interface CompetitorUrl {
  id: number;
  product_id: number;
  competitor_name: string;
  url: string;
  price_selector: string | null;
  active: number;
  created_at: string;
}

export interface Alert {
  id: number;
  product_id: number;
  snapshot_id: number;
  alert_type: 'undercut' | 'price_drop' | 'new_seller' | 'out_of_stock';
  message: string;
  acknowledged: number;
  created_at: string;
}

export interface GoogleShoppingResult {
  title: string;
  price: number;
  currency: string;
  seller: string;
  url: string;
  shipping?: string;
}
