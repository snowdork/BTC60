"""Create private VPS/local environment files from the deployment templates."""
import argparse
from datetime import datetime, timezone
import getpass
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src/backend'))
import CONST
ASSIGNMENT = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$')


def settings(text):
    """Read literal defaults without sourcing a file or expanding shell expressions."""
    values = {}
    for line in text.splitlines():
        match = ASSIGNMENT.match(line)
        if match:
            key, value = match.groups()
            value = value.strip()
            quoted = re.fullmatch(r"(['\"])(.*?)\1(?:[ \t]+#.*)?", value)
            if quoted:
                value = quoted[2]
            elif not value.startswith(('"', "'")):
                value = re.split(r'\s+#', value, maxsplit=1)[0].rstrip()
            values[key] = value
    return values


def domain(value):
    """Accept a DNS hostname without a scheme, port, or path."""
    value = value.lower().rstrip('.')
    labels = value.split('.')
    if len(value) > 253 or len(labels) < 2 or any(
            not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
            for label in labels):
        raise ValueError('Enter a domain such as predict60.com, without https://, a port, or a path.')
    return value


def port(value):
    """Validate the published Docker port."""
    if not re.fullmatch(r'[0-9]{1,5}', value) or not 1 <= int(value) <= 65535:
        raise ValueError('Port must be a number from 1 to 65535.')
    return str(int(value))


def origins(value):
    """Normalize comma-separated browser origins without allowing paths or credentials."""
    result = []
    for item in value.split(','):
        item = item.strip().rstrip('/')
        if not item:
            continue
        try:
            parsed = urlsplit(item)
            valid = (parsed.scheme in ('http', 'https') and parsed.hostname
                     and not parsed.username and not parsed.password
                     and not parsed.path and not parsed.query and not parsed.fragment
                     and (parsed.port is None or 1 <= parsed.port <= 65535)
                     and not re.search(r"[\s$#'\"\\]", item))
        except ValueError:
            valid = False
        if not valid:
            raise ValueError('Aliases must be comma-separated http:// or https:// origins, without paths.')
        host = f'[{parsed.hostname}]' if ':' in parsed.hostname else parsed.hostname
        default_port = 443 if parsed.scheme == 'https' else 80
        suffix = f':{parsed.port}' if parsed.port not in (None, default_port) else ''
        item = f'{parsed.scheme}://{host}{suffix}'
        if item not in result:
            result.append(item)
    return ','.join(result)


def signup_code(value):
    """Use a portable code that works in both Compose and plain Docker env files."""
    if not value and not CONST.SIGNUP_CODE_REQUIRED:
        return value
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', value):
        raise ValueError('Signup code is required; use letters, numbers, dots, underscores, or hyphens.')
    return value


def ask(label, default, validate, interactive, secret=False):
    """Validate defaults or prompt without displaying a signup code."""
    while True:
        if not interactive:
            return validate(default)
        suffix = ' [Enter keeps current]' if secret and default else f' [{default}]' if default else ''
        value = (getpass.getpass(f'{label}{suffix}: ') if secret
                 else input(f'{label}{suffix}: ')).strip()
        try:
            value = validate(value or default)
            if secret and value != default and getpass.getpass('Confirm signup code: ') != value:
                raise ValueError('Signup codes did not match.')
            return value
        except ValueError as error:
            print(error, file=sys.stderr)


def render(base, template, values):
    """Preserve custom settings and comments, adding missing template defaults."""
    lines = base.splitlines()
    existing = settings(base)
    missing = [line for line in template.splitlines()
               if (match := ASSIGNMENT.match(line)) and match[1] not in existing]
    if missing:
        lines.extend(['', '# Additional deployment defaults', *missing])
    seen = set()
    for index, line in enumerate(lines):
        match = ASSIGNMENT.match(line)
        if match and match[1] in values:
            key = match[1]
            lines[index] = f'{key}={values[key]}'
            seen.add(key)
    lines.extend(f'{key}={value}' for key, value in values.items() if key not in seen)
    return '\n'.join(lines) + '\n'


def save(path, content, previous):
    """Publish a complete mode-0600 file; back up an explicitly requested update."""
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.setup-', dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
        if previous is None:
            os.link(temporary, path)  # Refuse a file created by another process meanwhile.
        else:
            if path.is_symlink() or path.read_text() != previous:
                raise ValueError('Environment file changed during setup; rerun before updating it.')
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
            backup = path.with_name(path.name + '.backup-' + stamp)
            with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
                stream.write(previous)
            os.replace(temporary, path)
            print(f'Previous settings backed up to {backup.name}')
    finally:
        temporary.unlink(missing_ok=True)


