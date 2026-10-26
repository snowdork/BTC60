#!/usr/bin/env python3
"""List display names from the checkout, systemd service, or Docker database."""
import argparse
import subprocess
import sys

from reset_database import ROOT, reset_service, reset_docker, deployment_options


def main():
    """List account display names in the selected deployment without stopping its service."""
    parser = argparse.ArgumentParser(description=__doc__)
    deployment_options(parser)
    args = parser.parse_args()
    if args.container and args.runtime != 'docker':
        parser.error('--container requires the Docker runtime')
    try:
        if args.runtime == 'service':
            reset_service(args, command_name='usernames')
        elif args.runtime == 'docker':
            reset_docker(args, command_name='usernames')
        else:
            command = [sys.executable, str(ROOT / 'scripts/database.py'), 'usernames']
            if args.db:
                command.extend(['--db', str(args.db)])
            subprocess.run(command, check=True)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Cannot list usernames: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
