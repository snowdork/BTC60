"""Read the local organizer code without loading deployment settings or shell code."""
import shlex


def local_signup_code(root):
    """Prefer the saved Python code, then the explicit local Compose setting."""
    try:
        return (root / 'data' / 'local-signup-code').read_text()
    except FileNotFoundError:
        pass
    try:
        lines = (root / '.env.local').read_text().splitlines()
    except FileNotFoundError:
        return ''
    code = ''
    for line in lines:
        key, separator, value = line.strip().partition('=')
        if separator and key.strip() in ('P60_SIGNUP_CODE', 'export P60_SIGNUP_CODE'):
            try:
                values = shlex.split(value, comments=True)
            except ValueError:
                return ''
            if len(values) > 1:
                return ''
            code = values[0] if values else ''
    return code
