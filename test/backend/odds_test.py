import json
import math
import subprocess
import runpy
import tempfile
from pathlib import Path
import urllib.error
import unittest
from unittest.mock import patch
import odds
import server


class OddsTest(unittest.TestCase):
    def test_browser_server_parity(self):
        candles=[]
        price=100
        for i in range(1441):
            price*=math.exp(.0003*math.sin(i)+(.002 if i>1420 and i%2 else -.002 if i>1420 else 0))
            candles.append([i*60,0,0,0,price])
        now=1441*60
        sigma=odds.minute_volatility(candles,now)
        js="const m=require('./src/frontend/market-model.js');const c=JSON.parse(process.argv[1]);const s=m.minuteVolatility(c,86460000);console.log(JSON.stringify([s,...[-.005,0,.005].map(r=>m.estimateChances({status:'open',strike:100,endsAt:87360000},100*Math.exp(r),86460000,s).up)]));"
        browser=json.loads(subprocess.check_output(['node','-e',js,json.dumps(candles)]))
        self.assertAlmostEqual(browser[0],sigma,places=12)
        for i,r in enumerate([-.005,0,.005]):
            self.assertEqual(browser[i+1],server.estimated_up(100,100*math.exp(r),now,now-60,now+900,sigma))

    def test_fast_variance_reacts_to_recent_shock(self):
        quiet=[[i*60,0,0,0,100*math.exp(.0001*i)] for i in range(100)]
        shocked=quiet+[[6000,0,0,0,quiet[-1][4]*1.01]]
        self.assertGreater(odds.minute_volatility(shocked,6060),odds.minute_volatility(quiet,6060)*10)
        with self.assertRaises(ValueError):odds.minute_volatility([],6060)

    def test_calibration_and_settlement_horizon(self):
        p=odds.probability(100,100.1,0,900,.001)
        calibrated=odds.probability(100,100.1,0,900,.001,{'slope':.5,'intercept':0})
        self.assertTrue(.5<calibrated<p)
        self.assertGreater(odds.probability(100,100.1,0,30,.001),p)
        self.assertEqual(odds.probability(100,100,0,900,.001),.5)

    def test_calibrator_learns_overconfidence_correction(self):
        workflow=runpy.run_path('scripts/calibrate-odds.py')
        # Repeated empirical 60/40 outcomes against raw 90/10 forecasts.
        rows=[(math.log(9),int(i<60)) for i in range(100)] + [(-math.log(9),int(i<40)) for i in range(100)]
        slope,intercept=workflow['fit'](rows)
        self.assertTrue(0<slope<1)
        before=workflow['scores'](rows)
        after=workflow['scores'](rows,slope,intercept)
        self.assertLess(after['brier'],before['brier'])
        self.assertLess(after['logLoss'],before['logLoss'])

    def test_download_resumes_completed_batches(self):
        workflow=runpy.run_path('scripts/download-odds-history.py')
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)/'candles.json'
            with patch('time.time',return_value=3600000),patch('time.sleep'),patch('urllib.request.urlopen',side_effect=[Response(),urllib.error.HTTPError('url',403,'Forbidden',{},None)]),patch('json.load',return_value=[[2736000,0,0,0,100]]):
                with self.assertRaises(urllib.error.HTTPError):workflow['download']('BTC-USD',output,10)
            state=json.loads(output.with_suffix('.json.partial').read_text())
            self.assertEqual(state['next'],state['start']+14400)
            # Complete the final page on resume; avoid any further network requests.
            state['end']=state['next']+60
            output.with_suffix('.json.partial').write_text(json.dumps(state))
            with patch('time.sleep'),patch('urllib.request.urlopen',return_value=Response()) as fetch,patch('json.load',return_value=[[state['next'],0,0,0,101]]):
                workflow['download']('BTC-USD',output,10)
                self.assertEqual(fetch.call_count,1)
            self.assertEqual(len(json.loads(output.read_text())),2)

    def test_history_paginates_deduplicates_and_caches(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
        server.HISTORY_CACHE.clear()
        batches=[[[86400-i*14400-60,0,0,0,100]] for i in range(6)]
        with patch('server.urllib.request.urlopen',return_value=Response()) as fetch,patch('server.json.load',side_effect=batches):
            history=server.pricing_history('TEST-USD',86401)
            self.assertEqual(len(history),6)
            self.assertEqual(server.pricing_history('TEST-USD',86420),history)
            self.assertEqual(fetch.call_count,6)
        with patch('server.urllib.request.urlopen',return_value=Response()) as fetch,patch('server.json.load',return_value=[[86400,0,0,0,101]]):
            updated=server.pricing_history('TEST-USD',86461)
            self.assertEqual(fetch.call_count,1)
            self.assertEqual(updated[-1][4],101)
            self.assertEqual(len(updated),7)



if __name__=='__main__':unittest.main()
