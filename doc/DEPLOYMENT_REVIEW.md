# Deployment readiness review — October 25, 2026

The current source passes local regression checks for a single-instance VPS
installation. Actual VPS configuration, capacity, public HTTPS, and container
startup still need verification on the deployment host. No deployment was made.

## October 25 maintenance update

The segment controller and responsive styles are consolidated; unavailable
pending/upcoming data is omitted rather than hidden. Benchmark reads reuse exact
cached minutes, retry wider windows and validate malformed/truncated provider
responses. Missing exact data still blocks execution; no order replay or session
replacement is added. Maintenance-script source documentation now passes.

The latest local run passes all **240 tests**, with mocked providers and temporary
databases. Phone/laptop segment fixtures were inspected; these checks do not
establish live order recovery or production capacity. See
[test results](TEST_RESULTS.md) and [performance review](VPS_PERFORMANCE.md).
Apply backend changes by restarting the selected runtime or rebuilding its Docker
image. Source is served from `src/frontend/`; the regenerated `dist/` is a static
export. The ten-coin expansion uses one-time catalog migration 6; no data reset is
required. Saved accounts/bets and custom coin selections are preserved.

## Corrections completed

| Finding | Correction |
| --- | --- |
| The browser subtracted all earlier stakes in a segment from its 1,000-credit cap, conflicting with the per-prediction limit. This also scanned the entire account history during live quote updates. | Each order is now limited by the hourly balance and the 1,000-credit per-prediction cap. The calculation is constant-time; previously committed credits are already reserved by the server wallet. A regression covers additional predictions after winnings refill the balance. |
| The bootstrap error handler referenced the removed `hour-remaining` element, throwing before showing recovery controls. | Removed the reference. Bootstrap tests now return null for IDs absent from the actual terminal page, so removed-element regressions cannot silently pass. |
| Prediction creation queried its freshly generated ID twice and retained an unreachable mode branch. | Reuse the generated ID for the prediction, provider snapshot, and contest entry inside the same transaction. Existing rejection rollback and idempotency checks remain. |
| The test reporter counted zero JavaScript tests with Node's TAP reporter. | It now parses both TAP and spec summaries; a regression checks failed/skipped counts too. |
| Removed prediction-pane sections still had obsolete CSS and an unused interval-cap constant. | Removed the unused styles and constant, and refreshed the tracked static export from root sources. |
| Docker ignored key files and account data but did not exclude local credential, agent, and editor directories. | Added `.aws`, `.agents`, `.codex`, `.openai`, `.vscode`, and `.venv` to `.dockerignore`. The Dockerfile still copies an explicit set of application files. |

## Verification

`python3 scripts/run_tests.py` completed with **180 passed, zero failed**:
88 JavaScript tests, 77 Python application tests, and 15 Python script tests.
HTTP providers are mocked by the regression tests; these are not live provider
or VPS capacity measurements.

Also checked:

- Shell syntax for every deployment and restart shell script.
- `systemd-analyze verify` on the checkout service rendered for this workspace.
- Both Compose files parse as YAML. This does not substitute for Docker's
  configuration validation or an image build.
- Literal terminal DOM references resolve to IDs in `index.html`.
- Static export regenerated successfully; `git diff --check` passes.

Docker and Caddy executables are unavailable in this environment. No container
image build, Caddy configuration validation, remote host inspection, production
load test, or public HTTPS smoke test was performed.

## Remaining performance limits

1. `Handler.account()` returns complete prediction history on every account or
   settlement refresh. The browser polls while active, so both response size and
   rendering work grow with an account's history. Add paginated history and a
   small current-hour/pending snapshot before histories become large.
2. `contests.dashboard()` builds complete standings for each selected period
   before limiting displayed leaders. For high participation, calculate ranks
   and fetch the caller, winners, and a limited leaderboard in SQL.
3. Slow providers occupy request slots. Keep one application instance per SQLite
   database and the existing concurrency bound; measure before tuning it. Watch
   response latency, 503s, CPU, memory, disk usage, SQLite contention, provider
   throttling, and settlement lag. Current tests do not establish a safe user count.
4. Styling remains split across several stylesheets with responsive overrides.
   The known removed-pane rules were cleaned up; a broader consolidation should
   be backed by browser screenshots across the laptop and phone breakpoints.

## VPS rollout checks

1. Preserve the current database with `scripts/database.py backup`, copy the
   backup off-host, and retain the previous application version/image for rollback.
   Follow [Docker operations](../deploy/DOCKER.md) or
   [systemd operations](../deploy/README.md), matching the existing deployment.
2. Configure the actual public origin/domain, a private signup code, database
   path/volume, and proxy trust for that operating mode. Keep environment files
   private. Do not run Docker and the host service against the same database.
3. For Docker, run `docker compose config --quiet` and build/start on the host.
   The supplied startup/restart scripts check readiness. For systemd, verify the
   installed service and its environment, then use systemctl for the lifecycle.
4. Check `https://YOUR_DOMAIN/healthz`, signup/login, password change, a prediction,
   segment settlement, final winner display, and the next hour's fresh 1,000
   credits. Missing old benchmarks must not prevent the next hour from starting.
5. Check logs, crash recovery, persistent data after restart, and an actual backup
   restore before treating the rollout as complete. Arrange recurring off-host
   backups; the Compose deployment does not schedule them automatically.
6. [TODO.md](../TODO.md) records a previously committed OilPriceAPI key. Confirm
   revocation and replace it before using that provider. Oil and Weather remain
   disabled for new predictions; this review did not rotate external credentials.
