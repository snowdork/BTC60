"""Download resumable public Coinbase minute candles for odds calibration."""
import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime,timezone
from pathlib import Path


def download(product,output,days=30):
    """Download historical candles in resumable batches and persist progress for interrupted runs."""
    partial=output.with_suffix(output.suffix+'.partial')
    if partial.exists():
        state=json.loads(partial.read_text())
        if state['product']!=product:raise ValueError('Checkpoint belongs to another product.')
        print('Resuming saved download.',flush=True)
    else:
        end=int(time.time())//3600*3600
        state={'product':product,'start':end-days*86400,'end':end,'next':end-days*86400,'candles':[]}
    candles={c[0]:c for c in state['candles']}
    # Persist batches as progress advances so interrupted downloads can resume.
    while state['next']<state['end']:
        start=state['next'];end=min(state['end'],start+240*60)
        query=urllib.parse.urlencode({'granularity':60,'start':datetime.fromtimestamp(start,timezone.utc).isoformat(),'end':datetime.fromtimestamp(end,timezone.utc).isoformat()})
        url='https://api.exchange.coinbase.com/products/'+urllib.parse.quote(product,safe='')+'/candles?'+query
        print(f"Downloading {datetime.fromtimestamp(start,timezone.utc).isoformat()} · {100*(start-state['start'])/(state['end']-state['start']):.1f}%",flush=True)
        request=urllib.request.Request(url,headers={'User-Agent':'BTC60-local-demo/1.0'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request,timeout=10) as response:batch=json.load(response)
                break
            except urllib.error.HTTPError as error:
                if error.code not in (429,500,502,503,504) or attempt==2:raise
                time.sleep(1+attempt)
            except urllib.error.URLError:
                if attempt==2:raise
                time.sleep(1+attempt)
        if not isinstance(batch,list):raise ValueError('Invalid candle response; checkpoint preserved.')
        for c in batch:
            if isinstance(c,list) and len(c)>=5 and start<=c[0]<end:candles[c[0]]=c
        state['next']=end;state['candles']=sorted(candles.values())
        output.parent.mkdir(parents=True,exist_ok=True)
        temporary=partial.with_suffix('.tmp')
        temporary.write_text(json.dumps(state));temporary.replace(partial)
        time.sleep(.2)
    temporary=output.with_suffix(output.suffix+'.tmp')
    temporary.write_text(json.dumps(sorted(candles.values())));temporary.replace(output)
    print(f'Saved {len(candles):,} candles to {output}.',flush=True)


def main():
    """Parse download options and resume the requested historical candle export."""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('product',help='Coinbase product, for example BTC-USD')
    parser.add_argument('output',type=Path)
    parser.add_argument('--days',type=int,default=30)
    args=parser.parse_args()
    if not 10<=args.days<=365:parser.error('--days must be between 10 and 365')
    try:download(args.product,args.output,args.days)
    except (urllib.error.URLError,ValueError,OSError) as error:
        raise SystemExit(f'Download stopped: {error}. Completed batches are saved; rerun the same command to resume.')


if __name__=='__main__':main()
