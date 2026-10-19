"""UTC points contests, deterministic rankings, prize records, and sponsor configuration."""
import os
import time
from urllib.parse import urlsplit

DAILY_CREDITS = 10000
WINDOW_CAP_CREDITS = 1000
RULE_VERSION = 'utc-net-credits-v1'


def initialize(conn):
    """Create contest tables without importing historical practice predictions."""
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS contests (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('hourly','daily')),
      starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
      rule_version TEXT NOT NULL, finalized_at INTEGER,
      UNIQUE(kind,starts_at));
    CREATE TABLE IF NOT EXISTS contest_entries (
      prediction_id TEXT PRIMARY KEY REFERENCES predictions(id),
      daily_id INTEGER NOT NULL REFERENCES contests(id),
      hourly_id INTEGER NOT NULL REFERENCES contests(id));
    CREATE INDEX IF NOT EXISTS contest_entries_daily ON contest_entries(daily_id);
    CREATE INDEX IF NOT EXISTS contest_entries_hourly ON contest_entries(hourly_id);
    CREATE TABLE IF NOT EXISTS contest_results (
      contest_id INTEGER NOT NULL REFERENCES contests(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      rank INTEGER NOT NULL, score_cents INTEGER NOT NULL, predictions INTEGER NOT NULL,
      PRIMARY KEY(contest_id,user_id));
    CREATE INDEX IF NOT EXISTS contests_recent ON contests(starts_at DESC,kind);
    CREATE INDEX IF NOT EXISTS contests_pending ON contests(ends_at,id) WHERE finalized_at IS NULL;
    CREATE INDEX IF NOT EXISTS contest_results_rank ON contest_results(contest_id,rank,user_id);
    CREATE TABLE IF NOT EXISTS contest_prize_plans (
      contest_id INTEGER NOT NULL REFERENCES contests(id),
      kind TEXT NOT NULL CHECK(kind='gift_card'),
      amount INTEGER NOT NULL CHECK(amount>0), description TEXT NOT NULL,
      funding_reference TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(contest_id,kind));
    CREATE TABLE IF NOT EXISTS contest_prizes (
      id INTEGER PRIMARY KEY, contest_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind='gift_card'),
      amount INTEGER NOT NULL CHECK(amount>0), description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'review' CHECK(status IN ('review','approved','fulfilled','rejected')),
      delivery_reference TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
      UNIQUE(contest_id,user_id,kind),
      FOREIGN KEY(contest_id,user_id) REFERENCES contest_results(contest_id,user_id));
    CREATE INDEX IF NOT EXISTS contest_prizes_user ON contest_prizes(user_id,id DESC);
    CREATE TABLE IF NOT EXISTS contest_prize_events (
      id INTEGER PRIMARY KEY, prize_id INTEGER NOT NULL REFERENCES contest_prizes(id),
      old_status TEXT NOT NULL, new_status TEXT NOT NULL, note TEXT NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS gift_card_plans_only BEFORE INSERT ON contest_prize_plans
    WHEN NEW.kind!='gift_card'
    BEGIN SELECT RAISE(ABORT,'Only gift-card prizes are supported'); END;
    CREATE TRIGGER IF NOT EXISTS gift_card_awards_only BEFORE INSERT ON contest_prizes
    WHEN NEW.kind!='gift_card'
    BEGIN SELECT RAISE(ABORT,'Only gift-card prizes are supported'); END;
    CREATE TRIGGER IF NOT EXISTS gift_card_plan_kind_only BEFORE UPDATE OF kind ON contest_prize_plans
    WHEN NEW.kind!='gift_card'
    BEGIN SELECT RAISE(ABORT,'Only gift-card prizes are supported'); END;
    CREATE TRIGGER IF NOT EXISTS gift_card_award_kind_only BEFORE UPDATE OF kind ON contest_prizes
    WHEN NEW.kind!='gift_card'
    BEGIN SELECT RAISE(ABORT,'Only gift-card prizes are supported'); END;
    ''')


def ensure_period(conn, kind, starts_at):
    """Create or find an aligned UTC period and return its row."""
    duration = 3600 if kind == 'hourly' else 86400 if kind == 'daily' else 0
    if not duration or starts_at % duration:
        raise ValueError('Choose an aligned UTC hourly or daily start.')
    existing = conn.execute('SELECT * FROM contests WHERE kind=? AND starts_at=?', (kind, starts_at)).fetchone()
    if existing is not None:
        return existing
    conn.execute('INSERT OR IGNORE INTO contests(kind,starts_at,ends_at,rule_version) VALUES(?,?,?,?)',
                 (kind, starts_at, starts_at + duration, RULE_VERSION))
    return conn.execute('SELECT * FROM contests WHERE kind=? AND starts_at=?', (kind, starts_at)).fetchone()


def enter(conn, prediction_id, user_id, coin, starts_at, ends_at, cost_cents):
    """Reserve daily and window exposure atomically with an inserted prediction."""
    # End boundaries belong to the period that just ended: 23:45–00:00 is yesterday.
    daily = ensure_period(conn, 'daily', (ends_at - 1) // 86400 * 86400)
    hourly = ensure_period(conn, 'hourly', (ends_at - 1) // 3600 * 3600)
    if daily['finalized_at'] is not None or hourly['finalized_at'] is not None:
        raise ValueError('This contest is finalized.')
    spent = conn.execute('SELECT COALESCE(SUM(p.cost_cents),0) FROM contest_entries e JOIN predictions p ON p.id=e.prediction_id WHERE e.daily_id=? AND p.user_id=?',
                         (daily['id'], user_id)).fetchone()[0]
    if spent + cost_cents > DAILY_CREDITS * 100:
        raise ValueError('Daily contest allowance exhausted. It renews at 00:00 GMT.')
    committed = conn.execute('SELECT COALESCE(SUM(p.cost_cents),0) FROM contest_entries e JOIN predictions p ON p.id=e.prediction_id WHERE p.user_id=? AND p.coin=? AND p.starts_at=? AND p.ends_at=?',
                             (user_id, coin, starts_at, ends_at)).fetchone()[0]
    if committed + cost_cents > WINDOW_CAP_CREDITS * 100:
        raise ValueError('Maximum 1,000 contest credits per instrument and interval, across both directions.')
    conn.execute('INSERT INTO contest_entries VALUES(?,?,?)', (prediction_id, daily['id'], hourly['id']))


def standings(conn, contest):
    """Return ranked settled net scores with pending counts; ties share a rank."""
    if contest['finalized_at'] is not None:
        return [dict(row) for row in conn.execute('SELECT r.user_id,u.name,r.rank,r.score_cents,r.predictions,0 AS pending FROM contest_results r JOIN users u ON u.id=r.user_id WHERE contest_id=? ORDER BY rank,user_id', (contest['id'],))]
    column = 'hourly_id' if contest['kind'] == 'hourly' else 'daily_id'
    rows = [dict(row) for row in conn.execute(f'''SELECT p.user_id,u.name,COUNT(*) AS predictions,
      SUM(CASE WHEN s.prediction_id IS NULL THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN s.prediction_id IS NULL THEN 0 ELSE s.payout_cents-p.cost_cents END) AS score_cents
      FROM contest_entries e JOIN predictions p ON p.id=e.prediction_id
      JOIN users u ON u.id=p.user_id LEFT JOIN settlements s ON s.prediction_id=p.id
      WHERE e.{column}=? GROUP BY p.user_id ORDER BY score_cents DESC,p.user_id''', (contest['id'],))]
    rank, previous = 0, None
    for index, row in enumerate(rows, 1):
        if row['score_cents'] != previous:
            rank = index
        row['rank'] = rank
        previous = row['score_cents']
    return rows


def finalize(conn, now=None):
    """Snapshot closed, fully settled contests and allocate reserved pools once."""
    now = int(time.time()) if now is None else now
    for contest in conn.execute('SELECT * FROM contests WHERE ends_at<=? AND finalized_at IS NULL ORDER BY ends_at,id', (now,)).fetchall():
        rows = standings(conn, contest)
        if any(row['pending'] for row in rows):
            continue  # Missing benchmarks leave rankings provisional, even across restarts.
        for row in rows:
            conn.execute('INSERT INTO contest_results VALUES(?,?,?,?,?)',
                         (contest['id'], row['user_id'], row['rank'], row['score_cents'], row['predictions']))
        winners = [row for row in rows if row['rank'] == 1]
        for plan in conn.execute("SELECT * FROM contest_prize_plans WHERE contest_id=? AND kind='gift_card'", (contest['id'],)).fetchall():
            if not winners:
                continue  # Unawarded pool stays with the operator; never invent a participant.
            share, remainder = divmod(plan['amount'], len(winners))
            for index, winner in enumerate(winners):
                amount = share + int(index < remainder)
                if not amount:
                    continue
                cursor = conn.execute('INSERT INTO contest_prizes(contest_id,user_id,kind,amount,description,updated_at) VALUES(?,?,?,?,?,?)',
                                      (contest['id'], winner['user_id'], plan['kind'], amount, plan['description'], now))
                conn.execute('INSERT INTO contest_prize_events(prize_id,old_status,new_status,note,created_at) VALUES(?,?,?,?,?)',
                             (cursor.lastrowid, '', 'review', 'Allocated from reserved contest pool', now))
        conn.execute('UPDATE contests SET finalized_at=? WHERE id=?', (now, contest['id']))


def wallet(conn, user_id, now=None):
    """Report today's non-replenishing contest allowance without changing practice funds."""
    now = int(time.time()) if now is None else now
    day = now // 86400 * 86400
    spent = conn.execute('SELECT COALESCE(SUM(p.cost_cents),0) FROM contest_entries e JOIN contests c ON c.id=e.daily_id JOIN predictions p ON p.id=e.prediction_id WHERE c.starts_at=? AND p.user_id=?', (day, user_id)).fetchone()[0]
    return {'dailyCredits': DAILY_CREDITS, 'remaining_cents': DAILY_CREDITS * 100 - spent,
            'spent_cents': spent, 'resets_at': day + 86400}


def dashboard(conn, user_id, now=None):
    """Return current/recent contests, the caller's awards, and public prize descriptions."""
    now = int(time.time()) if now is None else now
    ensure_period(conn, 'hourly', now // 3600 * 3600)
    ensure_period(conn, 'daily', now // 86400 * 86400)
    periods = conn.execute('SELECT * FROM contests WHERE starts_at<=? ORDER BY starts_at DESC,kind LIMIT 60', (now,)).fetchall()
    upcoming = conn.execute("SELECT * FROM contests WHERE starts_at>? AND EXISTS(SELECT 1 FROM contest_prize_plans p WHERE p.contest_id=contests.id AND p.kind='gift_card') ORDER BY starts_at LIMIT 10", (now,)).fetchall()
    selected = [*periods, *upcoming]
    pools = {}
    if selected:
        placeholders = ','.join('?' for _ in selected)
        for row in conn.execute(f"SELECT contest_id,kind,amount,description FROM contest_prize_plans WHERE kind='gift_card' AND contest_id IN ({placeholders})", [p['id'] for p in selected]):
            pool = dict(row)
            pools.setdefault(pool.pop('contest_id'), []).append(pool)
    result = []
    for period in selected:
        entry = dict(period)
        rows = standings(conn, period)
        entry['state'] = 'final' if period['finalized_at'] is not None else 'upcoming' if period['starts_at'] > now else 'open' if period['ends_at'] > now else 'awaiting_settlement'
        entry['leaders'] = rows[:100]
        entry['mine'] = next((row for row in rows if row['user_id'] == user_id), None)
        entry['participants'] = len(rows)
        entry['winnerCount'] = sum(row['rank'] == 1 for row in rows) if period['finalized_at'] is not None else 0
        entry['prizes'] = pools.get(period['id'], [])
        result.append(entry)
    prizes = [dict(row) for row in conn.execute("SELECT id,contest_id,kind,amount,description,status,updated_at FROM contest_prizes WHERE user_id=? AND kind='gift_card' ORDER BY id DESC", (user_id,))]
    return {'contests': result, 'wallet': wallet(conn, user_id, now), 'prizes': prizes,
            'rules': {'version': RULE_VERSION, 'dailyCredits': DAILY_CREDITS, 'windowCap': WINDOW_CAP_CREDITS,
                      'timezone': 'GMT', 'dailyClose': '00:00', 'hourlyClose': 'HH:00', 'scoring': 'settled net credits', 'ties': 'shared rank'}}


def reserve_prize(conn, kind, starts_at, prize_kind, amount, description, reference, now=None):
    """Record an operator-funded pool before entries open; never charge or send money."""
    now = int(time.time()) if now is None else now
    if starts_at <= now or prize_kind != 'gift_card' or type(amount) is not int or amount <= 0:
        raise ValueError('Reserve a positive prize pool for a future contest.')
    if not description.strip() or not reference.strip() or len(description) > 300 or len(reference) > 300:
        raise ValueError('Provide a description and private funding reference, at most 300 characters each.')
    contest = ensure_period(conn, kind, starts_at)
    conn.execute('INSERT INTO contest_prize_plans VALUES(?,?,?,?,?,?)',
                 (contest['id'], prize_kind, amount, description.strip(), reference.strip(), now))
    return contest['id']


def update_prize(conn, prize_id, status, note, now=None):
    """Advance a reviewed prize with an audit event, accepting identical retries only."""
    now = int(time.time()) if now is None else now
    prize = conn.execute('SELECT * FROM contest_prizes WHERE id=?', (prize_id,)).fetchone()
    if prize is not None and prize['kind'] != 'gift_card':
        raise ValueError('Only gift-card prizes are supported.')
    if prize is None or not note.strip() or len(note) > 500:
        raise ValueError('Choose an existing prize and provide an audit/delivery reference (max 500 characters).')
    if prize['status'] == status:
        if prize['delivery_reference'] == note:
            return
        raise ValueError('This status already has a different audit reference.')
    allowed = {'review': {'approved', 'rejected'}, 'approved': {'fulfilled', 'rejected'}}
    if status not in allowed.get(prize['status'], set()):
        raise ValueError('Invalid prize transition. Review, approve, then record fulfillment.')
    conn.execute('UPDATE contest_prizes SET status=?,delivery_reference=?,updated_at=? WHERE id=?', (status, note, now, prize_id))
    conn.execute('INSERT INTO contest_prize_events(prize_id,old_status,new_status,note,created_at) VALUES(?,?,?,?,?)',
                 (prize_id, prize['status'], status, note, now))


def sponsor():
    """Expose only a configured HTTPS sponsor link and plain text, with no tracking code."""
    label = os.environ.get('P60_SPONSOR_NAME', '').strip()[:100]
    url = os.environ.get('P60_SPONSOR_URL', '').strip()
    try:
        parsed = urlsplit(url)
        valid = parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
    except ValueError:
        valid = False
    if not label or not valid or any(ord(c) < 32 for c in url):
        return {'enabled': False}
    return {'enabled': True, 'name': label, 'url': url,
            'message': os.environ.get('P60_SPONSOR_MESSAGE', 'Our contest sponsor').strip()[:180]}
