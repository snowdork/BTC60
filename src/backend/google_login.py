"""Verify Google Identity Services credentials; never trust browser profile fields."""
import os

DEFAULT_CLIENT_ID = "572697973282-e17b6uqatr36toqi48sohg6vigkarvai.apps.googleusercontent.com"


def verify_google_login(credential):
    """Check Google's signature, audience, issuer, expiry and verified account claims."""
    if not isinstance(credential, str) or not 1 <= len(credential) <= 7000:
        raise ValueError('Invalid Google credential.')
    client_id = os.environ.get('GOOGLE_CLIENT_ID', DEFAULT_CLIENT_ID).strip()
    if not client_id:
        raise RuntimeError('Google sign-in is not configured.')
    try:
        from google.auth.exceptions import GoogleAuthError, TransportError
        from google.oauth2 import id_token
        from google.auth.transport.requests import Request
    except ImportError as exc:
        raise RuntimeError('Google sign-in dependencies are not installed.') from exc

    class BoundedRequest(Request):
        """Avoid leaving a server worker waiting indefinitely for signing keys."""
        def __call__(self, *args, **kwargs):
            """Cap each signing-key HTTP request at ten seconds."""
            kwargs['timeout'] = 10
            return super().__call__(*args, **kwargs)

    transport = BoundedRequest()
    try:
        payload = id_token.verify_oauth2_token(credential, transport, audience=client_id)
    except TransportError as exc:
        raise RuntimeError('Google verification is temporarily unavailable.') from exc
    except (ValueError, GoogleAuthError) as exc:
        raise ValueError('Invalid Google credential.') from exc
    finally:
        transport.session.close()
    if (payload.get('iss') not in ('accounts.google.com', 'https://accounts.google.com')
            or payload.get('aud') != client_id
            or not isinstance(payload.get('sub'), str) or not 1 <= len(payload['sub']) <= 255
            or payload.get('email_verified') is not True
            or not isinstance(payload.get('email'), str) or not payload['email']):
        raise ValueError('Invalid Google account.')
    return {'googleSub': payload['sub'], 'email': payload['email'].strip().lower(),
            'name': payload.get('name') or '', 'picture': payload.get('picture') or ''}
