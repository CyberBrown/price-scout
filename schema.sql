-- Price Scout D1 Schema

-- Products to track
CREATE TABLE IF NOT EXISTS tracked_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  search_query TEXT NOT NULL, -- what to search on Google Shopping
  our_price REAL,             -- Solamp's price for comparison
  alert_threshold REAL,       -- alert if competitor price drops below this
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Price snapshots from scraping
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  seller TEXT,
  price REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  url TEXT,
  shipping_info TEXT,
  source TEXT DEFAULT 'google_shopping', -- google_shopping | direct_url
  raw_data TEXT,                          -- full JSON from extraction
  scraped_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES tracked_products(id)
);

-- Competitor URLs (for Phase 2 when direct URLs are available)
CREATE TABLE IF NOT EXISTS competitor_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  competitor_name TEXT NOT NULL,
  url TEXT NOT NULL,
  price_selector TEXT,  -- CSS selector for price element
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES tracked_products(id)
);

-- Alerts triggered by price changes
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  snapshot_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL, -- 'undercut' | 'price_drop' | 'new_seller' | 'out_of_stock'
  message TEXT NOT NULL,
  acknowledged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES tracked_products(id),
  FOREIGN KEY (snapshot_id) REFERENCES price_snapshots(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_snapshots_product ON price_snapshots(product_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_scraped ON price_snapshots(scraped_at);
CREATE INDEX IF NOT EXISTS idx_alerts_unack ON alerts(acknowledged, created_at);
CREATE INDEX IF NOT EXISTS idx_competitor_product ON competitor_urls(product_id);