def validate_profile(values, vps):
    """Reject incomplete deployment settings before reporting success or starting Docker."""
    port(values.get('P60_PORT', '8085'))
    signup_code(values.get('P60_SIGNUP_CODE', ''))
    client_id(values.get('GOOGLE_CLIENT_ID', ''))
    if vps:
        hostname = values.get('P60_DOMAIN', '')
        if domain(hostname) != hostname:
            raise ValueError('P60_DOMAIN must be lowercase without a trailing dot; use --update to normalize it.')
        aliases = values.get('P60_ADDITIONAL_ORIGINS', '')
        for alias in aliases.split(','):
            if alias.strip() and origins(alias.strip()) != alias.strip():
                raise ValueError('Additional origins must be normalized; use --update to normalize them.')
        limit = values.get('P60_MAX_REQUESTS') or '32'
        if not re.fullmatch(r'[0-9]+', limit) or not 1 <= int(limit) <= 256:
            raise ValueError('P60_MAX_REQUESTS must be a number from 1 to 256.')
        if (values.get('PREDICT60_LOG_LEVEL') or 'normal') not in ('normal', 'debug', 'warning', 'error'):
            raise ValueError('PREDICT60_LOG_LEVEL must be normal, debug, warning, or error.')
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', values.get('P60_IMAGE_TAG') or 'local'):
            raise ValueError('P60_IMAGE_TAG must be a valid Docker image tag.')


def client_id(value):
    """Accept a Google web client identifier or explicitly disabled Google sign-in."""
    if not re.fullmatch(r'[A-Za-z0-9_.-]*', value):
        raise ValueError('GOOGLE_CLIENT_ID must be a Google web client ID or empty.')
    return value


def validate_local_file(text):
    """Reject dotenv quoting that plain Docker would pass literally instead of interpreting."""
    values = settings(text)
    for line in text.splitlines():
        match = ASSIGNMENT.match(line)
        if match and match[1] in ('P60_PORT', 'GOOGLE_CLIENT_ID', 'P60_SIGNUP_CODE'):
            if line.lstrip().startswith('export ') or match[2] != values[match[1]]:
                raise ValueError(f'{match[1]} must use a plain unquoted value for local Docker; use --update to normalize it.')


def finish_setup(args, target, values):
    """Explain the selected profile and optionally run its existing deployment helper."""
    url = 'https://' + values['P60_DOMAIN'] if args.vps else 'http://localhost:' + values.get('P60_PORT', '8085')
    print(f'Profile: {"VPS production" if args.vps else "local testing"} → {target.name}')
    print(f'App URL: {url}; host port: {values.get("P60_PORT", "8085")}. Signup: enabled.')
    print(f'Registration: {"organizer code required" if CONST.SIGNUP_CODE_REQUIRED else "no organizer code"}; no account cap or per-network signup budgets.')
    if values.get('GOOGLE_CLIENT_ID'):
        print(f'Authorize {url} in your Google web client JavaScript origins.')
    if args.vps:
        print('Point DNS and the shared HTTPS proxy at this app port; setup does not change the proxy.')
    command = ['bash', str(ROOT / 'scripts/restart-docker.sh')]
    if args.local:
        command.append('--local')
    command.append('--recreate')
    if args.start:
        print('Starting the selected Docker deployment...', flush=True)
        environment = {key: value for key, value in os.environ.items()
                       if key not in values and not key.startswith(('P60_', 'PREDICT60_'))
                       and key not in ('GOOGLE_CLIENT_ID', 'OILPRICE_API_KEY', 'TWELVE_DATA_API_KEY', 'COMPOSE_PROJECT_NAME')}
        return subprocess.run(command, cwd=ROOT, env=environment).returncode
    if not args.check:
        print('Next: sudo bash scripts/restart-docker.sh' + ('' if args.vps else ' --local') + ' --recreate')
    return 0


