# ROLR BTC60 — Phase1

Laptop-focused, buildless web app for seeing a complete hour of Bitcoin predictions: one 60-minute market, two 30-minute markets, and four 15-minute markets. No 5-minute markets.

Open `index.html` or run `python3 -m http.server 8000`. The interface works without a CSS framework; optional Google Fonts require internet access.

Select a market, choose Up or Down, set a budget, review the whole-contract cost and possible return, and confirm a demo prediction. Positions and the remaining demo balance persist in browser storage when available. Settled and upcoming markets are viewable but cannot accept orders. The hourly BTC graph uses Coinbase public ticker WebSocket updates and one-minute candle history. A single red dashed cursor follows UTC time through the chart and every market tier. Feed state is labeled live, stale, or disconnected. Demo preview explicitly switches to an animated synthetic series. Pause freezes the visualization; market availability still follows time. Contract quotes remain simulated, and benchmark values are illustrative candle-close proxies rather than CF Benchmarks settlement values. No settlement engine is connected.

The demo uses binary settlement: final benchmark >= starting benchmark resolves Up; below resolves Down. There is no tie band. The rules dialog links Kalshi's crypto benchmark guidance. Applying that comparison to the 30- and 60-minute demo intervals is our proposed behavior, not a verified Kalshi listing. Quotes, zero fees, and whole-contract budgeting are simulation assumptions.

Run checks with `node --test market-model.test.js` and `node --check app.js` and `node --check btc-chart.js`.

Deployable copies live in `dist/`. After source edits, copy `index.html`, `styles.css`, `market-model.js`, `btc-chart.js`, and `app.js` into `dist/`. `.openai/hosting.json` identifies the existing private Site. Keep development on the `Phase1` branch.
