"""Shared account actions and network restrictions for the Python browser suite."""

import re
from urllib.parse import urlsplit

from playwright.sync_api import BrowserContext, Page, Route, expect

ACCOUNT = {
    'name': 'Account Browser Tester',
    'email': 'account@example.test',
    'password': 'OriginalPass123!',
}


def local_requests_only(context: BrowserContext, base_url: str, errors: list[str]):
    """Allow the local app and stub Google Identity without contacting providers."""
    def handle_route(route: Route):
        """Record and block any browser request outside the isolated application."""
        url = urlsplit(route.request.url)
        if f'{url.scheme}://{url.netloc}' == base_url:
            route.continue_()
        elif route.request.url == 'https://accounts.google.com/gsi/client':
            route.fulfill(content_type='application/javascript', body='')
        else:
            errors.append(f'Unexpected external browser request: {url.scheme}://{url.netloc}{url.path}')
            route.abort('blockedbyclient')

    context.route('**/*', handle_route)
    context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))


def seed_account(page: Page):
    """Create a disposable account and retain its real HttpOnly session cookie."""
    response = page.request.post('/api/signup', data={**ACCOUNT, 'confirmPassword': ACCOUNT['password']})
    assert response.status == 200, response.text()


def fill_login(page: Page, password: str = ACCOUNT['password']):
    """Fill the password login form with the disposable account's credentials."""
    page.get_by_label('Email', exact=True).fill(ACCOUNT['email'])
    page.get_by_label('Password', exact=True).fill(password)


def expect_signed_in(page: Page):
    """Verify rendered account controls and the authoritative server identity."""
    expect(page).to_have_url(re.compile(r'/categories\.html$'))
    expect(page.get_by_text(ACCOUNT['name'], exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='Log out', exact=True)).to_be_visible()
    response = page.request.get('/api/account')
    assert response.status == 200
    assert response.json()['user']['email'] == ACCOUNT['email']