def main(argv=None):
    """Validate or configure one profile, optionally building and starting its app."""
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--vps', action='store_true', help='Configure the root .env for the VPS Compose stack')
    mode.add_argument('--local', action='store_true', help='Configure .env.local for local Docker')
    parser.add_argument('--update', action='store_true', help='Update an existing file after saving a private backup')
    parser.add_argument('--non-interactive', action='store_true', help='Use defaults and P60_* / GOOGLE_CLIENT_ID environment overrides')
    parser.add_argument('--check', action='store_true', help='Validate the saved profile without changing files or services')
    parser.add_argument('--start', action='store_true', help='Build and start the selected Docker deployment after setup')
    args = parser.parse_args(argv)
    if args.check and (args.update or args.start):
        parser.error('--check cannot be combined with --update or --start')
    target = ROOT / ('.env' if args.vps else '.env.local')
    try:
        if target.is_symlink():
            raise ValueError(f'Refusing to change a symlink: {target.name}')
        previous = target.read_text() if target.exists() else None
        if args.check and previous is None:
            raise ValueError(f'{target.name} is missing; run setup first.')
        if previous is not None and not args.update:
            template = (ROOT / 'deploy' / ('docker.env.example' if args.vps else 'local.env.example')).read_text()
            saved = settings(previous)
            values = {**settings(template), **saved}
            if args.vps and 'P60_DOMAIN' not in saved:
                values['P60_DOMAIN'] = ''
            try:
                if args.local:
                    validate_local_file(previous)
                validate_profile(values, args.vps)
            except ValueError as error:
                raise ValueError(f'{target.name}: {error} Run setup with --update to configure it.') from error
            if not args.check:
                target.chmod(0o600)
            print(f'{target.name} validated; settings preserved. Use --update to change them.')
            return finish_setup(args, target, values)
        if not args.non_interactive and not sys.stdin.isatty():
            raise ValueError('Use an interactive terminal, or --non-interactive with environment overrides.')
        template = (ROOT / 'deploy' / ('docker.env.example' if args.vps else 'local.env.example')).read_text()
        legacy = ROOT / 'docker.env'
        use_legacy = args.vps and previous is None and legacy.is_file()
        base = previous if previous is not None else legacy.read_text() if use_legacy else template
        defaults, existing = settings(template), settings(base)
        values = {**defaults, **existing}
        keys = ['P60_PORT', 'P60_SIGNUP_CODE', 'GOOGLE_CLIENT_ID']
        if args.vps:
            keys.extend(['P60_DOMAIN', 'P60_ADDITIONAL_ORIGINS', 'P60_MAX_REQUESTS', 'PREDICT60_LOG_LEVEL', 'P60_IMAGE_TAG'])
            if 'P60_DOMAIN' not in existing and existing.get('P60_HOST'):
                values['P60_DOMAIN'] = urlsplit(existing['P60_HOST']).hostname or values['P60_DOMAIN']
        elif previous is None and (ROOT / '.env').is_file():
            vps_port = settings((ROOT / '.env').read_text()).get('P60_PORT', '8085')
            values['P60_PORT'] = '8085' if vps_port == '18085' else '18085'
        values.update({key: os.environ[key] for key in keys if key in os.environ})
        interactive = not args.non_interactive
        chosen = {}
        if args.vps:
            chosen['P60_DOMAIN'] = ask('VPS domain (no https://)', values['P60_DOMAIN'], domain, interactive)
            aliases = values['P60_ADDITIONAL_ORIGINS']
            if previous is None and not use_legacy and chosen['P60_DOMAIN'] != defaults['P60_DOMAIN'] and 'P60_ADDITIONAL_ORIGINS' not in os.environ:
                aliases = ''
            chosen['P60_ADDITIONAL_ORIGINS'] = ask('Additional origins (comma-separated; enter - for none)', aliases, lambda value: origins('' if value == '-' else value), interactive)
            chosen.update({key: values[key] for key in ('P60_MAX_REQUESTS', 'PREDICT60_LOG_LEVEL', 'P60_IMAGE_TAG')})
        chosen['P60_PORT'] = ask('Published port', values['P60_PORT'], port, interactive)
        chosen['P60_SIGNUP_CODE'] = ask('Signup code (letters, numbers, . _ -)', values['P60_SIGNUP_CODE'], signup_code, interactive, secret=True) if CONST.SIGNUP_CODE_REQUIRED else values['P60_SIGNUP_CODE']
        chosen['GOOGLE_CLIENT_ID'] = ask('Google web client ID (enter - to disable)', values['GOOGLE_CLIENT_ID'], lambda value: client_id('' if value == '-' else value), interactive)
        validate_profile({**values, **chosen}, args.vps)
        save(target, render(base, template, chosen), previous)
        print(f'Configured {target.name} with private permissions (0600).')
        if use_legacy:
            print('Existing docker.env settings were reused; docker.env was left unchanged.')
        return finish_setup(args, target, {**values, **chosen})
    except (OSError, ValueError, EOFError, KeyboardInterrupt) as error:
        print(f'Setup stopped: {error or "input cancelled"}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
