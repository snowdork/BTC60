import unittest
import weather


class WeatherTest(unittest.TestCase):
    def test_catalog_is_dormant_and_complete(self):
        catalog = weather.catalog()
        self.assertEqual(len(catalog['cities']), 10)
        self.assertEqual(len({i['symbol'] for i in catalog['instruments']}), 20)
        self.assertEqual(catalog['intervalMinutes'], [60])
        self.assertFalse(catalog['tradable'])
        self.assertTrue(all(not i['enabled'] for i in catalog['instruments']))
        self.assertTrue(all(c['stationId'] is None for c in catalog['cities']))

    def test_signed_temperatures_calm_wind_and_ties(self):
        self.assertEqual(weather.outcome('temperature', -10, -5), 'up')
        self.assertEqual(weather.outcome('temperature', 0, -1), 'down')
        self.assertEqual(weather.outcome('wind', 0, 0), 'up')
        for metric, value in [('wind', -1), ('temperature', float('nan')), ('wind', True)]:
            with self.assertRaises(ValueError):
                weather.validate_value(metric, value)
        self.assertEqual(weather.hourly_window(7199), (3600, 7200))

    def test_observed_benchmarks_defer_missing_stale_or_conflicting_data(self):
        row = dict(cityId='NYC', metric='temperature', stationId='test-station',
                   observedAt=3590, value=-3, unit='°C', kind='observation')
        def benchmark(rows):
            return weather.benchmark(rows, city_id='NYC', metric='temperature',
                                     station_id='test-station', boundary=3600)
        self.assertEqual(benchmark([row]), -3)
        for changes in [dict(observedAt=3601), dict(observedAt=2999),
                        dict(kind='forecast'), dict(stationId='other'), dict(unit='°F')]:
            self.assertIsNone(benchmark([dict(row, **changes)]))
        self.assertIsNone(benchmark([]))
        self.assertIsNone(benchmark([row, dict(row, value=-4)]))
        self.assertEqual(benchmark([row, dict(row)]), -3)

    def test_hourly_boundaries_and_invalid_times(self):
        for timestamp, expected in [(0, (0, 3600)), (3600, (3600, 7200)),
                                    (3599.99, (0, 3600)), (-1, (-3600, 0))]:
            self.assertEqual(weather.hourly_window(timestamp), expected)
        for value in [True, None, '3600', float('inf'), float('nan')]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                weather.hourly_window(value)

    def test_benchmark_uses_latest_valid_observation_independent_of_order(self):
        row = dict(cityId='DEN', metric='wind', stationId='station',
                   observedAt=3000, value=0, unit='m/s', kind='observation')
        def benchmark(rows):
            return weather.benchmark(rows, city_id='DEN', metric='wind',
                                     station_id='station', boundary=3600)
        self.assertEqual(benchmark([row]), 0)  # Exact freshness cutoff and calm wind.
        newer = dict(row, observedAt=3600, value=4)
        invalid = dict(row, observedAt=3600, value=-1)
        self.assertEqual(benchmark([newer, row, invalid]), 4)
        self.assertEqual(benchmark([invalid, row, newer]), 4)
        for changes in [dict(city_id='missing'), dict(station_id=''), dict(metric='humidity'), dict(boundary=3601)]:
            args = dict(city_id='DEN', metric='wind', station_id='station', boundary=3600)
            args.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                weather.benchmark([row], **args)


if __name__ == '__main__':
    unittest.main()
