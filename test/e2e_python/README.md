# Python Playwright browser tests

The account tests mirror all 17 scenarios in `../e2e/accounts.spec.ts`.
Another 13 scenarios cover terminal navigation. Each scenario runs on desktop
Chromium and emulated Pixel 7, for 60 checks in total. The suite uses pytest and
Playwright's synchronous Python API; Node.js is not required.

From the repository root, install the Python test dependencies and browser:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r test/e2e_python/requirements.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m pytest test/e2e_python
```

The requirements include the application's runtime dependencies. On a Linux CI
image without browser libraries, use `playwright install --with-deps chromium`
with the same Python interpreter during image setup.

Run a subset, inspect a browser, or produce a JUnit report:

```bash
.venv/bin/python -m pytest test/e2e_python -k desktop
.venv/bin/python -m pytest test/e2e_python -k mobile
.venv/bin/python -m pytest test/e2e_python/test_accounts.py
.venv/bin/python -m pytest test/e2e_python/test_terminal.py
.venv/bin/python -m pytest test/e2e_python -k password --headed
.venv/bin/python -m pytest test/e2e_python --junitxml=test-results/e2e_python/results.xml
```

The local `pytest.ini` limits collection to this suite and enables failure
screenshots and retained failure traces. The suite runs sequentially with no
automatic retries. Traces, screenshots and failed-server logs go under
`test-results/e2e_python/`, which is ignored by Git. Inspect a trace with:

```bash
.venv/bin/python -m playwright show-trace path/to/trace.zip
```

`conftest.py` starts the shared Python launcher at `../e2e/server.py` for every
test, with a fresh temporary SQLite database and an OS-assigned loopback port.
It sanitizes deployment settings, checks `/healthz`, and removes its server and
temporary data at teardown. The child server uses the running Python
interpreter; `P60_E2E_PYTHON` can select another. Loopback sockets and browser
subprocesses must be allowed by the execution environment.

`helpers.py` provides API account setup, UI login assertions and local request
restrictions. The real account API, cookies, CSRF and SQLite session handling
remain in use. Provider calls are blocked and the external Google Identity
widget is stubbed. The account tests cover password accounts. Google
authentication, live prices, prediction submission and settlement are outside
this suite. The existing TypeScript suite and `scripts/run_tests.py` remain
separate commands.

`test_terminal.py` covers entry through Crypto, dormant Oil/Weather categories,
the player HUD and clocks, coin preference persistence, all four play durations,
Interval/Hour switching, single/double-click card navigation, completed/upcoming
intervals, previous-hour history and return to Live, theme persistence, the
navigation menu, and recovery after catalog failure.

`market_data.py` supplies fixed Coinbase-style ticker, candle, pricing-history
and WebSocket responses. Accounts and the coin catalog continue to use the real
local API. Browser time is fixed at November 15, 2026, 12:17:30 UTC, while server
time is unchanged. These fixtures test chart/navigation behavior; order and
settlement tests will require coordinated browser/server time and backend
provider fixtures. Unexpected browser WebSockets are intercepted without
connecting to remote hosts.
