# Velocity Terminal — Phase1

A clean, laptop-focused Bitcoin prediction workspace. Keep the entire hour and all seven intervals visible beside one order ticket: 60 minutes (one market), 30 minutes (two), 15 minutes (four). No 5-minute markets. No graph inside the 60-minute market.

OLED surfaces #080808 / #101110 / #181a18. Emerald #00e676 for Up and selection, crimson #ff1744 for Down, amber #ffb300 for sample warnings, cyan #00d4ff for explanatory cues. Borders white at roughly 7%; restrained emphasis. Sora for concise headings, JetBrains Mono for tabular financial values.

One full-hour timeline; aligned market cards; explicit Open, Settled and Upcoming states. Selecting any card updates the persistent right-side ticket. Closed and upcoming cards support inspection, with order entry disabled. No hiding duration tiers: full-hour visibility is the primary feature.

Binary outcomes only: Up includes equality. The final 60-second benchmark is compared with the starting benchmark. This follows the documented 15-minute comparison; using it for 30 and 60 minutes is proposed demo behavior. No tie band. Spot is contextual, not a settlement value.

Choose side, set a budget, review, confirm. Quote in cents per contract; pay $1 per winning contract and $0 per losing contract. Whole contracts; exact cost stays within the budget. Zero demo fees. Saved demo positions deduct exact cost from the browser-local balance. A live Coinbase hourly graph sits above, and exactly matches the width of, the 60-minute card. A single red dashed UTC cursor crosses the chart and all market tiers. Price updates stream through a public WebSocket; history uses minute candles. Display source and connection state, with explicit animated demo preview when disconnected. Benchmark values are illustrative candle-close proxies, not the settlement index. No actual settlement claims.

Five-coin workspace: BTC, ETH, SOL, XRP, DOGE. Use a labeled dropdown in the header and a local coin logo directly before the current price. Coin choice updates the entire market context and public USD feed, with appropriate decimal precision. Keep saved positions identified by their original coin.
