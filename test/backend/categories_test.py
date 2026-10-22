"""Migration checks for populated legacy catalogs and future categories."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class CategoryMigrationTest(unittest.TestCase):
    def setUp(self):
        config=patch('oilprice_api.configured',return_value=False)
        config.start();self.addCleanup(config.stop)

    def test_legacy_data_survives_idempotent_category_migration(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'DB', Path(folder) / 'legacy.sqlite3'):
            # The eight-column legacy catalog, with an existing account and order.
            with server.connect() as conn:
                conn.executescript('''
                CREATE TABLE coins(symbol TEXT PRIMARY KEY,name TEXT NOT NULL,product TEXT UNIQUE NOT NULL,
                  precision INTEGER NOT NULL,demo_base REAL NOT NULL,icon TEXT NOT NULL,enabled INTEGER NOT NULL,sort_order INTEGER NOT NULL);
                CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,
                  password_hash TEXT NOT NULL,salt TEXT NOT NULL,balance_cents INTEGER NOT NULL,created_at INTEGER NOT NULL);
                CREATE TABLE predictions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),request_id TEXT NOT NULL,
                  coin TEXT NOT NULL REFERENCES coins(symbol),market_id TEXT NOT NULL,side TEXT NOT NULL,starts_at INTEGER NOT NULL,
                  ends_at INTEGER NOT NULL,strike REAL NOT NULL,cents INTEGER NOT NULL,contracts INTEGER NOT NULL,cost_cents INTEGER NOT NULL,
                  created_at INTEGER NOT NULL,UNIQUE(user_id,request_id));
                CREATE TABLE catalog_migrations(version INTEGER PRIMARY KEY);
                INSERT INTO catalog_migrations VALUES(1),(2);
                INSERT INTO users VALUES(42,'Existing','existing@example.com','hash','salt',1200000,1);
                ''')
                for coin in json.loads((server.SEEDS / 'coins.seed.json').read_text()):
                    conn.execute('INSERT INTO coins VALUES(?,?,?,?,?,?,?,?)', (coin['symbol'],coin['name'],coin['product'],coin['precision'],coin['demoBase'],coin['icon'],int(coin['enabled']),coin['sortOrder']))
                conn.execute("INSERT INTO predictions VALUES('existing',42,'old-request','BTC','60-0','up',0,3600,100,50,100,5000,1)")
            server.initialize()
            with server.connect() as conn:
                self.assertEqual(conn.execute('SELECT balance_cents FROM users WHERE id=42').fetchone()[0],1200000)
                self.assertEqual(conn.execute("SELECT coin FROM predictions WHERE id='existing'").fetchone()[0],'BTC')
                self.assertEqual(tuple(conn.execute("SELECT category,feed,unit FROM coins WHERE symbol='BTC'").fetchone()),('crypto','coinbase','USD'))
                self.assertEqual(conn.execute("SELECT count(*) FROM coins WHERE category='oil'").fetchone()[0],5)
                conn.execute("UPDATE coins SET name='My WTI',enabled=0 WHERE symbol='WTI'")
                # A third category is accepted without changing the schema.
                conn.execute("INSERT INTO categories VALUES('metals','Metals','Future markets','metals','#abc','#123','USD',2)")
                conn.execute("INSERT INTO coins(symbol,name,product,precision,demo_base,icon,enabled,sort_order,category,feed,unit) VALUES('TEST-METAL','Test metal','SIM-METAL',2,100,'',1,0,'metals','simulated','USD')")
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute("UPDATE coins SET category='missing' WHERE symbol='WTI'")
            server.initialize()
            with server.connect() as conn:
                self.assertEqual(tuple(conn.execute("SELECT name,enabled FROM coins WHERE symbol='WTI'").fetchone()),('My WTI',0))
                self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0],1)
                self.assertEqual(conn.execute('SELECT count(*) FROM predictions').fetchone()[0],1)
                self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertFalse(conn.execute('PRAGMA foreign_key_check').fetchall())

    def test_legacy_simulated_oil_keeps_its_original_settlement_source(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server,'DB',Path(folder)/'test.sqlite3'):
            server.initialize()
            with server.connect() as conn:
                conn.execute("INSERT INTO users(id,name,email,password_hash,salt,balance_cents,created_at) VALUES(1,'Old oil','old@example.com','hash','salt',10000,0)")
                conn.execute("INSERT INTO predictions VALUES('old-oil',1,'old-request','WTI','60-0','up',0,3600,1,50,100,5000,0)")
            with patch('server.time.time',return_value=3606),patch('server.live_oil.candles',side_effect=AssertionError('Legacy settlement must not change feed')):
                server.settle_due(1)
            with server.connect() as conn:
                settled=conn.execute("SELECT * FROM settlements WHERE prediction_id='old-oil'").fetchone()
                self.assertIn('Simulated oil',settled['source'])
                self.assertEqual(settled['close_price'],server.simulated_prices.price('WTI',72,3599))
                self.assertEqual(conn.execute('SELECT balance_cents FROM users WHERE id=1').fetchone()[0],20000)


if __name__ == '__main__':
    unittest.main()
