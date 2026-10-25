"""Reset the checkout, systemd, or Docker database after a consistent backup."""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DB_KEYS = ('PREDICT60_DB', 'P60_DB', 'BTC60_DB')


def output(command):
    """Run a checked metadata command and return its trimmed text output."""
    return subprocess.check_output(command, text=True).strip()


def reset_service(args, command_name='reset'):
    """Run a database command using systemd configuration, stopping only for a reset."""
    properties = {}
    for key in ('LoadState', 'User', 'WorkingDirectory', 'Environment', 'EnvironmentFiles'):
        properties[key] = output(['systemctl', 'show', 'predict60.service',
                                  '--property=' + key, '--value'])
    if properties['LoadState'] != 'loaded':
        raise ValueError('predict60.service is not installed and loaded.')
    environment = {}
    for assignment in shlex.split(properties['Environment']):
        key, sep, value = assignment.partition('=')
        if sep:
            environment[key] = value
    # systemctl lists each environment file with an optional-file annotation.
    files = properties['EnvironmentFiles'].replace(' (ignore_errors=yes)', '').replace(' (ignore_errors=no)', '')
    for filename in shlex.split(files):
        path = Path(filename)
        if not path.exists():
            raise ValueError(f'Service environment file does not exist: {path}')
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            key, sep, value = line.partition('=')
            if sep and key in DB_KEYS:
                parts = shlex.split(value)
                environment[key] = ' '.join(parts)
    working = Path(properties['WorkingDirectory'])
    if not working.is_absolute():
        raise ValueError('Service WorkingDirectory must be an absolute path.')
    command = [sys.executable, str(working / 'scripts/database.py'), command_name]
    if command_name == 'reset':
        command.append('--confirm-reset')
    if args.db:
        command.extend(['--db', str(args.db.resolve())])
    # Match the service database environment without inheriting the caller's DB overrides.
    env = {key: value for key, value in os.environ.items() if key not in DB_KEYS}
    env.update({key: value for key, value in environment.items() if key in DB_KEYS})
    user = properties['User'] or 'root'
    if os.geteuid() == 0 and user != 'root':
        command = ['runuser', '-u', user, '--', *command]
    elif os.geteuid() != 0:
        import pwd
        if pwd.getpwuid(os.geteuid()).pw_name != user:
            raise ValueError('Run --service with sudo to reset as the service user.')
    if command_name == 'reset':
        subprocess.run(['systemctl', 'stop', 'predict60.service'], check=True)
    subprocess.run(command, cwd=working, env=env, check=True)
    if command_name == 'reset':
        print('Service database reset. Service remains stopped; start with sudo systemctl start predict60.')


def reset_docker(args, command_name='reset'):
    """Run a database command against one app container's volumes, stopping only for a reset."""
    if args.container:
        ids = [args.container]
    else:
        ids = set()
        for selector in ('name=^/p60-local$',
                         'label=com.docker.compose.project=p60',
                         'label=com.docker.compose.project=p60-local'):
            ids.update(output(['docker', 'ps', '-aq', '--filter', selector]).split())
    apps = []
    for identifier in sorted(ids):
        info = json.loads(output(['docker', 'inspect', identifier]))[0]
        labels = info['Config'].get('Labels') or {}
        if info['Name'].lstrip('/') == 'p60-local' or (
                labels.get('com.docker.compose.project') in ('p60', 'p60-local')
                and labels.get('com.docker.compose.service') == 'app'):
            apps.append(info)
    if len(apps) != 1:
        raise ValueError('Expected one Predict60 app container; use --container NAME to select one. Create the deployment first if none exists.')
    info = apps[0]
    env = dict(item.split('=', 1) for item in info['Config'].get('Env', []) if '=' in item)
    db = str(args.db) if args.db else next((env[key] for key in DB_KEYS if env.get(key)), '/app/data/p60.sqlite3')
    command = ['docker', 'run', '--rm', '--network', 'none', '--volumes-from', info['Id'],
               '--entrypoint', 'python3', '--workdir', info['Config'].get('WorkingDir') or '/app']
    if info['Config'].get('User'):
        command.extend(['--user', info['Config']['User']])
    command.extend(['-e', 'PREDICT60_DB=' + db, info['Image'],
                    '/app/scripts/database.py', command_name])
    if command_name == 'reset':
        command.append('--confirm-reset')
    if command_name == 'reset':
        subprocess.run(['docker', 'stop', '--time', '30', info['Id']], check=True)
    subprocess.run(command, check=True)
    if command_name == 'reset':
        print('Docker database reset. App remains stopped; start it with docker start ' + info['Name'].lstrip('/'))


def deployment_options(parser):
    """Share runtime selection between database commands; Docker is the default."""
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--service', dest='runtime', action='store_const', const='service',
                      help='Use predict60.service database configuration')
    mode.add_argument('--docker', dest='runtime', action='store_const', const='docker',
                      help='Use the existing Predict60 app container and data volumes (default)')
    mode.add_argument('--local', dest='runtime', action='store_const', const='local',
                      help='Use the checkout database and current environment')
    parser.set_defaults(runtime='docker')
    parser.add_argument('--container', help='Select a Docker app container (also works with the default runtime)')
    parser.add_argument('--db', type=Path,
                        help='Override database path (inside the container for Docker)')


def main():
    """Require reset confirmation and dispatch to the selected database runtime."""
    parser = argparse.ArgumentParser(description=__doc__)
    deployment_options(parser)
    parser.add_argument('--confirm-reset', action='store_true', help='Required: back up and clear account/prediction data')
    args = parser.parse_args()
    if args.container and args.runtime != 'docker':
        parser.error('--container requires the Docker runtime')
    if not args.confirm_reset:
        parser.error('Reset clears account and prediction data; pass --confirm-reset.')
    try:
        if args.runtime == 'service':
            reset_service(args)
        elif args.runtime == 'docker':
            reset_docker(args)
        else:
            command = [sys.executable, str(ROOT / 'scripts/database.py'), 'reset', '--confirm-reset']
            if args.db:
                command.extend(['--db', str(args.db)])
            subprocess.run(command, check=True)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Reset failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
