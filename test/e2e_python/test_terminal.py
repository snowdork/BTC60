"""Rendered terminal navigation with real accounts/catalogs and fixed market data."""

import re

from playwright.sync_api import Page, expect
import pytest

from .helpers import ACCOUNT
from .market_data import expect_terminal_ready, open_terminal


def test_categories_open_crypto_and_keep_oil_weather_unavailable(market_page: Page):
    """Enter Crypto through the category page; dormant categories cannot open a terminal."""
    page = market_page
    page.goto('/categories.html')
    crypto = page.locator('[data-category="crypto"]')
    expect(crypto).to_have_attribute('href', 'index.html?category=crypto')
    for category in ['oil', 'weather']:
        card = page.locator(f'[data-category="{category}"]')
        expect(card).to_contain_text('Coming soon')
        expect(card).to_have_attribute('data-availability', 'coming_soon')
        assert card.get_attribute('href') is None
    crypto.click()
    expect(page).to_have_url(re.compile(r'/index\.html\?category=crypto$'))
    expect_terminal_ready(page)
    for category in ['oil', 'weather']:
        page.goto(f'/index.html?category={category}')
        expect(page).to_have_url(re.compile(r'/categories\.html$'))


def test_terminal_opens_interval_view_with_catalog_player_balance_and_clocks(terminal: Page):
    """The authenticated terminal defaults to BTC/15 minutes and renders the player HUD."""
    page = terminal
    expect(page.get_by_role('button', name='Interval', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#market-detail')).to_be_visible()
    expect(page.locator('#hour-overview')).to_be_hidden()
    expect(page.get_by_role('group', name='Choose Crypto instrument').get_by_role('button')).to_have_count(10)
    expect(page.locator('#account-name')).to_have_text(ACCOUNT['name'][:10])
    expect(page.locator('#account-name')).to_have_attribute('title', ACCOUNT['name'])
    expect(page.locator('#balance')).to_have_text('C$ 1,000.00')
    expect(page.locator('#workspace-clock')).to_have_text('12:17:30 UTC')
    expect(page.get_by_label('Local time', exact=True)).to_contain_text('05:17:30')
    expect(page.locator('#play-timeframe')).to_have_text('12:15 – 12:30 UTC')
    expect(page.locator('#play-line')).not_to_have_attribute('d', '')


def test_coin_selection_updates_prices_and_persists_after_reload(terminal: Page):
    """Selecting Ethereum updates identity/feed data and restores the choice on reload."""
    page = terminal
    page.get_by_role('button', name='Select Ethereum', exact=True).click()
    expect_terminal_ready(page, 'Ethereum')
    expect(page.get_by_role('button', name='Select Bitcoin', exact=True)).to_have_attribute('aria-pressed', 'false')
    expect(page.locator('#play-coin-icon')).to_have_attribute('alt', 'Ethereum')
    expect(page).to_have_title('Ethereum · Crypto · Predict60')
    expect(page.locator('#detail-cards [data-detail-price]')).to_have_text('$3,500.00')
    page.reload()
    expect_terminal_ready(page, 'Ethereum')
    expect(page.locator('#play-coin-icon')).to_have_attribute('alt', 'Ethereum')
    expect(page.locator('#detail-cards [data-detail-price]')).to_have_text('$3,500.00')


@pytest.mark.parametrize(('minutes', 'timeframe'), [
    (5, '12:15 – 12:20 UTC'), (15, '12:15 – 12:30 UTC'),
    (30, '12:00 – 12:30 UTC'), (60, '12:00 – 13:00 UTC'),
])
def test_duration_selection_updates_exact_interval_without_switching_view(terminal: Page, minutes: int, timeframe: str):
    """Each duration selects the correct UTC boundaries while retaining Interval."""
    page = terminal
    button = page.get_by_role('button', name=re.compile(fr'^Select {minutes}-minute plays'))
    button.click()
    expect(button).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#market-detail')).to_be_visible()
    expect(page.locator('#hour-overview')).to_be_hidden()
    expect(page.locator('#play-interval-minutes')).to_have_text(str(minutes))
    expect(page.locator('#play-timeframe')).to_have_text(timeframe)
    expect(page.locator('#detail-cards [data-detail-index]')).to_have_count(1)


def test_hour_view_keeps_all_duration_rows_and_duration_selection_stays_in_hour(terminal: Page):
    """Hour shows all 19 intervals, with explicit duration choices preserving the view."""
    page = terminal
    page.get_by_role('button', name='Hour', exact=True).click()
    expect(page.locator('#market-detail')).to_be_hidden()
    expect(page.locator('#hour-overview')).to_be_visible()
    expect(page.locator('[data-detail-duration][aria-pressed="true"]')).to_have_count(0)
    assert page.locator('#market-grid .tier').evaluate_all('(rows) => rows.map(row => row.dataset.duration)') == ['60', '15', '30', '5']
    for duration, count in [(60, 1), (15, 4), (30, 2), (5, 12)]:
        expect(page.locator(f'#market-grid .tier[data-duration="{duration}"] [data-market]')).to_have_count(count)
    page.get_by_role('button', name=re.compile(r'^Select 30-minute plays')).click()
    expect(page.get_by_role('button', name='Hour', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#hour-overview')).to_be_visible()


def test_card_single_click_selects_and_double_click_opens_exact_interval(terminal: Page):
    """A completed Hour card opens its precise interval only on double-click."""
    page = terminal
    page.get_by_role('button', name='Hour', exact=True).click()
    card = page.get_by_role('group', name='15 minute play 12:00 to 12:15 UTC', exact=True)
    card.locator('.detail-range').click()
    expect(page.locator('#hour-overview')).to_be_visible()
    expect(card).to_have_class(re.compile(r'\bselected\b'))
    card.locator('.detail-range').dblclick()
    expect(page.locator('#market-detail')).to_be_visible()
    expect(page.locator('#play-timeframe')).to_have_text('12:00 – 12:15 UTC')
    expect(page.locator('#play-now-label')).to_have_text('COMPLETED')
    page.locator('#detail-cards [data-detail-strike]').dblclick()
    expect(page.locator('#hour-overview')).to_be_visible()
    expect(page.locator('#market-detail')).to_be_hidden()


def test_interval_arrows_browse_completed_upcoming_and_return_live(terminal: Page):
    """Interval arrows expose completed/upcoming states and Live restores the current play."""
    page = terminal
    page.get_by_role('button', name='Previous play interval', exact=True).click()
    expect(page.locator('#play-timeframe')).to_have_text('12:00 – 12:15 UTC')
    expect(page.locator('#play-now-label')).to_have_text('COMPLETED')
    page.get_by_role('button', name='Next play interval', exact=True).click()
    page.get_by_role('button', name='Next play interval', exact=True).click()
    expect(page.locator('#play-timeframe')).to_have_text('12:30 – 12:45 UTC')
    expect(page.locator('#play-now-label')).to_have_text('UPCOMING')
    expect(page.get_by_role('button', name='Next play interval', exact=True)).to_be_disabled()
    expect(page.locator('#play-chart-empty')).to_contain_text('Chart begins when this play opens')
    page.get_by_role('button', name='Return to the live interval', exact=True).click()
    expect(page.locator('#play-timeframe')).to_have_text('12:15 – 12:30 UTC')
    expect(page.locator('#play-now-label')).to_have_text('LIVE · NOW')
    expect(page.get_by_role('button', name='Return to the live interval', exact=True)).to_be_hidden()


def test_hour_navigation_loads_history_and_prevents_future_hours(terminal: Page):
    """The previous hour is readable and Live restores the current hour with a future limit."""
    page = terminal
    page.get_by_role('button', name='Hour', exact=True).click()
    expect(page.get_by_role('button', name='View next hour', exact=True)).to_be_disabled()
    page.get_by_role('button', name='View previous hour', exact=True).click()
    expect(page.locator('#feed-status')).to_have_text('HISTORICAL')
    expect(page.locator('#chart-pair-label')).to_contain_text('11:00')
    expect(page.get_by_role('button', name='View next hour', exact=True)).to_be_enabled()
    expect(page.locator('#market-grid [data-market].open')).to_have_count(0)
    page.get_by_role('button', name='Return to the live hour', exact=True).click()
    expect(page.locator('#chart-pair-label')).to_contain_text('12:00')
    expect(page.locator('#feed-status')).to_have_text('LIVE')
    expect(page.get_by_role('button', name='View next hour', exact=True)).to_be_disabled()


def test_theme_persists_and_terminal_menu_returns_to_categories(terminal: Page):
    """Theme choice persists through reload and menu navigation retains the account."""
    page = terminal
    page.get_by_role('button', name='Switch to light mode', exact=True).click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'light')
    page.reload()
    expect_terminal_ready(page)
    expect(page.locator('html')).to_have_attribute('data-theme', 'light')
    page.get_by_label('Open account and navigation menu', exact=True).click()
    page.get_by_role('link', name='← Categories', exact=True).click()
    expect(page).to_have_url(re.compile(r'/categories\.html$'))
    expect(page.get_by_text(ACCOUNT['name'], exact=True)).to_be_visible()


def test_catalog_failure_displays_recovery_and_retry_initializes_terminal(market_page: Page):
    """Failed catalog bootstrap blocks controls and exposes a working retry action."""
    page = market_page
    page.route('**/api/coins', lambda route: route.fulfill(status=503, json={'error': 'Fixture catalog unavailable'}), times=1)
    page.goto('/index.html?category=crypto')
    expect(page.locator('#startup-help')).to_be_visible()
    expect(page.locator('#workspace-clock')).to_have_text('Terminal offline')
    expect(page.get_by_role('button', name='Retry', exact=True)).to_be_visible()
    expect(page.locator('#submit-prediction')).to_be_disabled()
    page.get_by_role('button', name='Retry', exact=True).click()
    expect_terminal_ready(page)
