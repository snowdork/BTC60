# Contest and sponsor operations

## Deploy and rules

Hourly contests close at each HH:00 GMT. Daily contests close at 00:00 GMT,
when the next daily contest opens. GMT is fixed UTC+00:00, with no daylight-saving
shift. Existing UTC timestamp calculations already use these exact boundaries.
Closing a contest ends its scoring period; final winners still wait for settlement.

Back up before deploying, then rebuild/restart the app. Startup adds contest and
prize tables without rewriting practice balances or importing historical entries.
The Docker image includes `contests.py` and `scripts/contest-admin.py`.

Daily contest allowance: 10,000 credits, renewed at 00:00 GMT. This is a fixed
spending allocation: settled returns affect rank but cannot be spent again.
The 1,000-credit instrument/interval aggregate limit counts both sides and all
submissions. Practice retains separate funds. SQLite immediate transactions
serialize reservations, settlement, finalization, and administrative changes.
Run one app process against one database.

Scores use settled net credits; pending results remain provisional. The highest
score wins even if negative. Ties share first rank. Finalization runs with the
settlement worker and is idempotent. Missing history delays finalization until
available; no timeout/void behavior is implemented. End-boundary ownership uses
`ends_at - 1`: an interval ending at 00:00 counts toward yesterday. The displayed
rule version is `utc-net-credits-v1`; change the version and communicate rules
before altering future contest behavior.

## Sponsor strip

Set these environment variables, then recreate the container:

```dotenv
P60_SPONSOR_NAME=Your contracted sponsor
P60_SPONSOR_URL=https://sponsor.example.com/
P60_SPONSOR_MESSAGE=Today's sponsor
```

```bash
docker compose up -d
```

The strip renders on the welcome, category, terminal, history, and contest pages.
It is clearly labeled Advertisement, uses plain text and a validated HTTPS link,
and does not execute third-party scripts or refresh with market ticks. Missing
or invalid settings hide the strip. No sponsor is configured by default.
The link uses `sponsored noopener noreferrer`. This supplies placement, not sales,
viewability measurement, billing, or ad-network integration. Agree on sponsor
terms and fund prizes separately. Ads never affect eligibility or scoring.

## Reserve a prize pool

Only configure valuable prizes after funding and eligibility/official terms are
ready. The CLI trusts a local operator's funding reference; it does not verify a
bank balance, call a provider, purchase a gift card, or send a notification.
Use the correct `PREDICT60_DB` when running outside Docker. No web admin endpoint
is exposed. Restrict shell/Docker access to trusted operators.

Choose an aligned future UTC timestamp. The following example uses a placeholder;
replace it with a real future timestamp and accurate provider/eligibility details:

```bash
docker compose exec app python3 scripts/contest-admin.py reserve \
  --period daily --start FUTURE_UTC_TIMESTAMP \
  --kind gift_card --amount 2500 \
  --description 'USD gift card pool; replace with provider, region, eligibility and redemption terms' \
  --funding-reference 'Internal reserve reference'
```

Gift cards are the only supported prize. Amounts are integer USD cents: 2500
means a $25 total pool. `--kind gift_card` is optional and remains accepted for
existing commands. Use `--period hourly` for hourly pools. One pool can be
reserved per contest, before it starts; it cannot be replaced through the CLI.
Future reserved pools appear in the contest period selector. No pool means
recognition-only winners. No entries means the pool is unawarded.

Tied first-place winners divide the pool evenly. Remaining cents go in ascending
account-ID order. A pool with fewer cents than winners leaves some tied winners
with no prize record; disclose this before entry. Prizes are not automatically
reallocated if a winner fails eligibility review. Publish these rules rather
than promising every tie a full face-value gift.

Existing unsupported prize records are preserved for audit on upgrade, but are
not displayed, allocated, or processed. New reservations and awards must be
gift cards, including on databases created by earlier versions.

## Review and fulfill

```bash
docker compose exec app python3 scripts/contest-admin.py list
docker compose exec app python3 scripts/contest-admin.py update PRIZE_ID \
  --status approved --note 'Eligibility and recipient verified under published rules'
# Arrange the gift card with your provider, then record its reference:
docker compose exec app python3 scripts/contest-admin.py update PRIZE_ID \
  --status fulfilled --note 'External delivery reference'
```

Awards start in `review`; allowed transitions are review → approved/rejected and
approved → fulfilled/rejected. Exact repeats are idempotent; a different note on
an already-applied status is rejected. Fulfilled/rejected are terminal states.
Private audit notes and funding/delivery references never appear in the player
API. No redemption code should be put in a public prize description. `list`
contains private operational data; do not share its output publicly.

For review failures, use `--status rejected` and a clear private reason. Changing
status does not send email or automatically issue, revoke, or redistribute gift cards.
Keep the provider's delivery receipt and the contest audit records together.
Use an external claim/recipient verification workflow until an approved account
verification and provider integration is built. Ordinary signup is not verified
identity, and multiple-account prevention is not implemented.

## Before valuable-prize launch

The shipped default is a free points game with recognition-only contests. Configure
jurisdiction, age/residency, identity verification, published prize terms, dispute
handling, taxes, and fraud controls for your actual audience. Network acceptance
and provider commercial approval are not established by this implementation.
See [the research](CONTEST_REVENUE_PLAN.md) and [test guide](TEST_GUIDE.md).
