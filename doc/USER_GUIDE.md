# Predict60 user guide

Predict60 lets you make crypto direction predictions with game credits. Prices and results use Coinbase proxies; no real money is traded.

## Start and sign in

For a hosted installation, open the HTTPS address supplied by your administrator.
You do not need to install Python or Docker on your own computer. New signups
require the secret signup code provided by the organizer, an 8–16-character
password, and a matching verification password. Show/Hide controls reveal or
conceal the signup code and password fields. Existing accounts can
log in without the code. Sign up or log in, then choose **Crypto** from the category screen. Players receive 1,000 contest credits each hour, resetting independently
at each GMT hour boundary. Accounts and saved predictions belong to that installation;
a separate local installation does not automatically share them.

For local use, run `python3 src/backend/server.py` from the project folder and open
http://127.0.0.1:8000. The default bind address remains local-only. Administrators
setting up a VPS should follow the [Docker deployment guide](../deploy/DOCKER.md).

Your balance and predictions survive browser refreshes and server restarts when
the installation retains its database. During a restart, wait for the site to
return and refresh your portfolio before retrying an uncertain submission.
Overdue settlements are retried when the server and price history are available.

The server needs internet access for live prices and settlement. Opening HTML
files directly or using static hosting alone does not provide a working terminal.

After the `p60` naming update, sign in again and reselect your theme. Existing
accounts and predictions remain in the retained database; do not create a new
account just because the browser asks you to sign in again.

## Change your password

While signed in, choose **Change password** from Markets, the terminal, or your
portfolio. Enter your current password, then a new password of 8–16 characters
and a matching confirmation. After success, the form clears and shows a
confirmation. Your current session stays signed in; all other sessions must log
in again with the new password.

An incorrect current password or mismatched confirmation leaves the password
unchanged. Too many password verification attempts temporarily block further
attempts; wait a minute before retrying. This form requires your current password;
self-service recovery for a forgotten password is not available.

Use **Log out** to end the current session and return to the welcome page. Logout
also completes when another tab has already ended that session.

## Read the terminal

Choose a coin using the icon grid beside the price. The default choices are BTC, ETH, SOL, XRP, DOGE, ADA, and LTC; administrators can change availability. Coin selection updates prices, chart, and market context. All coins share your account balance.

Selecting a coin immediately requests a current price and shows **Loading…** while it arrives. If no valid, recent quote is available, the price reads **Data Not Available**. The terminal retries automatically; you do not need to refresh or switch coins again. Historical candles never substitute for a current quote, and predictions remain blocked until the required price and benchmark data are ready.

The live price display updates every two seconds. Clocks and betting countdowns continue to update every second. Selecting another coin or reporting unavailable data updates the price state immediately.

Each UTC hour shows one 60-minute interval, two 30-minute intervals, and four 15-minute intervals. Select any card to inspect its benchmark and details in the ticket. Open cards accept predictions when data is ready. Upcoming and completed cards are read-only. A red dashed cursor shows the current UTC time across the chart and markets.

Up/Down percentages are heuristic model estimates, not calibrated odds. They also set simulated contract prices: 70% Up means an Up contract costs 0.70 credits. Percentages and prices change with spot, time remaining, and recent volatility. Upcoming cards hide percentages; completed cards show results when candle history is available.

The prediction pane shows the selected interval within its UTC hour, current spot and source time, distance from the benchmark, and the exact closing-price conditions for Up and Down. Completed intervals show their closing benchmark; upcoming intervals wait for their opening benchmark. Stale or disconnected prices hide the live comparison.

## Make a prediction

1. Sign in, select an open interval, and check that the status strip says data is ready.
2. Choose Up or Down and enter a budget from 1 to 1,000 credits within your available balance.
3. Review the contract price, fractional share count, exact cost, possible return, and potential profit.
4. Confirm before the betting countdown expires. Bets close 30 seconds before the interval ends to allow final processing.

Review updates live. Confirmation buys at the server's current model price within your budget, so the final contract count, cost, and possible return can differ from the displayed review. Check the saved prediction for executed terms. A prediction is saved only when the server accepts it; errors appear in the review.

The full bet amount is deducted. For example, 10 credits at 0.70 credits buys about 14.285714 shares. A win returns 14.29 credits, for 4.29 credits profit; a loss returns 0 credits and loses 10 credits. Winning payouts round up to the next hundredth of a credit. There are no demo fees.

## Results and portfolio

The opening benchmark is the close of the minute candle immediately before the interval begins. The closing benchmark is the close immediately before it ends. Up wins when closing is equal to or greater than opening; Down wins when closing is lower. This is a minute-close proxy, not a 60-second average or an official exchange settlement.

The terminal shows unsettled predictions and countdowns. Use the portfolio icon to open prediction history, filter All/Pending/Wins/Losses, and inspect cost, return, and profit/loss. An expired prediction may say awaiting settlement while price history is missing. Winning contracts credit 1 credit each once settlement completes.

