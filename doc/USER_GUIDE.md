# Predict60 user guide

Predict60 is a crypto direction game using game coins, shown as **C$** in the
HUD. Tickets and results also call these coins credits; C$ 1 equals one credit.
C$ is a game unit, separate from the USD market price. Start with **Crypto**;
Oil and Weather are marked **Coming soon**. Prices and settlement benchmarks use
Coinbase minute candles. Credits cannot be purchased or redeemed for cash.

## Start and sign in

1. Open the address supplied by your administrator.
2. Choose **Sign up** for a new account or **Log in** for an existing one.
3. Register with a name, email, and matching 8–16-character passwords, or select
   a verified Google account and enter a display name.
4. Open **Crypto**, choose a coin and interval, and inspect the current play.

No organizer code is needed by default. If an administrator enables invite codes,
registration shows an additional code field. Registration has no account cap or
per-network signup limits.

A Google account with the same email as an existing password account must be
linked: sign in to the existing account, then complete the Google-link step.
Google-only accounts return using Google. Password registration checks email
format but does not verify mailbox ownership.

Each player receives **1,000 contest credits every GMT hour**, shared across all
coins and intervals. Accounts and predictions belong to the installation where
you registered; local and VPS databases are separate. Refreshing or restarting
the app preserves them when its data volume is retained.

