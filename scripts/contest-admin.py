"""Reserve funded contest pools and audit manually reviewed prize fulfillment."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src/backend'))
import server
import contests


def main():
    """Apply one local administrative operation; never send a prize or contact a provider."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    reserve = commands.add_parser('reserve', help='Record an already-funded future prize pool')
    reserve.add_argument('--period', choices=('hourly',), required=True)
    reserve.add_argument('--start', required=True, help='Aligned ISO timestamp with timezone, e.g. 2026-11-01T00:00:00Z')
    reserve.add_argument('--kind', choices=('gift_card',), default='gift_card')
    reserve.add_argument('--amount', type=int, required=True, help='Gift-card pool in integer USD cents')
    reserve.add_argument('--description', required=True, help='Public provider, restrictions, and expiry description')
    reserve.add_argument('--funding-reference', required=True, help='Private reference for the reserved funds/allowance')
    commands.add_parser('list', help='List private prize records for operator review')
    change = commands.add_parser('update', help='Review or record an externally completed delivery')
    change.add_argument('prize_id', type=int)
    change.add_argument('--status', choices=('approved', 'fulfilled', 'rejected'), required=True)
    change.add_argument('--note', required=True, help='Private eligibility decision or external delivery reference')
    args = parser.parse_args()
    if not server.DB.is_file():
        parser.error('Start the app first to initialize its database; set PREDICT60_DB to the correct installation.')
    try:
        with server.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if args.command == 'reserve':
                timestamp = datetime.fromisoformat(args.start.replace('Z', '+00:00'))
                if timestamp.tzinfo is None or timestamp.microsecond:
                    raise ValueError('Use a timezone-aware timestamp with whole seconds.')
                identifier = contests.reserve_prize(conn, args.period, int(timestamp.timestamp()), args.kind, args.amount, args.description, args.funding_reference)
                print(f'Reserved pool for contest {identifier}. No funds were charged or prizes sent.')
            elif args.command == 'list':
                print(json.dumps([dict(row) for row in conn.execute("SELECT * FROM contest_prizes WHERE kind='gift_card' ORDER BY id DESC")], indent=2))
            else:
                contests.update_prize(conn, args.prize_id, args.status, args.note)
                print('Prize record updated. This command does not deliver rewards.')
    except (ValueError, server.sqlite3.Error) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
