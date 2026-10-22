"""Deterministic demo prices, never quotes from a real oil exchange.

The symbol and UTC time define the same path for charts, orders and settlement.
Base prices are illustrative seed values. No browser price is trusted.
"""
import hashlib
import math

VERSION = 'oil-simulation-v1'


def price(symbol, base, timestamp):
    # Smooth interpolation between reproducible five-minute price samples.
    """Interpolate deterministic five-minute samples for a synthetic instrument price at an epoch-second timestamp."""
    slot = math.floor(timestamp / 300)
    fraction = (timestamp - slot * 300) / 300
    def sample(index):
        """Map the version, instrument symbol, and sample index to a reproducible value between minus one and one."""
        digest = hashlib.sha256(f'{VERSION}:{symbol}:{index}'.encode()).digest()
        return int.from_bytes(digest[:8], 'big') / (2**64 - 1) * 2 - 1
    blend = fraction * fraction * (3 - 2 * fraction)
    return base * (1 + .006 * ((1 - blend) * sample(slot) + blend * sample(slot + 1)))


def candles(symbol, base, start, end):
    """Return validated minute OHLC rows in Coinbase order: time, low, high, open, close, volume."""
    result = []
    # Use complete UTC minutes and an exclusive end boundary to match benchmark lookup.
    for minute in range(math.ceil(start / 60) * 60, math.floor(end / 60) * 60, 60):
        opening = price(symbol, base, minute)
        close = price(symbol, base, minute + 59)
        result.append([minute, min(opening, close), max(opening, close), opening, close, 0])
    return result
