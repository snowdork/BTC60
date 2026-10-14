import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import oilprice_api as oil
import server

class OilPriceAPITest(unittest.TestCase):
    def setUp(self):
        oil.CACHE.clear()
        self.row={'code':'WTI_SPOT_USD','currency':'USD','unit':'barrel','price':72.25,'as_of':'2026-10-06T12:00:00Z','created_at':'2026-10-13T00:00:00Z','synthetic':False}

    def test_daily_assessment_uses_observation_not_collection_time(self):
        with patch.object(oil,'request',return_value=self.row) as network:
            tick=oil.quote('WTI_SPOT_USD')
            self.assertEqual(tick['time'],1791288000000)
            self.assertFalse(tick['tradable'])
            self.assertEqual(tick['quoteKind'],'assessment')
            oil.quote('WTI_SPOT_USD');network.assert_called_once()
        with self.assertRaisesRegex(ValueError,'minute benchmarks'):
            oil.fresh_spot('WTI_SPOT_USD')
        with self.assertRaisesRegex(ValueError,'minute candles'):
            oil.candles('WTI_SPOT_USD',0,60)

    def test_rejects_synthetic_future_missing_time_and_mismatched_instrument(self):
        for override in [{'synthetic':True},{'as_of':'2999-01-01T00:00:00Z'},{'as_of':None},{'code':'WTI_USD'},{'unit':'gallon'},{'benchmark':{'instrument_type':'front_month_futures'}}]:
            oil.CACHE.clear()
            with patch.object(oil,'request',return_value=dict(self.row,**override)),self.assertRaises(ValueError):oil.quote('WTI_SPOT_USD')

    def test_auth_header_and_redacted_errors(self):
        with patch.object(oil,'credential',return_value='secret-test'),patch.object(oil.urllib.request,'urlopen',side_effect=RuntimeError('secret-test')) as network:
            with self.assertRaises(ValueError) as error:oil.request('WTI_SPOT_USD')
            req=network.call_args.args[0]
            self.assertEqual(req.get_header('Authorization'),'Token secret-test')
            self.assertNotIn('secret-test',req.full_url)
            self.assertNotIn('secret-test',str(error.exception))

    def test_migration_preserves_accounts_and_blocks_hourly_benchmarks(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(server,'DB',Path(folder)/'test.sqlite3'),patch.object(oil,'configured',return_value=True):
            server.initialize();server.initialize()
            with server.connect() as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM instrument_sources WHERE provider='oilpriceapi'").fetchone()[0],5)
                self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(server.instrument_source('WTI')['product'],'WTI_SPOT_USD')
            with self.assertRaisesRegex(ValueError,'minute benchmark'):server.candle_close('WTI',120)
            with self.assertRaisesRegex(ValueError,'minute benchmarks'):server.fresh_spot('WTI')
