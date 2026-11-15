"""Serve the real account API on loopback with a disposable database for Playwright."""

import argparse
import json
from pathlib import Path
import sys
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'src/backend'))
import server


def main():
    """Initialize an isolated app and announce its OS-assigned port to the fixture."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    args = parser.parse_args()
    server.DB = args.database
    # Pin the default registration policy independently of deployment settings.
    server.CONST.SIGNUP_CODE_REQUIRED = False
    server.validate_environment()
    server.configure('normal')
    server.initialize()
    # Account tests need no market providers. Unexpected reads must fail closed.
    with patch('urllib.request.urlopen', side_effect=RuntimeError('External providers disabled in account E2E tests.')):
        threading.Thread(target=server.settlement_worker, daemon=True).start()
        with server.Predict60HTTPServer(('127.0.0.1', 0), server.Handler) as http:
            print(json.dumps({'baseURL': f'http://127.0.0.1:{http.server_port}'}), flush=True)
            http.serve_forever()


if __name__ == '__main__':
    main()
