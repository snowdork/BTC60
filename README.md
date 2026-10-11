# BTC60 — Phase1

Laptop-focused, buildless web app for seeing a complete hour of crypto predictions: one 60-minute market, two 30-minute markets, and four 15-minute markets. No 5-minute markets.

Run `python3 server.py`, then open **http://127.0.0.1:8000** for the BTC splash page. The terminal is at `/index.html`; signup and login have dedicated pages. Python 3.10+ is required; no packages need installing. Direct file previews and static hosting can display the interface but cannot provide accounts or save orders.

SQLite is created automatically at `data/btc60.sqlite3` (excluded from Git). Tables store users, hashed sessions, predictions, and settlements. Passwords use salted scrypt hashes; sessions use HttpOnly, SameSite cookies and CSRF tokens. Each account starts with $14,250 in demo funds. The server validates the current UTC interval, benchmark, fixed demo quote, and available balance, then atomically records the order and debits its cost. Duplicate request IDs cannot double-charge. Existing browser-only positions are not imported.

A background worker checks closed orders every 30 seconds and records Coinbase minute-close proxy outcomes. Up includes an unchanged price; winning contracts credit $1 each exactly once. Missing history leaves the order pending for retry. These are demo settlements, not official Kalshi or CF Benchmarks results. Settlement requires internet access and a running server; overdue orders are processed after restart. Synthetic Demo preview cannot place account orders.

This server binds to loopback for local development. Public hosting needs a production server with HTTPS, session-cookie Secure configuration, and account recovery/email verification before real users are invited.

Select a market, choose Up or Down, set a budget, review the whole-contract cost and possible return, and confirm a demo prediction. Signed-in predictions, settlements, and the demo balance persist in SQLite across browsers and server restarts. Settled and upcoming markets are viewable but cannot accept orders. The hourly BTC graph uses Coinbase public ticker WebSocket updates and one-minute candle history. A single red dashed cursor follows UTC time through the chart and every market tier. Feed state is labeled live, stale, or disconnected. Demo preview explicitly switches to an animated synthetic series. Pause freezes the visualization; market availability still follows time. Contract quotes remain simulated, and benchmark values are illustrative candle-close proxies rather than CF Benchmarks settlement values. Demo settlements are processed by the local server.

The demo uses binary settlement: final benchmark >= starting benchmark resolves Up; below resolves Down. There is no tie band. The rules dialog links Kalshi's crypto benchmark guidance. Applying that comparison to the 30- and 60-minute demo intervals is our proposed behavior, not a verified Kalshi listing. Quotes, zero fees, and whole-contract budgeting are simulation assumptions.

Run API/database checks with `python3 -m unittest server_test.py`. Run frontend checks with `node --test market-model.test.js coins.test.js` and `node --check app.js` and `node --check btc-chart.js`.

Deployable copies live in `dist/`. After source edits, copy `index.html`, `styles.css`, `market-model.js`, `coins.js`, `btc-chart.js`, `app.js`, `bootstrap.js`, `account.js`, `auth.js`, `auth.css`, `welcome.html`, `splash.js`, `assets/previews/prediction-playfield.png`, `login.html`, `signup.html`, and the `assets/` directory into `dist/`. `.openai/hosting.json` identifies the existing private Site. Keep development on the `Phase1` branch.

The coin-logo buttons offers Bitcoin (BTC), Ethereum (ETH), Solana (SOL), XRP, and Dogecoin (DOGE). Selection persists locally and switches the public USD ticker/history feed, graph, prices, labels, and order context. Local SVG coin logos appear beside the selector and current price. Small-priced coins retain extra decimal places. Saved positions keep their original coin; the demo balance is shared across all coins.

Use Previous hour to inspect the selected coin's completed hourly chart and all seven interval results. Next moves forward; Current hour restores the live feed. Historical views disable order entry and preserve their hour when switching coins. Historical closing prices and outcomes use Coinbase minute-candle proxies, not official exchange settlements. Missing candles leave affected results unavailable.

Each interval shows Up/Down percentages. Open-market estimates use a logistic curve centered on the price-to-beat: z = log(spot / benchmark) / (minute volatility × sqrt(minutes remaining)); Up = sigmoid(1.7 × z), rounded and limited to 1–99%, and Down = 100 − Up. Minute volatility is RMS consecutive completed-minute log returns with a 0.01% floor. This is an uncalibrated heuristic, separate from contract quotes. Upcoming cards hide percentages; newly opened cards show 50/50 for their first second, and completed cards show the 100/0 demo result. Open estimates are hidden when the live feed is stale or required inputs are missing.


### Database coin catalog

