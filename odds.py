"""Adaptive crypto probabilities. Times are seconds; volatility is per minute."""
import json
import math
from pathlib import Path

VERSION = 'ewma-normal-v1'
CALIBRATION_PATH = Path(__file__).resolve().parent / 'data' / 'odds-calibration.json'


def minute_volatility(candles, now):
    closed = sorted({c[0]: c for c in candles if len(c) >= 5 and
                     all(math.isfinite(float(c[i])) for i in (0, 4)) and c[4] > 0
                     and now - 86400 <= c[0] and c[0] + 60 <= now}.values())
    fast = slow = None
    for previous, current in zip(closed, closed[1:]):
        if current[0] - previous[0] != 60:
            continue
        square = math.log(current[4] / previous[4]) ** 2
        fast = square if fast is None else 2**(-1/10)*fast + (1-2**(-1/10))*square
        slow = square if slow is None else 2**(-1/60)*slow + (1-2**(-1/60))*square
    if fast is None:
        raise ValueError('Insufficient consecutive pricing history.')
    return math.sqrt(max(1e-12, .5*fast + .5*slow))


def calibrations():
    if not CALIBRATION_PATH.exists():
        return {}
    data = json.loads(CALIBRATION_PATH.read_text())
    if data.get('version') != VERSION:
        raise ValueError('Incompatible odds calibration version.')
    result = data['coins']
    for entry in result.values():
        if not (math.isfinite(entry['slope']) and entry['slope'] > 0 and math.isfinite(entry['intercept'])):
            raise ValueError('Invalid odds calibration.')
    return result


def probability(strike, spot, now, end, volatility, calibration=None):
    if not all(math.isfinite(x) for x in (strike, spot, now, end, volatility)) or min(strike, spot, volatility) <= 0 or now >= end:
        raise ValueError('Invalid probability inputs.')
    z = math.log(spot/strike) / (volatility * math.sqrt(max(1/60, (end-now)/60)))
    p = .5 * math.erfc(-z / math.sqrt(2))
    if calibration:
        p = max(1e-9, min(1-1e-9, p))
        x = calibration['slope'] * math.log(p/(1-p)) + calibration['intercept']
        p = 1/(1+math.exp(-max(-700, min(700, x))))
    return p
