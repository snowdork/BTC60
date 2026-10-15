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


if __name__ == '__main__':
    unittest.main()
