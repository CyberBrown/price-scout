# Price Scout

Competitor pricing monitor for Solamp. Scrapes Google Shopping daily and stores pricing data in D1 for analysis via the solampio admin dashboard.

## Architecture

- **Cloudflare Worker** with cron trigger (daily at 6am UTC)
- **Browser Rendering** REST API for scraping Google Shopping
- **D1 database** for storing products, price snapshots, and alerts
- **REST API** for the solampio admin dashboard

## Setup

```bash
# Install dependencies
bun install

# Create D1 database
wrangler d1 create price-scout-db
# Copy the database_id into wrangler.toml

# Run migrations
bun run db:migrate

# Local dev
bun run dev

# Deploy
bun run deploy
```

## API Endpoints

### Products
- `GET /api/products` — List all tracked products
- `POST /api/products` — Add a product to track
- `PUT /api/products/:id` — Update a tracked product
- `DELETE /api/products/:id` — Remove a tracked product

### Pricing Data
- `GET /api/products/:id/prices?days=30` — Get price history

### Alerts
- `GET /api/alerts?unacknowledged=true` — Get alerts
- `POST /api/alerts/:id/ack` — Acknowledge an alert

### Dashboard
- `GET /api/dashboard` — Summary stats for admin

## Adding Products

```bash
curl -X POST https://price-scout.<subdomain>.workers.dev/api/products \
  -H 'Content-Type: application/json' \
  -d '{
    "sku": "REC-ALPHA-400",
    "name": "REC Alpha 400W Solar Panel",
    "search_query": "REC Alpha 400W solar panel price",
    "our_price": 249.99,
    "alert_threshold": 200.00
  }'
```

## Phases

- [x] Phase 1: D1 schema + REST API + Browser Rendering /json extraction
- [ ] Phase 2: Direct competitor URL scraping (Playwright fallback)
- [ ] Phase 3: Solampio admin dashboard integration + trend charts
