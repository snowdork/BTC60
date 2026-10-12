# BTC60 — Crypto prediction terminal

BTC60 is a buildless web app for exploring crypto direction predictions with demo funds. See a complete UTC hour at once: one 60-minute market, two 30-minute markets, and four 15-minute markets, with a live chart and a persistent order ticket.

![BTC60 terminal with an hourly chart, aligned prediction intervals, and an order ticket](assets/previews/prediction-playfield.png)

*Illustrative demo preview. Prices, percentages, and account figures shown are sample values.*

## Overview

- **Complete-hour workspace:** inspect open, upcoming, and completed intervals without hiding duration tiers; navigate previous hours and return to the current hour.
- **Live market context:** Coinbase Exchange ticker updates and minute-candle history, with separate spot freshness, history, and order-readiness indicators.
- **Demo predictions:** choose Up or Down, set a budget, and review whole-contract cost, possible return, and potential profit. Model percentages determine simulated contract prices.
- **Live confirmation:** review follows the market; the server executes at its current model price within your budget. Final quantity and return can differ from review.
- **Persistent accounts:** signup/login, $14,250 starting demo balance, saved predictions, and automatic settlement backed by SQLite.
- **Portfolio tracking:** pending orders, wins, losses, returns, and realized profit/loss, with committed funds shown separately.
- **Display controls:** light/dark themes, responsive layouts, chart pause, reconnect, and an explicit synthetic preview mode.

### Default prediction coins

<p>
  <img src="assets/coins/btc.svg" width="32" height="32" alt="Bitcoin (BTC)">
  <img src="assets/coins/eth.svg" width="32" height="32" alt="Ethereum (ETH)">
  <img src="assets/coins/sol.svg" width="32" height="32" alt="Solana (SOL)">
  <img src="assets/coins/xrp.svg" width="32" height="32" alt="XRP">
  <img src="assets/coins/doge.svg" width="32" height="32" alt="Dogecoin (DOGE)">
  <img src="assets/coins/ada.svg" width="32" height="32" alt="Cardano (ADA)">
  <img src="assets/coins/ltc.svg" width="32" height="32" alt="Litecoin (LTC)">
</p>

BTC · ETH · SOL · XRP · DOGE · ADA · LTC. The database catalog controls availability; all coins share the same account balance.

### Prediction rules

Up wins when the closing benchmark is greater than or equal to the opening benchmark; Down wins when it is lower. Each benchmark uses the minute candle close immediately before its interval boundary. A winning contract returns $1; a losing contract returns $0, with zero demo fees. Missing history leaves orders awaiting settlement for retry.

These are uncalibrated model estimates, simulated prices, and Coinbase minute-close proxy results. BTC60 does not trade real money or claim official Kalshi or CF Benchmarks settlement. Synthetic preview and historical views cannot place orders.

## Run locally

Requires Python 3.10+ on Linux/macOS; no Python packages or frontend build are needed.

```bash
python3 server.py
```

Open http://127.0.0.1:8000 for the welcome page or http://127.0.0.1:8000/index.html for the terminal. Use `--port` to change the port. Internet access is required for live prices, benchmarks, and settlement. The terminal requires `/api/coins`; file previews and static hosting alone cannot initialize a working terminal or provide accounts.

## Documentation

- [User guide](doc/USER_GUIDE.md): accounts, predictions, history, portfolio, and troubleshooting.
- [Design](doc/DESIGN.md): interaction, pricing, settlement, architecture, and persistence.
- [Database maintenance](doc/DATABASE_MAINTENANCE.md): initialization, inspection, backups, and explicit reset.

## Development and validation

The root files are the application source. `bootstrap.js` loads the database coin catalog before loading the model, trading controller, and chart. `server.py` serves the interface and account API with SQLite persistence. Keep development on the `Phase1` branch.

```bash
node --test *.test.js
python3 -m unittest server_test.py
python3 -m unittest discover -s scripts -p '*_test.py'
node --check app.js
node --check btc-chart.js
```

Tests cover market calculations, catalog/bootstrap behavior, portfolio summaries, account/order/settlement handling, and database maintenance. They do not establish live Coinbase availability.

## Data and catalog

The default database is `data/btc60.sqlite3`; `BTC60_DB` selects another path. Startup creates missing tables and applies catalog migrations. Accounts start with $14,250 in demo funds. Browser-only positions are not imported. Database files and backups are excluded from Git.

The database `coins` table is authoritative. The seed has ten records: BTC, ETH, SOL, XRP, DOGE, ADA, and LTC enabled; LINK, TRUMP, and AVAX disabled. Existing databases can have administrator edits. Triggers allow at most eight enabled coins. Disabling a coin blocks new orders while preserving history and settlement. Keep referenced symbols and product mappings stable.

`coins.seed.json` seeds new databases; editing it does not overwrite existing catalog rows. One-time migrations add catalog entries and replace LINK selection with LTC while retaining LINK history. Refresh the terminal after database catalog edits.

```sql
BEGIN;
UPDATE coins SET enabled=0 WHERE symbol='DOGE';
UPDATE coins SET enabled=1 WHERE symbol='AVAX';
COMMIT;
```

Custom coins need a supported Coinbase USD product, display precision, positive demo base, and sort order. Optional local SVG icons belong under `assets/coins/`; a blank icon uses a text button. See the maintenance guide before changing or resetting a database.

## Static distribution and hosting

`dist/` contains static copies, not a standalone account backend. After frontend changes, synchronize all root HTML, CSS, and browser JavaScript files plus `assets/` into `dist/`; exclude tests and backend scripts. Include portfolio, theme, and responsive assets. The welcome preview is `assets/previews/prediction-playfield.png`. `.openai/hosting.json` identifies the existing private Site.

The Python server binds to loopback for local development. Public account hosting requires a production server, HTTPS, Secure session cookies, and account recovery/email verification. Static hosting cannot replace the Python/SQLite API.
