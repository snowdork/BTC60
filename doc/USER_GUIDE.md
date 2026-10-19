# Predict60 user guide

Predict60 lets you make crypto direction predictions with demo funds. Prices and results use Coinbase proxies; no real money is traded.

## Start and sign in

Run `python3 server.py` from the project folder, then open http://127.0.0.1:8000. Select the welcome page's terminal preview or open `/index.html`. Use the signup or login pages to access an account. New accounts receive $14,250 in demo funds. Your balance and predictions are stored by the local server and survive browser refreshes and server restarts.

Keep the server running and allow internet access for live prices and settlement. Opening HTML files directly or using static hosting alone does not provide a working terminal.

## Read the terminal

Choose a coin using the header buttons. The default choices are BTC, ETH, SOL, XRP, DOGE, ADA, and LTC; administrators can change availability. Coin selection updates prices, chart, and market context. All coins share your account balance.

Each UTC hour shows one 60-minute interval, two 30-minute intervals, and four 15-minute intervals. Select any card to inspect its benchmark and details in the ticket. Open cards accept predictions when data is ready. Upcoming and completed cards are read-only. A red dashed cursor shows the current UTC time across the chart and markets.

Up/Down percentages are heuristic model estimates, not calibrated odds. They also set simulated contract prices: 70% Up means an Up contract costs 70¢. Percentages and prices change with spot, time remaining, and recent volatility. Upcoming cards hide percentages; completed cards show results when candle history is available.

The prediction pane shows the selected interval within its UTC hour, current spot and source time, distance from the benchmark, and the exact closing-price conditions for Up and Down. Completed intervals show their closing benchmark; upcoming intervals wait for their opening benchmark. Stale or disconnected prices hide the live comparison.

## Make a prediction

1. Sign in, select an open interval, and check that the status strip says data is ready.
2. Choose Up or Down and enter a budget of at least $1 within your available balance.
3. Review the contract price, fractional share count, exact cost, possible return, and potential profit.
4. Confirm before the betting countdown expires. Bets close 30 seconds before the interval ends to allow final processing.

Review updates live. Confirmation buys at the server's current model price within your budget, so the final contract count, cost, and possible return can differ from the displayed review. Check the saved prediction for executed terms. A prediction is saved only when the server accepts it; errors appear in the review.

The full bet amount is deducted. For example, $10 at 70¢ buys about 14.285714 shares. A win returns $14.29, for $4.29 profit; a loss returns $0 and loses $10. Winning payouts round up to the next cent. There are no demo fees.

## Results and portfolio

The opening benchmark is the close of the minute candle immediately before the interval begins. The closing benchmark is the close immediately before it ends. Up wins when closing is equal to or greater than opening; Down wins when closing is lower. This is a minute-close proxy, not a 60-second average or an official exchange settlement.

The terminal shows unsettled predictions and countdowns. Use the portfolio icon to open prediction history, filter All/Pending/Wins/Losses, and inspect cost, return, and profit/loss. An expired prediction may say awaiting settlement while price history is missing. Winning contracts credit $1 each once settlement completes.

Portfolio realized profit/loss counts only settled predictions. Pending committed funds are shown separately; they are not realized losses. Win rate includes settled orders only. Use Refresh settlements to request another check. Visible account pages also check every 15 seconds, and the server worker checks every 30 seconds. Overdue orders are retried after a server restart.

## History and display controls

Previous hour opens a completed hour. Next moves forward; Current hour returns to the live view. The UTC date helps distinguish days. Historical views disable orders, show the full-hour chart, and preserve the hour when switching coins. Missing history leaves affected results unavailable.

Pause freezes the chart and blocks order entry; it does not stop the market countdown. Resume restores rendering. Demo preview shows animated synthetic prices for exploring the interface and cannot place account orders. Reconnect returns to or retries the live feed.

The sun/moon button switches themes and saves your preference across tabs. On smaller screens, the ticket moves below the markets; scroll the timeline or coin strip horizontally to see all items.

## Troubleshooting

| Message or symptom | Action |
| --- | --- |
| Coins unavailable / terminal offline | Start or restart `python3 server.py`, open the localhost terminal URL, and retry or refresh. |
| Price feed disconnected or stale | Check internet access and use Reconnect; wait for a fresh live update. |
| History or opening benchmark unavailable | Wait for Coinbase candle history, then reconnect if needed. Orders stay blocked until required data is available. |
| Chart paused / synthetic preview / historical market | Resume, reconnect to live data, or select Current hour. |
| Too late to place | Select an open interval and review a new prediction. |
| Insufficient demo balance | Reduce the budget and check pending commitments in your portfolio. |
| Awaiting settlement | Keep the server running with internet access; missing candles are retried automatically. |

For setup and checks, see [README.md](../README.md). For backups and database maintenance, see [Database maintenance](DATABASE_MAINTENANCE.md). A database reset removes accounts and predictions; it is not a routine troubleshooting step.

## Choose a market

Open the entry screen and select **Crypto** to use the 60 minute playfield, with
15-, 30-, and 60-minute prediction intervals. Oil and Weather are shown as
**Coming soon** and cannot open a prediction terminal. Use **Categories** in the
terminal header to return to the market list.

Oil has five planned crude types: WTI, Brent, Dubai, Oman, and Bonny Light. Its amber
card distinguishes it from Crypto's green background. Oil predictions are paused
until a verified, settlement-capable data feed is ready.
WTI and Brent have verified feed mappings. Dubai, Oman, and Bonny Light show
unavailable until a matching feed is connected. The category screen does not
request quotes while Oil is dormant. Development diagnostics can still exercise
the feed adapters. If the key or subscription
is missing, oil prices remain unavailable. The adapter expects minute updates and
rejects closed sessions and stale quotes during diagnostics. Old simulated bets
retain their original source. Crypto continues to use Coinbase prices when connected.

Your account balance is shared. Portfolio history identifies the category of each
prediction; choose a category to filter history and statistics. Log in or sign up,
then choose the category you want to play. No real money is used.

OilPriceAPI mode shows dated physical spot assessments for all five crudes. These series do not provide minute settlement benchmarks, so hourly oil predictions are unavailable; Crypto continues normally.
