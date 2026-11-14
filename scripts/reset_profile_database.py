"""Reset an explicitly selected Docker profile and restart only after a successful reset."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

from reset_database import output, reset_docker

ROOT = Path(__file__).resolve().parents[1]


def select_app(local):
    """Resolve one profile without including containers belonging to the other profile."""
    if local:
        info = json.loads(output(['docker', 'inspect', 'p60-local']))[0]
        labels = info['Config'].get('Labels') or {}
        if info['Name'] != '/p60-local' or labels.get('com.docker.compose.project') not in (None, 'p60-local'):
            raise ValueError('p60-local does not belong to the local testing profile.')
        fallback_image = 'p60:local-dev'
    else:
        if not (ROOT / '.env').is_file():
            raise ValueError('Missing .env. Configure the VPS deployment first.')
        compose = ['docker', 'compose', '--project-directory', str(ROOT), '--project-name', 'p60',
                   '--env-file', str(ROOT / '.env'), '-f', str(ROOT / 'compose.yaml')]
        subprocess.run([*compose, 'config', '--quiet'], check=True)
        ids = output([*compose, 'ps', '--all', '--quiet', 'app']).split()
        if len(ids) != 1:
            raise ValueError('Expected one VPS app container. Resolve stale VPS containers before resetting.')
        info = json.loads(output(['docker', 'inspect', ids[0]]))[0]
        labels = info['Config'].get('Labels') or {}
        if labels.get('com.docker.compose.project') != 'p60' or labels.get('com.docker.compose.service') != 'app':
            raise ValueError('Selected container does not belong to the VPS app.')
        config = json.loads(output([*compose, 'config', '--format', 'json']))
        fallback_image = config['services']['app']['image']
    return info, fallback_image


def available_image(info, fallback):
    """Verify maintenance can start before stopping an app, allowing a rebuilt image as fallback."""
    for image in dict.fromkeys((info['Image'], fallback)):
        result = subprocess.run(['docker', 'image', 'inspect', image],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            return image
    raise ValueError('The app image is unavailable. Run the matching restart-docker.sh command with --recreate to build it, then retry.')


def restart_and_check(identifier):
    """Start the selected container and retry its HTTP readiness check up to thirty times."""
    subprocess.run(['docker', 'start', identifier], check=True)
    probe = ['docker', 'exec', identifier, 'python3', '-c',
             "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).read()"]
    for attempt in range(30):
        result = subprocess.run(probe, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            print('Database reset complete. App is ready; accounts and game data are empty, catalog defaults remain.')
            return
        if attempt < 29:
            time.sleep(2)
    raise ValueError('Reset succeeded, but the app did not become ready. Inspect docker logs for the selected container.')


def main(argv=None):
    """Require explicit confirmation, preflight the target, then back up/reset/restart exactly one app."""
    parser = argparse.ArgumentParser(description=__doc__)
    profile = parser.add_mutually_exclusive_group(required=True)
    profile.add_argument('--local', action='store_true', help='Reset local Docker p60-local, preserving the VPS database')
    profile.add_argument('--vps', action='store_true', help='Reset the VPS Compose app, preserving the local database')
    parser.add_argument('--confirm-reset', action='store_true', help='Required: clear accounts and game data after a safety backup')
    args = parser.parse_args(argv)
    if not args.confirm_reset:
        parser.error('Reset clears all accounts and game data. Pass --confirm-reset to proceed.')
    try:
        info, fallback = select_app(args.local)
        image = available_image(info, fallback)
        print(f'Resetting {"local testing" if args.local else "VPS production"}: {info["Name"].lstrip("/")}', flush=True)
        print('A safety backup will be created; no backup is restored.', flush=True)
        reset_docker(argparse.Namespace(container=info['Id'], db=None), maintenance_image=image)
        restart_and_check(info['Id'])
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f'Reset failed: {error}. Inspect the output before restarting or retrying.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
