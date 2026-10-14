import os
import unittest
from unittest.mock import patch
import live_oil


class OilAdapterTest(unittest.TestCase):
    def setUp(self):
        live_oil.CACHE.clear()
        env=patch.dict(os.environ,{'TWELVE_DATA_API_KEY':'test-secret'})
        env.start();self.addCleanup(env.stop)

    def test_missing_key_does_not_fall_back_to_simulation(self):
        with patch.dict(os.environ,{},clear=True),patch('live_oil.urllib.request.urlopen') as network:
            with self.assertRaisesRegex(ValueError,'API key'):
                live_oil.quote('WTI/USD')
            network.assert_not_called()
        with self.assertRaisesRegex(ValueError,'no verified'):
            live_oil.quote('')

    def test_quotes_preserve_source_time_cache_and_reject_stale_or_closed_prices(self):
        quote={'symbol':'WTI/USD','currency':'USD','close':'72.25','last_update_at':1000,'is_market_open':True}
        with patch('live_oil.time.time',return_value=1030),patch('live_oil.request',return_value=quote) as request:
            tick=live_oil.quote('WTI/USD')
            self.assertEqual(tick['time'],1000000)
            self.assertEqual(tick['price'],72.25)
            live_oil.quote('WTI/USD');request.assert_called_once()
        with patch('live_oil.time.time',return_value=1091):
            with self.assertRaisesRegex(ValueError,'stale'):
                live_oil.quote('WTI/USD')
        live_oil.CACHE.clear()
        with patch('live_oil.request',return_value=dict(quote,is_market_open=False)):
            with self.assertRaisesRegex(ValueError,'closed'):
                live_oil.quote('WTI/USD')
        live_oil.CACHE.clear()
        with patch('live_oil.request',return_value=dict(quote,symbol='XBR/USD')):
            with self.assertRaisesRegex(ValueError,'different instrument'):
                live_oil.quote('WTI/USD')

    def test_minute_history_keeps_exact_utc_boundaries_and_excludes_unclosed_candles(self):
        data={'meta':{'symbol':'WTI/USD','currency':'USD','interval':'1min'},'values':[
            {'datetime':'1970-01-01 00:01:00','low':'71','high':'73','open':'72','close':'72.5'},
            {'datetime':'1970-01-01 00:02:00','low':'72','high':'74','open':'73','close':'73.5'}]}
        with patch('live_oil.time.time',return_value=150),patch('live_oil.request',return_value=data):
            candles=live_oil.candles('WTI/USD',60,180)
            self.assertEqual(candles,[[60,71,73,72,72.5,0]])
        live_oil.CACHE.clear()
        data['values'][0]['low']='100'
        with patch('live_oil.time.time',return_value=150),patch('live_oil.request',return_value=data):
            with self.assertRaisesRegex(ValueError,'invalid minute history'):
                live_oil.candles('WTI/USD',60,180)

    def test_daily_bar_timestamp_is_not_treated_as_a_live_quote(self):
        data={'symbol':'WTI/USD','close':'72','timestamp':1000,'is_market_open':True}
        with patch('live_oil.time.time',return_value=1000),patch('live_oil.request',return_value=data):
            with self.assertRaisesRegex(ValueError,'stale'):
                live_oil.quote('WTI/USD')
        live_oil.CACHE.clear()
        data['last_quote_at']=1000
        with patch('live_oil.time.time',return_value=1030),patch('live_oil.request',return_value=data):
            self.assertEqual(live_oil.quote('WTI/USD')['time'],1000000)

    def test_credentials_are_in_headers_and_provider_errors_are_redacted(self):
        with patch.dict(os.environ,{'TWELVE_DATA_API_KEY':'test-secret'}),patch('live_oil.urllib.request.urlopen',side_effect=RuntimeError('test-secret')) as network:
            with self.assertRaisesRegex(ValueError,'provider unavailable') as error:
                live_oil.request('quote',{'symbol':'WTI/USD'})
            req=network.call_args.args[0]
            self.assertNotIn('test-secret',req.full_url)
            self.assertEqual(req.get_header('Authorization'),'apikey test-secret')
            self.assertNotIn('test-secret',str(error.exception))


if __name__=='__main__':unittest.main()
