Architecture and control flow
=============================

Entry and account lifecycle
---------------------------

``src/backend/server.py`` serves an explicit public file allowlist. Guest requests for the
terminal or categories redirect to welcome. A valid saved session redirects
welcome to categories. ``auth.js`` submits login/signup and navigates successful
requests to categories; ``account.js`` owns account snapshots, text-only username
rendering, CSRF headers, protected controls, and logout navigation.

``community.js`` polls aggregate user counts every thirty seconds while visible.
The server counts distinct accounts with unexpired sessions seen within five
minutes. Multiple tabs and sessions do not inflate the account count.

Predictions and settlement
--------------------------

``bootstrap.js`` waits for authentication, loads category/instrument metadata,
then loads ``market-model.js``, ``minute-trend.js``, ``segment-card.js``,
``app.js``, ``market-detail.js``, and ``btc-chart.js`` in that order. Oil and Weather
cannot enter the terminal while marked Coming soon. ``coins.js`` validates and freezes the browser catalog.
``btc-chart.js`` switches quote transports, retains exact minute history, and
ignores superseded asynchronous history responses. Browser times use milliseconds.

``market-model.js`` computes display quotes and readiness. ``app.js`` coordinates
selection, review and pending predictions. The server validates all executable
orders again, including the five-second cutoff, CSRF, budget and authoritative
provider quote. Database transactions protect balance changes and duplicate
request IDs. Prediction-source snapshots preserve original settlement semantics.

``app.js`` renders upcoming/pending cards with placeholders for unavailable data.
Its segment node index supports in-place updates; unchanged refreshes do not
rewrite price text, direction classes or accessible movement labels.
``responsive.css`` owns the final segment layout and phone touch sizes.

``candle_close`` reuses exact same-product minute history before making a
provider request. ``exact_candle_close`` validates cache and provider rows through
one shared path. Three cold-read attempts widen the requested history window
without changing the exact target minute. Missing or malformed history remains
retryable; permanent provider errors are not repeatedly requested. Recovery never
replays an order or changes session credentials. Exhausted retries log product
and target minute, without account credentials.

The settlement loop retries missing benchmarks. A nonblocking lock prevents
concurrent settlement passes; persisted settlement rows prevent duplicate credits.
No synthetic preview price can execute a new order. OilPriceAPI physical spot
assessments lack the exact minute benchmarks required by existing orders.

Oil and Weather remain dormant: their category cards cannot open a terminal and
server-side validation rejects new orders. Oil adapters remain available for feed
diagnostics. ``weather.py`` uses signed temperatures and nonnegative
wind, UTC hourly boundaries, pinned stations, and actual observations no older
than ten minutes. Missing or conflicting latest observations defer settlement.
The positive-price financial log-return model cannot be applied to weather.

Chart views and compact plots
-----------------------------

``market-detail.js`` owns the Interval/Hour view state and defaults to Interval.
The title-bar controls and delegated card-body ``dblclick`` handlers call the
mode switch. Single-click duration choices and ``market-interval-select`` events
change the interval without changing modes. Double-clicking an Hour card resolves
its exact market start/duration; double-clicking an Interval card returns to Hour.
The handlers ignore buttons, links, form fields, and editable content.
Entering Hour clears its duration and card highlights; ``market-overview`` tells
``app.js`` to clear the explicit card selection and render the overview.

A segment click emits ``market-interval-select`` with minutes and the absolute
``startsAt`` in milliseconds. ``market-duration-change`` refreshes the Hour graph's
cutoffs and clears an obsolete card highlight when only a duration was chosen.
The selected interval is inspected when the user selects Interval or double-clicks
the card. ``market-hour-select`` carries an absolute UTC hour in milliseconds
when a browsed past interval returns to Hour; ``btc-chart.js`` validates the hour
boundary and retains the existing current-hour limit. The Hour grid records an explicit ``id:startsAt`` selection separately from the ticket's
automatic current-market fallback, so a background refresh does not restore an
unrequested highlight. Changing the instrument/hour clears that grid selection.

``responsive.css`` defines a shared ``--price-chart-height`` of 180 pixels,
reduced to 150 pixels at viewport widths of 700 pixels or less. Hour and Interval
use this value for their plots; the Hour time cursor inherits the same height.
Time labels follow a compact, 16-pixel minute summary beneath each plot.

``minute-trend.js`` validates the same OHLC fields as ``minutePlot`` and renders
green up/red down arrows at completed candles' midpoints. Unchanged closes count
as Up; current, missing, and upcoming minutes never receive a completed direction.
It caches candle identity, interval bounds, minute, and historical state. Both
views call the shared renderer, which loads before them through ``bootstrap.js``
and is included in the server's public allowlist and static export.

Graph surfaces remain black. Hour has a white trace and separate green/red
candles. Interval uses its duration color for the trace, grid, and endpoint.
Wrapped and scrolling interval cards retain their local current-time cursors.

Loops, guards, and failure handling
-----------------------------------

The API pages list each named procedure's own branches and loops with source
lines. Nested helpers have separate entries. Validation guards reject unsupported
providers, stale data, invalid money and unknown instruments. Polling guards skip
hidden documents and overlapping requests; transport errors preserve retry paths.
Catalog migrations seed missing data and record one-time selection changes.
Migration 6 adds/enables LINK, AVAX and SUI within the ten-instrument category
limit, preserving saved sources and custom coins. Later administrator edits are
not reapplied on subsequent startups.

Operations
----------

``p60_logging.py`` serializes log writes/rotation with a filesystem lock and
moves backup files in descending order. ``scripts/server_control.py`` discovers
only processes belonging to the checkout. Watchdog loops stop on the explicit
stop marker and restart unexpected child exits. Maintenance commands use a
nonblocking database lock; reset creates a backup before deleting account data.
``scripts/build-static.py`` copies the same public frontend list used by the
server, plus approved artwork, into ``dist/``. Documentation is separate from
public app assets and must never expose databases or credentials.
