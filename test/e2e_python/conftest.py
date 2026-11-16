"""Isolated application processes and desktop/mobile Playwright fixtures."""

from collections.abc import Iterator
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
from urllib.request import ProxyHandler, build_opener

from playwright.sync_api import BrowserContext, Page, Playwright
import pytest
from pytest_playwright import CreateContextCallback

from .helpers import local_requests_only, seed_account
from .market_data import install_market_data, open_terminal

ROOT = Path(__file__).resolve().parents[2]
REPORTS = pytest.StashKey[dict[str, pytest.TestReport]]()


@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(item, call):
    """Make setup/call failures available when saving server logs at teardown."""
    report = yield
    item.stash.setdefault(REPORTS, {})[report.when] = report
    return report


@pytest.fixture(scope='session', params=['desktop', 'mobile'])
def profile(request: pytest.FixtureRequest) -> str:
    """Run every account scenario on desktop Chromium and emulated Pixel 7."""
    return request.param


@pytest.fixture(scope='session')
def base_url() -> None:
    """Keep the plugin's shared origin unset; new_context supplies a local one."""
    return None


@pytest.fixture(scope='session')
def browser_context_args(browser_context_args: dict, playwright: Playwright, profile: str) -> dict:
    """Match the TypeScript locale, timezone, device and service-worker policy."""
    options = {
        **browser_context_args,
        **playwright.devices['Pixel 7' if profile == 'mobile' else 'Desktop Chrome'],
        'locale': 'en-US',
        'timezone_id': 'America/Denver',
        'service_workers': 'block',
    }
    # Every test receives its isolated origin through new_context instead.
    options.pop('base_url', None)
    return options


@pytest.fixture
def browser_errors() -> list[str]:
    """Collect uncaught JavaScript errors and unexpected external requests."""
    return []


@pytest.fixture
def app_url(request: pytest.FixtureRequest, output_path: str, browser_errors: list[str]) -> Iterator[str]:
    """Start a fresh real account API with a temporary DB and sanitized settings."""
    env = {
        'PATH': os.environ.get('PATH', os.defpath),
        'LANG': 'C.UTF-8',
        'PYTHONUNBUFFERED': '1',
        'PYTHONDONTWRITEBYTECODE': '1',
        'P60_SIGNUP_CODE': '',
    }
    python = os.environ.get('P60_E2E_PYTHON', sys.executable)
    # Share only the Python server launcher; no Node installation is required.
    launcher = ROOT / 'test/e2e/server.py'
    with tempfile.TemporaryDirectory(prefix='p60-e2e-python-') as directory:
        log_path = Path(directory) / 'backend.log'
        with log_path.open('w') as log_file:
            process = subprocess.Popen(
                [python, str(launcher), '--database', str(Path(directory) / 'accounts.sqlite3')],
                cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=log_file, text=True,
            )
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    if not selector.select(timeout=10):
                        raise RuntimeError(f'Account server startup timed out.\n{log_path.read_text()}')
                    line = process.stdout.readline()
                if not line:
                    raise RuntimeError(f'Account server exited before readiness.\n{log_path.read_text()}')
                base_url = json.loads(line)['baseURL']
                # Ignore host proxy settings when checking this loopback-only server.
                with build_opener(ProxyHandler({})).open(f'{base_url}/healthz', timeout=5) as response:
                    assert response.status == 200
                    assert json.load(response)['ok'] is True
                yield base_url
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                process.stdout.close()
                failed = any(report.failed for report in request.node.stash.get(REPORTS, {}).values())
                if failed or browser_errors:
                    destination = Path(output_path)
                    destination.mkdir(parents=True, exist_ok=True)
                    (destination / 'backend.log').write_text(log_path.read_text())


@pytest.fixture
def new_context(
    new_context: CreateContextCallback, app_url: str, browser_errors: list[str],
) -> Iterator[CreateContextCallback]:
    """Apply origin/network isolation to all contexts, including the second device."""
    def create_context(**kwargs) -> BrowserContext:
        """Create an instrumented context tracked by pytest-playwright artifacts."""
        context = new_context(base_url=app_url, **kwargs)
        local_requests_only(context, app_url, browser_errors)
        return context

    yield create_context
    assert not browser_errors, f'Unexpected browser errors: {browser_errors}'


@pytest.fixture
def market_page(page: Page) -> Page:
    """Provide a signed-in page with deterministic, fully intercepted market data."""
    seed_account(page)
    install_market_data(page)
    return page


@pytest.fixture
def terminal(market_page: Page) -> Page:
    """Open a ready-to-browse Crypto terminal for a fresh disposable account."""
    open_terminal(market_page)
    return market_page
