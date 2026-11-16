"""Deterministic browser market feeds for navigation tests, without order execution."""

from datetime import datetime, timezone
import json
import math
import re
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import Page, Route, WebSocketRoute, expect

NOW = datetime(2026, 11, 15, 12, 17, 30, tzinfo=timezone.utc)
PRICES = {
    'BTC': 67_500, 'ETH': 3_500, 'SOL': 150, 'XRP': 1.25, 'DOGE': .2,
    'ADA': .5, 'LTC': 80, 'LINK': 15, 'AVAX': 25, 'SUI': 2,
}


def candles(symbol: str, start: float, end: float) -> list[list[float]]:
    """Generate valid minute candles with exact opening/closing benchmark minutes."""
    base = PRICES[symbol]
    rows = []
    for minute in range(math.floor(start / 60), math.ceil(min(end, NOW.timestamp()) / 60)):
        price = base * (1 + ((minute % 29) - 14) / 10_000)
        rows.append([minute * 60, price * .9998, price * 1.0002, price * .9999, price, 1])
    return rows


def install_market_data(page: Page):
    """Stub only market data; leave account and catalog requests on the real API."""
    page.clock.set_fixed_time(NOW)

    def provider_response(route: Route):
        """Return fixed-time ticker/candle data in the Coinbase response format."""
        url = urlsplit(route.request.url)
        parts = url.path.strip('/').split('/')
        assert len(parts) == 3 and parts[0] == 'products', url.path
        symbol = parts[1].removesuffix('-USD')
        assert symbol in PRICES, f'Unexpected instrument: {symbol}'
        if parts[2] == 'ticker':
            data = {'price': str(PRICES[symbol]), 'time': NOW.isoformat()}
        else:
            assert parts[2] == 'candles', url.path
            query = parse_qs(url.query)
            start = datetime.fromisoformat(query['start'][0].replace('Z', '+00:00')).timestamp()
            end = datetime.fromisoformat(query['end'][0].replace('Z', '+00:00')).timestamp()
            data = candles(symbol, start, end)
        route.fulfill(json=data, headers={'Access-Control-Allow-Origin': '*'})

    def pricing_history(route: Route):
        """Supply the trailing pricing history without invoking backend providers."""
        symbol = parse_qs(urlsplit(route.request.url).query)['coin'][0]
        route.fulfill(json={'candles': candles(symbol, NOW.timestamp() - 86400, NOW.timestamp())})

    def subscribe(socket: WebSocketRoute):
        """Act as a local Coinbase WebSocket server; never open a remote connection."""
        assert urlsplit(socket.url).netloc == 'ws-feed.exchange.coinbase.com', socket.url
        def receive(message: str | bytes):
            """Reply to ticker subscriptions with a valid observation at fixed time."""
            subscription = json.loads(message)
            assert subscription['type'] == 'subscribe'
            product = subscription['product_ids'][0]
            symbol = product.removesuffix('-USD')
            socket.send(json.dumps({
                'type': 'ticker', 'product_id': product,
                'price': str(PRICES[symbol]), 'time': NOW.isoformat(),
            }))

        socket.on_message(receive)

    page.route('https://api.exchange.coinbase.com/products/**', provider_response)
    page.route('**/api/pricing-history?*', pricing_history)
    page.route_web_socket(re.compile(r'.*'), subscribe)


def expect_terminal_ready(page: Page, coin: str = 'Bitcoin'):
    """Wait for real catalog bootstrap and fixture-driven chart history to finish."""
    expect(page.get_by_role('group', name='Choose Crypto instrument')).to_be_visible()
    expect(page.get_by_role('button', name=f'Select {coin}', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#startup-help')).to_be_hidden()
    expect(page.locator('#history-health')).to_have_text('History loaded')
    expect(page.locator('#price-health')).to_have_text('Spot updated 0s ago')


def open_terminal(page: Page):
    """Open the current Crypto terminal and wait for its market data."""
    page.goto('/index.html?category=crypto')
    expect_terminal_ready(page)
