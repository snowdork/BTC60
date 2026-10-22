# Points contests and ad-funded prizes

Research date: October 19, 2026. This records research and the implemented points-contest baseline, not a promise
of advertising income or active valuable prizes. U.S. rules are an initial research
context; launch countries/states and participant ages remain undecided.

## Implemented now

The app includes UTC hourly contests with 1,000 credits per player each hour,
provisional leaderboards, immutable final rankings, shared first-place winners,
and prize records. Contest submissions reserve at most 1,000 credits per
instrument/interval in aggregate across both directions. Daily contests are disabled.

Settled payouts return to the hourly balance and can be reused that hour.
Final score is ending credits minus 1,000. Final rankings wait for all entries
to settle; the next GMT hour starts with 1,000 fresh credits independently of prior results.
Unspent credits do not carry forward. Current and recent periods plus upcoming
reserved pools appear on the contest page.

Operators can record funded gift-card pools before a contest starts.
Tied winners share the pool; remaining indivisible cents are assigned by
ascending account ID. Each award starts in review and can be approved, fulfilled,
or rejected using an audited local CLI. Rejected awards are not redistributed.
An empty contest has no winner. A contest with no pool awards recognition only.

A configurable direct-sponsor banner is implemented with plain text and an HTTPS
link, no third-party scripts or tracking. Programmatic ad-network integration,
provider payout APIs, email verification, and automated abuse/eligibility decisions
remain future work. Recording an award as fulfilled does not itself send a gift.

See [contest operations](CONTEST_OPERATIONS.md) for commands and launch settings.
The research below informs provider selection; it does not guarantee approval
or advertising income. Keep valuable prizes unconfigured until the operator has
settled eligibility, official terms, funding, and fulfillment arrangements.

## Ad strip recommendation

Start with one clearly labeled Advertisement/Sponsored banner below navigation,
separated from prediction buttons. Reserve responsive space so it cannot move
controls beneath a user's finger. Keep sign-in and prize-claim forms ad-free.
A direct sponsor buying a fixed daily/weekly slot is my recommended initial
experiment: the contracted fee is more predictable than unmeasured display RPM.
This is a business recommendation, not a verified sponsor offer.

Standard display ads may supplement sponsorship after network acceptance.
Google forbids incentivizing clicks/views on non-rewarded inventory. Do not use
“click to fund prizes,” extra entries for clicks, or points for banner views.
[AdSense program policies](https://support.google.com/adsense/answer/48182?hl=en).

Google's rewarded-ad rules prohibit direct monetary rewards including gift cards;
permitted indirect rewards have platform-use and non-transferability conditions.
Keep gift-card contest prizes independent of ad engagement; this separation does
not itself guarantee network approval.
[Rewarded-ad policy](https://support.google.com/admob/answer/7313578?hl=en).

The app's chart ticks and account polls are not ad impressions. Do not automatically
refresh AdSense units with those updates. Ads must be distinguishable from controls.
[Ad placement policies](https://support.google.com/adsense/answer/1346295?hl=en).

The existing Caddy content-security policy blocks third-party ad scripts/frames.
An actual integration needs a narrowly scoped CSP update, the provider's consent
requirements for target regions, a privacy notice, and ads.txt where required.
Keep the game functional when consent is withheld or an ad is blocked. Never
send account credentials, email addresses, or prediction history to ad scripts.

## Revenue scenarios, not forecasts

Use net publisher impression RPM, not advertiser CPM:

`monthly revenue = monetized banner impressions / 1,000 × net impression RPM`

The $1/$3/$5 inputs below are illustrative sensitivity assumptions, not researched
rates or income guarantees. Geography, fill, viewability, blockers, consent,
invalid-traffic deductions, and audience demand materially change results.

| Monetized impressions/month | $1 RPM | $3 RPM | $5 RPM |
| ---: | ---: | ---: | ---: |
| 30,000 | $30 | $90 | $150 |
| 300,000 | $300 | $900 | $1,500 |
| 1,000,000 | $1,000 | $3,000 | $5,000 |

One $5 award every hour costs $3,600 per 30-day month. A $25 daily award adds
$750, for $4,350 total. At an assumed $3 net RPM, prizes alone need 1.45 million
monetized impressions/month; with only 50% of net receipts allocated to prizes,
the requirement becomes 2.9 million. Hosting, fulfillment, fraud, tax/admin work,
and fulfillment costs must fit in the remaining allocation.

Google describes publisher revenue share as 80% after the advertiser platform
fee (about 68% when Google Ads buys the inventory). This is not an RPM guarantee;
do not subtract that share again if measuring net publisher RPM.
[AdSense revenue share](https://support.google.com/adsense/answer/180195?hl=en).

Measure a pilot's actual receipts and costs before promising recurring awards.
Reserve prizes before opening entries rather than relying on today's estimated
ad earnings to pay today's winners.

## Gift-card prizes

Tremendous is a candidate for gift-card delivery: its API supports reward
fulfillment, and its site says most rewards cost face value. Confirm contest
use approval, recipient geography, product availability, funding fees, and
commercial terms before integration. Start with reviewed manual fulfillment,
then automate with idempotent orders and delivery tracking.
[Tremendous gift-card API](https://www.tremendous.com/gift-card-api).

Gift cards are the only prize option for the current release.

## Prize launch decisions

Points-only branding does not settle legal classification when prizes have value.
Google's publisher restriction addresses games where value is paid or wagered
for a chance to win valuable prizes; obtain an assessment of the actual free-entry
mechanics before assuming unrestricted inventory eligibility.
[Google publisher gambling restriction](https://support.google.com/publisherpolicies/answer/10437963?hl=en).

The FTC distinguishes promotions and warns against purchase-required sweepstakes.
This does not classify price predictions as skill contests or establish compliance
across states. Have counsel review the target jurisdictions, whether participation
requirements create consideration, age/residency, scoring and ties, prize values,
deadlines, privacy, tax reporting, and claim rules before a valuable-prize launch.
[FTC advertising guidance](https://search.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business).

Next decisions: launch geography/age, UTC versus another contest timezone, daily
allocation and aggregate exposure, ranking/ties, guaranteed prize budget, and
gift-card provider selection.
