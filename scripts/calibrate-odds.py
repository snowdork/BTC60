"""Fit a coin's sigmoid calibration from Coinbase-format minute candles.

Usage: python3 scripts/calibrate-odds.py BTC candles.json
Only exports if calibration improves both held-out Brier score and log loss.
"""
import argparse
import bisect
import json
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src/backend'))
import odds


def scores(rows, slope=1, intercept=0):
    """Compute held-out Brier score and log loss for candidate probability estimates."""
    probabilities = [1/(1+math.exp(-max(-35, min(35, slope*x+intercept)))) for x, y in rows]
    return {'brier':sum((p-y)**2 for p, (_, y) in zip(probabilities, rows))/len(rows),
            'logLoss':-sum(y*math.log(p)+(1-y)*math.log(1-p) for p, (_, y) in zip(probabilities, rows))/len(rows)}


def fit(rows):
    """Fit logistic calibration parameters from historical predictions and observed outcomes."""
    slope, intercept = 1., 0.
    # Damped Newton updates converge quickly for a two-parameter sigmoid.
    for iteration in range(80):
        da=db=haa=hab=hbb=0.
        for x,y in rows:
            p=1/(1+math.exp(-max(-35,min(35,slope*x+intercept))))
            w=p*(1-p)
            da+=(p-y)*x;db+=p-y
            haa+=w*x*x;hab+=w*x;hbb+=w
        da=da/len(rows)+.001*(slope-1);db/=len(rows)
        haa=haa/len(rows)+.001;hab/=len(rows);hbb=hbb/len(rows)+1e-8
        determinant=haa*hbb-hab*hab
        if determinant<=0:break
        step_a=(hbb*da-hab*db)/determinant
        step_b=(haa*db-hab*da)/determinant
        old_loss=scores(rows,slope,intercept)['logLoss']+.0005*(slope-1)**2
        scale=1.
        while scale>1e-6:
            candidate_a=max(.01,slope-scale*step_a);candidate_b=intercept-scale*step_b
            loss=scores(rows,candidate_a,candidate_b)['logLoss']+.0005*(candidate_a-1)**2
            if loss<=old_loss:break
            scale*=.5
        if scale<=1e-6:break
        change=abs(candidate_a-slope)+abs(candidate_b-intercept)
        slope,intercept=candidate_a,candidate_b
        if change<1e-7:break
    return slope, intercept


def main():
    """Fit and validate calibration, saving coefficients only when held-out scores improve."""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('coin')
    parser.add_argument('candles', type=Path)
    parser.add_argument('--output', type=Path, default=odds.CALIBRATION_PATH)
    args=parser.parse_args()
    print('Loading historical candles…',flush=True)
    candles=sorted({c[0]:c for c in json.loads(args.candles.read_text())}.values())
    if not candles:raise SystemExit('No candles in input.')
    print(f'Loaded {len(candles):,} candles. Building chronological windows…',flush=True)
    by_time={c[0]:c for c in candles}
    times=[c[0] for c in candles]
    first,last=times[0]+86400,times[-1]
    # Split on whole UTC hours; no market outcome crosses the split.
    split=int((first+.7*(last-first))//3600)*3600
    train,test=[],[]
    for duration in (900,1800,3600):
        print(f'Processing {duration//60}-minute windows…',flush=True)
        start=int(math.ceil(first/duration))*duration
        while start+duration<=last:
            end=start+duration
            now=start+duration//2
            if all(t in by_time for t in (start-60,now-60,end-60)):
                left=bisect.bisect_left(times,now-86400)
                right=bisect.bisect_left(times,now)
                try:
                    sigma=odds.minute_volatility(candles[left:right],now)
                    p=odds.probability(by_time[start-60][4],by_time[now-60][4],now,end,sigma)
                    p=max(1e-9,min(1-1e-9,p))
                    row=(math.log(p/(1-p)),int(by_time[end-60][4]>=by_time[start-60][4]))
                    if end<=split:train.append(row)
                    elif start>=split:test.append(row)
                except ValueError:
                    pass
            start+=duration
    if len(train)<500 or len(test)<200 or len({y for _,y in train})<2:
        raise SystemExit('Need at least 500 training and 200 held-out windows, with both outcomes in training.')
    print(f'Fitting {len(train):,} windows; validating {len(test):,} later windows…',flush=True)
    slope,intercept=fit(train)
    baseline=scores(test)
    calibrated=scores(test,slope,intercept)
    print(json.dumps({'trainingWindows':len(train),'testWindows':len(test),'baseline':baseline,'calibrated':calibrated},indent=2))
    if not all(calibrated[k]<baseline[k] for k in baseline):
        raise SystemExit('Calibration did not improve both held-out metrics; existing model preserved.')
    artifact={'version':odds.VERSION,'coins':{}}
    if args.output.exists():
        artifact=json.loads(args.output.read_text())
        if artifact.get('version')!=odds.VERSION:raise SystemExit('Incompatible existing calibration.')
    artifact['coins'][args.coin.upper()]={'slope':slope,'intercept':intercept,'trainEnd':split,
        'testEnd':last,'trainingWindows':len(train),'testWindows':len(test),'baseline':baseline,'validated':calibrated}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temporary=args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps(artifact,indent=2)+'\n')
    temporary.replace(args.output)
    print(f'Saved {args.output}. Reload the terminal to load the calibration.')


if __name__=='__main__':main()
