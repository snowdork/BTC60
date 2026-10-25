# Predict60 design

## Workspace and visual language

The primary view presents a complete UTC hour: one 60-minute card, two aligned 30-minute cards, and four aligned 15-minute cards. There are no 5-minute markets. A single chart sits above the 60-minute card, matching its width; cards do not contain individual graphs. One red dashed UTC cursor crosses the live chart and all tiers.

Laptop layouts place a persistent ticket beside the markets. Smaller screens move the ticket below the playfield and let the timeline scroll horizontally within its own container. Coin selection and portfolio tables have independent scroll containers. Account and welcome pages reflow to the viewport.

Dark surfaces use near-black tones with emerald Up/selection, crimson Down, amber data warnings, and cyan explanatory cues. Light and dark themes use shared variables. Financial values use monospace styling with native font fallbacks. Theme preference is applied before rendering, stored locally, and synchronized across tabs. Coin logos are local SVGs; the welcome page links a static terminal preview.

## Market state and navigation

Selecting a card changes the ticket without rebuilding the playfield. Open intervals support orders when data is ready; upcoming and completed intervals support inspection. UTC dates distinguish midnight boundaries. Previous hour, Next, and Current hour navigate history; switching coins preserves the selected hour. Historical charts cover the full hour, label the close, and hide the live cursor. Missing candles leave affected benchmarks or results unavailable.

Crypto is the only active category. Oil and Weather render as non-navigable
**Coming soon** cards. Direct Oil/Weather terminal requests are redirected, and
server-side validation rejects their orders. Oil feed adapters remain available
for diagnostics until a verified feed can support prediction settlement.

The database catalog supplies selectable coins, Coinbase products, precision, icons, and synthetic base prices. The default seed enables BTC, ETH, SOL, XRP, DOGE, ADA, and LTC. Up to eight coins may be enabled. Predictions retain their original coin independently of current selection; account balance is shared across coins.

## Data and readiness

`btc-chart.js` uses Coinbase Exchange public ticker WebSocket updates and REST minute candles. The status strip distinguishes spot freshness, history availability, and order readiness. The browser blocks orders for historical/synthetic views, paused charts, disconnected feeds, source timestamps older than 15 seconds or more than 5 seconds in the future, history errors, missing opening benchmarks, missing quote configuration, and closed intervals.

Demo preview explicitly uses animated synthetic data and cannot save predictions. Pause freezes chart rendering and blocks orders; UTC interval availability continues advancing. Reconnect reloads live data. The backend independently checks the interval, retrieves the benchmark, fetches a fresh Coinbase ticker, and recomputes pricing before accepting an order.

## Prediction pane context

The ticket shows a compact UTC-hour bar highlighting the selected interval, time remaining, a spot/source timestamp, distance from the opening benchmark, and explicit Up/Down closing-price thresholds. Selected-side rules receive emphasis. Historical/completed intervals use their closing benchmark; upcoming intervals wait for an opening benchmark. Live comparisons require a connected fresh feed; synthetic context is labeled. This context lives in the ticket and does not add overlays to the hourly graph.

## Estimates and demo pricing

Open-market probabilities use zero expected log return and a normal terminal log-return distribution. Minute variance blends equal weights of EWMA estimates with 10- and 60-minute half-lives, using completed consecutive returns from a trailing 24-hour history. Missing history blocks quotes; a numerical variance floor of 1e-12 prevents division by zero. These initial parameters are candidates for historical validation, not fitted constants.

```text
variance = 0.5 × fastEWMA + 0.5 × slowEWMA
z = log(spot / benchmark) / sqrt(variance × minutes to settlement)
rawUp = NormalCDF(z)
calibratedUp = sigmoid(slope × logit(rawUp) + intercept)  # when available
Up = clamp(round(100 × probability), 1, 99)
Down = 100 − Up
```

The first second responds to live price movement. The 30-second betting cutoff does not change time to settlement. Ties resolve Up. Upcoming cards hide probabilities; completed cards show confirmed 100/0 outcomes. Quotes remain simulated prices, not exchange order-book prices.

The server caches 24 hours of Coinbase candles per product per minute. Cold loads fetch six batches with three concurrent requests and eight-second request timeouts; subsequent minutes fetch only the missing delta from a recent snapshot. Each batch stays below Coinbase's 300-candle request limit. The browser uses this history alongside its chart history. Python and JavaScript implement equivalent algorithms, with parity tests. Execution recalculates using authoritative live prices, so a displayed quote can move before confirmation.

Run `python3 scripts/calibrate-odds.py BTC candles.json` using chronological Coinbase-format minute candles (`[timestamp, low, high, open, close, volume]`, timestamp in seconds). The fitter samples each 15/30/60-minute window at its midpoint, derives labels from the actual settlement rule, and uses the first 70% of time for calibration fitting and the remainder for validation. Whole-hour splits prevent outcomes crossing the split. It requires at least 500 fitting and 200 validation windows and exports only when both held-out Brier score and log loss improve. The artifact records metrics and time bounds in `data/odds-calibration.json`; `/api/coins` distributes coefficients to the browser. Reload the terminal after calibration changes. Midpoint validation does not establish accuracy at every time remaining; validate more granular observations before extending claims.

