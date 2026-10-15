"""Dormant weather market catalog and provider-independent hourly benchmarks.

Weather is intentionally separate from positive-only financial price models.
A future observation adapter must supply canonical units and pinned station IDs.
"""
import json
import math
from pathlib import Path

SEED = json.loads(Path(__file__).with_name('weather.seed.json').read_text())
INTERVAL_SECONDS = 3600
MAX_OBSERVATION_AGE_SECONDS = 600
SETTLEMENT_VERSION = 'weather-hourly-observation-v1'


def catalog():
    cities = [dict(city) for city in SEED['cities']]
    metrics = [dict(metric) for metric in SEED['metrics']]
    instruments = [dict(symbol=f"WX-{city['id']}-{metric['id'].upper()}",
                        name=f"{city['name']} {metric['name']}", cityId=city['id'],
                        metric=metric['id'], unit=metric['unit'], precision=metric['precision'],
                        enabled=False, liveSupported=False)
                   for city in cities for metric in metrics]
    return dict(availability='coming_soon', tradable=False, provider='Not connected',
                feedState='coming_soon', quoteCadence='60-minute observations',
                supportedCount=0, instrumentCount=len(instruments), cities=cities,
                metrics=metrics, instruments=instruments, intervalMinutes=[60],
                settlement=dict(version=SETTLEMENT_VERSION, tie='up',
                                maxObservationAgeSeconds=MAX_OBSERVATION_AGE_SECONDS))


def validate_value(metric, value):
    if metric not in {item['id'] for item in SEED['metrics']}:
        raise ValueError('Unknown weather metric.')
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError('A finite weather observation is required.')
    if metric == 'wind' and value < 0:
        raise ValueError('Wind speed cannot be negative.')
    return value


def hourly_window(timestamp):
    """Return UTC epoch-second boundaries, unaffected by local DST changes."""
    if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
        raise ValueError('Invalid observation time.')
    start = math.floor(timestamp / INTERVAL_SECONDS) * INTERVAL_SECONDS
    return start, start + INTERVAL_SECONDS


def benchmark(observations, *, city_id, metric, station_id, boundary):
    """Latest actual observation at/before a boundary, or None to defer settlement.

    The adapter supplies cityId, metric, stationId, observedAt (epoch seconds),
    value, unit and kind='observation'. Forecasts and other stations are excluded.
    Conflicting observations at the same timestamp defer settlement.
    """
    if city_id not in {city['id'] for city in SEED['cities']} or not station_id:
        raise ValueError('A supported city and pinned station are required.')
    validate_value(metric, 0)
    if hourly_window(boundary)[0] != boundary:
        raise ValueError('Weather benchmarks require an hourly UTC boundary.')
    unit = next(item['unit'] for item in SEED['metrics'] if item['id'] == metric)
    candidates = {}
    for row in observations:
        if (row.get('cityId'), row.get('metric'), row.get('stationId'), row.get('unit'), row.get('kind')) != (city_id, metric, station_id, unit, 'observation'):
            continue
        observed_at = row.get('observedAt')
        if isinstance(observed_at, bool) or not isinstance(observed_at, (int, float)) or not math.isfinite(observed_at):
            continue
        if not boundary - MAX_OBSERVATION_AGE_SECONDS <= observed_at <= boundary:
            continue
        try:
            value = validate_value(metric, row.get('value'))
        except ValueError:
            continue
        candidates.setdefault(observed_at, set()).add(value)
    if not candidates:
        return None
    values = candidates[max(candidates)]
    return next(iter(values)) if len(values) == 1 else None


def outcome(metric, opening, closing):
    """Higher/equal temperature or wind speed wins Up; lower wins Down."""
    return 'up' if validate_value(metric, closing) >= validate_value(metric, opening) else 'down'