The `coins` table is the source of truth for betting coins. `/api/coins` supplies the buttons, feed product, display precision, icon, and demo-preview base price. New orders require `enabled=1`; disabling a coin preserves its prediction history and settlement processing. The server also reads the stored product for benchmark/settlement lookups. Restart the server after this update; refresh the terminal after catalog edits.

`coins.seed.json` seeds the initial catalog only when the table is first created. Editing the seed later does not overwrite database changes. Manage the catalog in SQLite, for example:

```sql
UPDATE coins SET enabled=0 WHERE symbol='DOGE';
INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order)
VALUES('AVAX','Avalanche','AVAX-USD',3,25,'',1,5);
```

A blank icon displays a text button. For a local logo, place its SVG under `assets/coins/` and set `icon` to that path. Keep symbols stable once predictions reference them; disable coins instead of deleting them. New products must be supported by the configured Coinbase feeds. The terminal requires the local server to load its catalog; it does not fall back to a hardcoded list.

The splash page includes a clickable demo screenshot of the prediction playfield. Decorative floating logos use enabled coins from `/api/coins`; reduced-motion preferences disable their animation.


The catalog contains nine records with at most eight enabled for predictions. BTC, ETH, SOL, XRP, DOGE, ADA, and LTC are enabled; LINK, TRUMP, and AVAX are disabled. TRUMP is retained only to preserve any existing prediction history. A one-time migration adds the four new records without changing existing catalog edits. Database triggers reject enabling a ninth coin. To enable AVAX, disable another coin first, then enable AVAX in the same transaction. Refresh the terminal after catalog edits. New coin SVGs are local vector badges; the TRUMP badge is a custom lettermark.

### Database maintenance

See [scripts/README.md](scripts/README.md) for `init`, `status`, `backup`, and explicit `reset --confirm-reset` commands. Safe init preserves data; reset automatically backs up the previous database. Run script checks with `python3 -m unittest discover -s scripts -p "*_test.py"`.

A second catalog migration replaces Chainlink selection with Litecoin (LTC-USD), retaining LINK for historical predictions and settlement lookup.


### Portfolio and prediction tracking

The portfolio icon in the terminal opens `portfolio.html`. History is restricted to the signed-in user's account and includes pending, awaiting settlement, won, and lost predictions. Filters and summary cards show win/loss counts, win rate among settled orders, available balance, pending committed funds, and realized profit/loss (returned funds minus settled-order costs). Unsettled order costs never count as realized losses. The trading pane shows only unsettled predictions, with live countdowns; completed predictions move into portfolio history.

Visible account pages check settlements every 15 seconds and when focused. The background worker continues every 30 seconds. Missing price history leaves orders awaiting settlement. Server-side settlement inserts and winning balance credits remain atomic and idempotent. Refresh requests only process the signed-in user's orders; the worker processes all accounts. Run frontend checks with `node --test *.test.js` and account/settlement tests with `python3 -m unittest server_test.py`.

The sun/moon icon in each page header toggles light and dark themes. The preference is saved locally and applied before page rendering, and synchronizes across tabs. Theme assets are `theme.js` and `theme.css`; include both in static copies.


### Performance and responsive layouts

The terminal keeps the full timeline aligned at a readable minimum width. On phones/tablets the order ticket moves below the markets and only the timeline scrolls sideways; the page itself fits the viewport. Coin selection scrolls independently, portfolio tables have their own scroll container, and account/splash pages reflow. Laptop layouts keep the ticket beside the playfield.

Chart/time updates run once per second instead of four times per second. Streaming prices still update the model immediately; UI notifications are limited to once a second. Static chart time labels are built once per hour, sorted streaming data avoids repeated sorting, pending-order countdowns update existing elements, and unchanged account/history snapshots skip rebuilding rows. Hidden-tab rendering and polling are skipped. Native font fallbacks avoid external font requests.

The local server gzip-compresses text assets and serves ETags for conditional revalidation. Browsers can reuse unchanged assets without downloading their bodies; changed files still refresh immediately. Account/API responses remain uncached. `responsive.css` is included on every page and must stay in the `dist/` copies.


### Phase2 market clarity and data checks

The server publishes the demo purchase prices with the coin catalog; both the order ticket and segment cards use those quotes. Up/Down model percentages are heuristic estimates, independent of purchase prices. Each open segment shows its distance from the starting settlement benchmark.

The settlement details describe the actual Coinbase Exchange proxy: the minute candle close immediately before each interval boundary. This is not a 60-second average. Equal opening and closing benchmarks resolve Up; missing candles leave orders awaiting settlement.

The status strip separates spot freshness, candle-history availability, and order readiness. Live orders require a connected, unpaused feed, a source timestamp within 15 seconds, valid history and benchmark, and a server-supplied quote. The server independently fetches a fresh Coinbase ticker before accepting a new order. Historical and synthetic previews cannot place orders.