Without a validated artifact for a coin, the normal-CDF model remains explicitly uncalibrated. Historical outcomes have not been supplied with this repository. Do not fabricate calibration coefficients or claim measured accuracy improvements. Keep a subsequent untouched period for independent evaluation after model selection.

## Review and execution

Users select a side and a budget of at least $1 within their available demo balance. Fractional shares use the full budget; fees are zero. Stakes with sub-cent precision round up to the next cent. Winning payouts use integer arithmetic to round up to the next cent: `(cost_cents * 100 + price_cents - 1) // price_cents`. A winning contract returns $1 and a losing contract returns $0. Potential profit is winning return minus cost.

Review remains live as spot, benchmark, and model prices change. It shows contract price, count, cost, potential return, profit, and interval countdown. Confirmation authorizes execution at the server's current model price within the selected budget. The server does not enforce the browser quote or benchmark, and there is no 2¢ tolerance. Final quantity and return can differ from review. Expired intervals, unavailable authoritative data, and insufficient balance prevent saving.

The server validates coin availability, side, request ID, budget, and current UTC start. It computes the authoritative opening benchmark, spot, model price, fractional share count, and cost. A transaction atomically debits funds and inserts the prediction. Per-account unique request IDs make retries idempotent. Saved terms remain fixed after execution.

## Settlement and portfolio

The opening proxy is the close of the minute candle immediately before the interval start; the closing proxy is the close immediately before its end. This is not a 60-second average. Closing price greater than or equal to opening resolves Up; a lower close resolves Down. There is no tie band. All durations use this demo rule; no official Kalshi or CF Benchmarks settlement is claimed.

A worker checks due predictions every 30 seconds. Visible signed-in pages request settlement every 15 seconds and on focus/visibility changes; these requests process only that account. Missing history leaves orders awaiting settlement for retry, including after restart. Settlement insertion and winning credits are atomic and idempotent.

The terminal lists unsettled predictions with countdowns and marks account wagers on market cards. Portfolio history includes pending, awaiting settlement, wins, and losses. Realized profit/loss includes settled returns minus their costs; pending costs are shown separately. Win rate counts settled predictions only.

## Architecture and storage

| Component | Responsibility |
| --- | --- |
| `bootstrap.js`, `coins.js` | Catalog loading, coin controls, startup errors |
| `market-model.js` | Pure quote, estimate, volatility, and readiness logic |
| `app.js` | Market selection, ticket, live review, wager displays |
| `btc-chart.js` | Feed, candle history, chart, UTC market lifecycle |
| `account.js`, `auth.js`, `password.js` | Session/account API, authentication UI, and password changes |
| `portfolio.js`, `portfolio-model.js` | Account history, filters, summary calculations |
| `theme.js`, shared CSS | Persisted theme and responsive presentation |
| `src/backend/server.py` | Static serving, catalog/account API, orders, settlements |
| `scripts/database.py` | Explicit initialization, status, backup, reset |

SQLite stores users, hashed sessions, predictions, settlements, coins, and migration versions. Each player receives 1,000 contest credits per hour, with a fresh balance at each GMT hour boundary independently of prior settlements. Passwords use salted scrypt; sessions use HttpOnly/SameSite cookies and CSRF tokens. Account data persists across browser sessions and server restarts. Local storage holds presentation preferences rather than balances or saved orders.

Authenticated `POST /api/change-password` requires the session CSRF token and
`currentPassword`, `newPassword`, and `confirmPassword` fields. It verifies the
current password (8–128 characters), validates the new password (8–16 characters)
and confirmation, then atomically replaces the salted scrypt hash and revokes
all other sessions. Login, signup, and password changes share a per-client-IP
limit of 20 attempts per minute. Password recovery remains unavailable.

Account requests carry a local generation counter so responses started before
a completed logout cannot restore signed-in state. Logout treats an already
expired session as success, clears account and contest-wallet state, and returns
to the welcome page. Settlement requests pause while logout is in progress.

UI/chart updates run once per second; incoming prices update the model immediately. The controller caches controls, delegates market selection, and avoids rebuilding unchanged rows and totals. Volatility is cached until candles change or a minute closes. Hidden tabs skip rendering and account polling. Static text assets support gzip and ETag revalidation; account/API responses are uncached.

The local server is a demo development service. Production hosting needs HTTPS, a production server, Secure cookies, and account recovery/email verification. See [README.md](../README.md) for development and [the maintenance guide](DATABASE_MAINTENANCE.md) for database operations.

Historical downloads use `scripts/download-odds-history.py` with progress and atomic per-batch checkpoints. The fitter uses damped Newton optimization (at most 80 iterations), reports each preparation stage, and preserves existing coefficients on unsuccessful validation. Network failures stop with a resumable checkpoint instead of silently waiting indefinitely.
