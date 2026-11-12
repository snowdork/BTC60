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

Choose a coin in the selector below the title bar. The default catalog enables
BTC, ETH, SOL, XRP, DOGE, ADA, LTC, LINK, AVAX, and SUI; administrators can change
availability. Coin selection updates the price, both charts, and prediction
context. All coins share your hourly contest balance.

The title bar shows the P60 logo with Predict60 beneath it, the selected coin's
icon and USD price, and the dollar and percentage change for the displayed UTC
hour. The hourly change compares the current price with the exact opening
benchmark; past hours use their closing price. Green means up or unchanged and
red means down. If the quote or opening benchmark is unavailable, the change
stays unavailable. Credits and UTC/local clocks are also in the title bar.

Price displays refresh at most once per second; clocks and betting countdowns
update every second. Switching coins shows **Loading…** immediately. If no valid
recent quote arrives, the price reads **Data Not Available** and retries
continue automatically. Historical candles do not substitute for a current
quote, and orders require both a fresh price and an exact opening benchmark.

The title-bar controls are **Interval** followed by **Hour**. Interval is the
default and shows one 5-, 15-, 30-, or 60-minute play. The arrows beside its graph
move by one interval; **Back to live** resumes the current interval.

Hour shows one 60-minute interval, two 30-minute intervals, four 15-minute
intervals, and twelve 5-minute intervals. Switching to Hour clears the duration
and segment selection highlights. Clicking a segment highlights its time and
duration without changing views. Select **Interval** to inspect that chosen
segment. You can also **double-click the card body or time range** to open that
exact interval directly. Double-click the Interval card to return to Hour; when
browsing a past interval, its containing UTC hour opens. Buttons and other
interactive controls keep their normal actions and do not trigger this shortcut.

Single-click selections and duration buttons keep the current view. Use the
**Interval / Hour** controls or the card double-click shortcut to switch views.
In the five-minute row, **Now** scrolls to the current
card and **Select** chooses that duration without leaving Hour.

Both graphs have black backgrounds in either theme, green up candles, red down
candles, and alternating red/yellow dotted current-time markers. Hour has a white price line. Interval's
line, grid, and endpoint use its duration color: purple for 60 minutes, blue for
30, pink for 15, and amber for 5. Orange dashed markers indicate the prediction
cutoff, 30 seconds before each interval ends.

Both plots use a compact height: 180 pixels on desktop and 150 pixels on phones.
A compact row beneath each graph shows green up/red down arrows for completed
minute candles. Each arrow aligns with its candle and compares the minute's
close with its open; unchanged closes count as Up. The current minute uses an
amber dash, and missing/upcoming minutes stay neutral. Hover for the UTC minute
and movement. The row takes 16 pixels; Up/Down model estimates remain in the
chart header.

Model percentages are uncalibrated estimates and set simulated contract prices:
70% Up means an Up contract costs 0.70 credits. Percentages change with price,
time remaining, and recent volatility. Available completed intervals show
confirmed results; upcoming or missing-data fields use placeholders.

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

In Hour, the graph arrows navigate previous/next UTC hours and **Back to now**
returns to the live hour. In Interval, they navigate individual plays. Dates
help distinguish intervals across midnight. Switching coins preserves the
hour context. Past intervals are read-only; missing history leaves their
benchmarks or results unavailable. Time navigation does not switch views.

The sun/moon button switches themes and saves your preference across tabs.
Use **Menu** for categories, prediction history, contest results, logout, and
phone rotation controls. Price and credits stay visible while the playfield
scrolls.

## Troubleshooting

| Message or symptom | Action |
| --- | --- |
| Coins unavailable / terminal offline | On a hosted site, refresh and contact the administrator if it persists. For local use, start `python3 src/backend/server.py` and open the localhost URL. |
| Price feed disconnected or stale | Check internet access and wait for the automatic retry and a fresh live update. |
| Data Not Available | No valid current quote was received. Automatic retries continue; check internet access if it persists. Available chart history can still be viewed. |
| History or opening benchmark unavailable | The server automatically retries the exact minute using wider history windows and reuses matching cached history. If it still fails, wait for provider recovery and review a new prediction. Logging out does not repair missing provider data; orders stay blocked until the exact benchmark is available. |
| Historical market | Use **Back to now** in Hour or **Back to live** in Interval to return to the current market. |
| Too late to place | Select an open interval and review a new prediction. |
| Insufficient credits | Reduce the budget and check pending commitments in your portfolio. |
| Site temporarily unavailable | Wait for the service to recover, then refresh. Contact the administrator if it remains unavailable. |
| Awaiting settlement | Keep the server running with internet access; missing candles are retried automatically. |

For setup and checks, see [README.md](../README.md). For backups and database maintenance, see [Database maintenance](DATABASE_MAINTENANCE.md). A database reset removes accounts and predictions; it is not a routine troubleshooting step.

## Choose a market

Open the entry screen and select **Crypto** to use the 60 minute playfield, with
5-, 15-, 30-, and 60-minute prediction intervals. Oil and Weather are shown as
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

The coin selector and 60/30/15/5-minute controls remain above the playfield. The
coin selector uses two rows of five on smaller screens. The active coin has a
blue outline. Green/red outer rings indicate your saved pending Up/Down
predictions for that coin and hour; these are separate from the current duration
selection highlight.

In Hour, the graph and the 60/30-minute rows share a horizontal time axis. The
15-minute cards share it on wide screens and wrap into two rows on phones. The
five-minute cards scroll horizontally. Wrapped or scrolling intervals have a
moving time marker inside the active card; it need not line up with the Hour
graph's marker. Markers span the full graph or card height and hide in historical
views.

Graph backgrounds remain black when a play completes or is upcoming. Card
surfaces describe state instead: live cards use their duration tint, completed
cards are light gray, and upcoming cards are light yellow. A confirmed Up/Down
result has a green/red arrow in the card heading. Missing settlement candles do
not produce a result arrow. Hour cards place the coin icon below the UTC time.

Cards show starting and live/closing prices, the actual percentage move from
the starting price, model estimates where available, and saved bet amounts with
their executed percentage. The actual movement is not a probability. Stale,
paused, or disconnected live quotes clear the live comparison; confirmed closes
remain historical. Missing values use placeholders.

Both charts retain one observed price per second for up to two hours per coin
while the terminal is open. That detail survives minute-history refreshes,
view changes, coin changes, and hour rollover. Earlier history uses minute
closes. Missing observations leave gaps, and minute closes remain the settlement
reference.

Tap **Predict...** on an open segment to open the prediction popup, select Up or
Down, enter a budget, and review before confirming. **Result** shows a completed
play; **Details** describes an upcoming one. Popups scroll on short screens and
close with the close button or Escape. The top title bar keeps credits and
navigation accessible. Pending predictions, market status, and last-hour contest
results appear below the playfield.

On a phone, open **Menu → Rotate** to request landscape view. If the browser
permits it, the page enters full screen and rotates. **Auto rotate** releases
the lock and leaves full screen. Otherwise follow the prompt to turn the phone
sideways and disable its rotation lock. The button reads **Landscape** when the
phone is already sideways.

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