For a local installation, use the URL printed by
[local setup](../deploy/SETUP.md#local-testing). The local Docker port is often
18085 when a VPS profile also exists. Opening exported HTML files alone cannot
provide accounts, live orders, or settlement.

## Read the terminal

One integrated, pinned HUD contains the title bar, time intervals and coin
selector. It groups the Predict60 title, one illuminated player/coin
readout, view controls, local/UTC clocks, and account menu. The mini readout
combines your name and C$ balance with a steady glow, without flashing. The player name displays at most ten
characters; hover it to see the full saved name. The **C$** balance is your
available contest balance and updates when predictions or settlements change it.
The clock sits immediately beside the player mini HUD on the left. Local time, using your browser timezone,
appears above UTC in the same font. Both follow current time even when you
browse a historical chart. Fixed-width digital digits update without a clock
icon, flip animations or layout shifts. The layout uses two
rows on smaller screens.

Use **Interval / Hour** in the HUD to choose your view. Choose a coin and
5-, 15-, 30-, or 60-minute play using the controls within the same pinned HUD.
The selected coin's icon, USD price and hourly dollar/percentage movement are
at the top-left of the graph area in both views. The former Current time /
Prediction cutoff legend below the coin controls has been removed; the graph's
time and cutoff markers still work. Open **Menu** for history, contests, rules,
account actions and navigation. The theme button switches light/dark mode.

The default coins are BTC, ETH, SOL, XRP, DOGE, ADA, LTC, LINK, AVAX, and SUI.

Each compact segment contains:

| Field | Meaning |
| --- | --- |
| Coin, interval, status | The instrument and exact UTC time you are inspecting. |
| Live price / Closing price | The current usable quote, or the confirmed close for a completed play. |
| Starting price | The exact opening benchmark used to determine the result. |
| Change from start | Actual price movement relative to that benchmark. |
| Up % / Down % | Model estimates for the interval outcome, separate from actual price movement. |
| Predict / Result / Details | Review an open play, inspect its result, or view an upcoming play. |
| Countdown | Time until the interval opens or ends; betting closes five seconds before its end. |

The live/closing price is prominent; the starting price is smaller. Up is green,
Down is red, and Predict is highlighted. Saved prediction tags show the executed
side, credit amount, and execution percentage. Completed cards retain their date;
live and upcoming cards use a compact time display.

**Outcome estimates and purchase quotes are different values.** The Up/Down
percentages estimate outcomes from price, time and volatility. The order review
shows the actual contract quote and possible return. Do not infer your execution
price from a displayed probability.

Price displays and countdowns update about once per second. **Loading…** or
**Data Not Available** means a usable current quote has not arrived. Available
history remains visible, while stale or incomplete data blocks new predictions.

## Interval and Hour views

**Interval** is the default. It shows one selected play and its price history.
Use the graph arrows to move by one interval; **Back to live** resumes the current
play. Changing duration or coin keeps the chosen view.

**Hour** shows one 60-minute, two 30-minute, four 15-minute, and twelve 5-minute
segments. Selecting Hour clears previous duration/card highlights. Single-click
a card to choose its exact time without changing views. Select Interval to
inspect it, or double-click the card body to open it directly. Double-click the
Interval card body to return to Hour. Buttons retain their normal actions.

In Hour, the graph arrows move by UTC hour and **Back to now** returns to the
current hour. The five-minute row scrolls horizontally; **Now** finds its active
card and **Select** chooses that duration. Past intervals are read-only, and
upcoming intervals have no opening benchmark until they start.

Both graphs have black backgrounds in either theme. Hour uses a white price
line; Interval uses its duration color: purple for 60 minutes, blue for 30, pink
for 15, and amber for 5. Green/red candles and the compact arrows beneath them
show completed minute movements. A current minute has an amber marker; missing
history stays unavailable. Minute candles are data resolution, not one-minute
tradable plays. Orange dashed markers indicate the five-second betting cutoff.

Recorded second-by-second prices survive coin navigation and page returns.
Minute backfills reconnect longer absences when history is available. Missing
history is never replaced with invented observations or settlement values.

## Make a prediction

1. Choose an open play with a fresh price and starting benchmark.
2. Use **Predict** to open its ticket, or tap **Up % / Down %** to preselect a
   direction. These buttons open a review; they do not immediately place an order.
3. Enter **1–1,000 credits**, within your remaining hourly balance.
4. Check the side, interval, contract quote, shares, cost, possible return and
   potential profit. The review remains live as the market changes.
5. Confirm before the final five seconds. Check the saved prediction for its
   executed terms.

The server validates the current market again at confirmation. The executed
contract count and return can differ from an earlier review. If a submission
times out, refresh your account/history before retrying an uncertain order;
network retries are not proof that a new order is needed.

For example, 10 credits at a quote of 0.70 credits buys about 14.285714 shares.
A win returns 14.29 credits; a loss returns zero. Winning payouts round upward
to the next hundredth of a credit. Settled returns can be reused during the same
hour, subject to the 1,000-credit limit per prediction.

## Results and portfolio

The starting benchmark is the minute close immediately before the interval
begins. The closing benchmark is the minute close immediately before it ends.
**Up wins when closing is at least starting; Down wins when closing is lower.**
Missing exact candles leave the result pending until history can be recovered.

The terminal shows pending predictions. Open prediction history from the menu
or portfolio control to filter All/Pending/Wins/Losses and inspect cost, return
and profit/loss. Realized profit/loss and win rate use settled predictions only;
pending credit commitments are shown separately.

Account pages check settlement every 15 seconds while visible, and the server
worker retries every 30 seconds. Restarting the app retries overdue predictions.
Use **Refresh settlements** for another check. Missing market data can delay a
result; it does not turn a pending prediction into a loss.

## Hourly contests

At every GMT hour boundary your hourly allowance resets to 1,000 credits,
independently of older pending settlements. Late payouts belong to their original
hour. Contest scores reflect settled net profit/loss; pending entries keep an
hour provisional. Final winners appear only after all of its entries settle,
and equal scores share the same rank.

The terminal's previous-hour summary and contest pages show your standing.
Any configured gift-card prize remains subject to organizer review; automated
external prize delivery is not implemented.

## Change your password

While signed in, choose **Change password**, enter your current password, and
confirm a new 8–16-character password. Show/Hide controls let you inspect the
entry. Success keeps the current session and revokes other sessions. An incorrect
current password leaves credentials unchanged. Google-only users should continue
using Google; forgotten-password recovery is not currently available.

Use **Log out** to end the current session. If another tab already ended it,
logout still returns to the welcome page.

## Laptop and phone displays

Cards place prices and prediction controls together when space allows and stack
them on narrow screens. Interactive controls retain at least 44-pixel touch
sizes. Coin controls wrap to fit; five-minute cards scroll rather than shrinking
all twelve into the viewport. Phones may wrap the 15-minute row, so its card
markers use their own interval scale rather than the graph's full-hour scale.

Use the sun/moon control to switch themes. The menu contains market navigation,
prediction history, contest results, logout and phone rotation controls. Graphs
retain their black backgrounds. For a small phone, horizontal card scrolling and
rotation are available without changing your selected coin or prediction.

## History and display controls

Historical cards include dates to distinguish hours across midnight. Switching
coins retains the viewed hour. Use Back to live/Back to now before making a new
prediction. A completed card's Result action remains available when the live
feed disconnects; an open play requires fresh data before Predict is enabled.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Invalid request origin | Use the configured address exactly, including http/https and port. For localhost signup/login, ask the administrator to allow `http://localhost:8085` and recreate the app container; see [Docker origin configuration](../deploy/DOCKER.md). |
| Organizer code requested | This installation enabled invite codes. Obtain its code from the organizer. |
| Signup is currently unavailable | Ask the administrator to check the optional invite-code configuration for this deployment. |
| Price unavailable, stale or disconnected | Wait for automatic retries and a fresh quote. Check your connection if it persists. |
| Starting benchmark unavailable / awaiting settlement | Exact minute history is missing; the server retries. Logging out or creating a new account does not repair provider data. |
| Too late to place | Choose a currently open interval and review a new prediction. |
| Insufficient credits | Reduce the stake or wait for current-hour returns or the next hourly reset. |
| Uncertain submission after a timeout | Refresh history and inspect saved predictions before trying again. |
| Site unavailable after maintenance | Wait for the app to return, then refresh. Contact the administrator if it persists. |

Administrators: use [setup](../deploy/SETUP.md) and
[database maintenance](DATABASE_MAINTENANCE.md). A database reset removes accounts
and game history; normal upgrades use migrations and retain existing data.