Portfolio realized profit/loss counts only settled predictions. Pending committed funds are shown separately; they are not realized losses. Win rate includes settled orders only. Use Refresh settlements to request another check. Visible account pages also check every 15 seconds, and the server worker checks every 30 seconds. Overdue orders are retried after a server restart.

## History and display controls

Previous hour opens a completed hour. Next moves forward; Current hour returns to the live view. The UTC date helps distinguish days. Historical views disable orders, show the full-hour chart, and preserve the hour when switching coins. Missing history leaves affected results unavailable.

Pause freezes the chart and blocks order entry; it does not stop the market countdown. Resume restores rendering. Synthetic preview shows animated synthetic prices for exploring the interface and cannot place account orders. Reconnect returns to or retries the live feed.

The sun/moon button switches themes and saves your preference across tabs. On smaller screens, the ticket moves below the markets; scroll the timeline or coin strip horizontally to see all items.

## Troubleshooting

| Message or symptom | Action |
| --- | --- |
| Coins unavailable / terminal offline | On a hosted site, refresh and contact the administrator if it persists. For local use, start `python3 src/backend/server.py` and open the localhost URL. |
| Price feed disconnected or stale | Check internet access and use Reconnect; wait for a fresh live update. |
| Data Not Available | No valid current quote was received. Automatic retries continue; check internet access if it persists. Available chart history can still be viewed. |
| History or opening benchmark unavailable | The server automatically retries the exact minute using wider history windows and reuses matching cached history. If it still fails, wait for provider recovery and review a new prediction. Logging out does not repair missing provider data; orders stay blocked until the exact benchmark is available. |
| Chart paused / synthetic preview / historical market | Resume, reconnect to live data, or select Current hour. |
| Too late to place | Select an open interval and review a new prediction. |
| Insufficient credits | Reduce the budget and check pending commitments in your portfolio. |
| Site temporarily unavailable | Wait for the service to recover, then refresh. Contact the administrator if it remains unavailable. |
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

## Laptop and phone displays

On a laptop, the chart and the 60-, 30-, and 15-minute segment rows share one
hourly timeline. Compact navigation and cards leave more room for predictions.
On phone screens up to 600 pixels wide, the chart fits the screen and segments
stack by duration. Choose coins from the five-column icon grid in the live price
panel. Use **← Categories** in the top bar to switch market categories; the coin grid has no separate heading row. Each icon shows its ticker; the inner highlight marks the selected coin,
and the outer ring shows your hourly prediction direction.

Each card starts with a bold UTC time range, Up/Down model percentages and status.
The next row reads **benchmark → current price** (closing price for a completed
interval). The benchmark stays neutral; current prices are green above or equal
to it and red below it. **Open** is blue. At the lower right, a signed percentage
above a direction arrow shows the actual price movement from the benchmark;
this is different from the model probabilities. The dot sits above an Up arrow
or below a Down arrow. Stale, paused or disconnected live data clears that live
comparison instead of leaving a misleading price.

On narrow phones, model percentages wrap below the time range and status;
buttons retain a 44-pixel minimum touch height. Upcoming intervals and completed
intervals still missing an exact benchmark show only time, status and their
read-only action. Available completed intervals show the closing price and final
100%/0% result, rather than a live forecast.

Tap **Predict** on an open segment to open the prediction popup, select Up or
Down, enter a budget, and review before confirming. Tap **Result** on a closed
segment to see its outcome and your returns. **Details** describes an upcoming
segment. Popups scroll on short screens; use the close button or Escape to close
them. The hourly balance and last-hour results remain in the header. The top navigation bar stays visible while scrolling so credits and navigation remain accessible on phones and laptops.

On a phone, tap **Rotate** in the top title bar to request landscape view.
If the browser permits it, the page enters full screen and rotates. Tap
**Auto rotate** to release the orientation lock and leave full screen. On
browsers without automatic rotation support, follow the on-screen prompt to
turn the phone sideways and disable the phone’s rotation lock if necessary.
The button shows **Landscape** when the phone is already sideways.

## Hourly contests

The game uses **Hourly contest** only. Each user starts with 1,000 credits
per GMT hour across all instruments and intervals. Settled payouts refill the
balance and can be spent again that hour. Losses reduce the balance; the final
score is ending credits minus 1,000. Unspent
credits do not carry forward.

At HH:00 GMT the contest closes. Final winners and results are saved after all
predictions settle. Every player starts the next GMT hour with a fresh 1,000 credits.
If a price benchmark is unavailable, results wait while the new hour continues;
no winner is guessed. A trophy marked Winner appears in Last hour for finalized
first-place results, including ties. GMT is
UTC+00:00 year-round. The highest net tally wins, including when all tallies are
negative. Ties share first place; an empty hour has no winner.

Open **Contests & winners** to see your current tally, **Last hour**, and your
hourly gain/loss history. **Older hours** pages through all stored results;
use the GMT date/hour lookup to jump directly to an earlier hour. Pending results
are labeled provisional. Daily contests are disabled; old records are retained.
Only announced gift-card pools award prizes, subject to operator review.
