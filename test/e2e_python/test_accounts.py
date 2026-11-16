"""The same 17 account scenarios as test/e2e/accounts.spec.ts, in Python."""

import re

from playwright.sync_api import BrowserContext, Page, expect
import pytest
from pytest_playwright import CreateContextCallback

from .helpers import ACCOUNT, expect_signed_in, fill_login, seed_account


def test_signup_creates_account_and_restores_session_after_reload(page: Page, context: BrowserContext):
    """Sign up in the UI, verify cookie flags and restore the hourly wallet."""
    page.goto('/signup.html')
    expect(page.get_by_label('Signup code', exact=True)).to_have_count(0)
    page.get_by_label('Name', exact=True).fill(ACCOUNT['name'])
    page.get_by_label('Email', exact=True).fill(ACCOUNT['email'])
    page.get_by_label('Password', exact=True).fill(ACCOUNT['password'])
    page.get_by_label('Verify password', exact=True).fill(ACCOUNT['password'])
    page.get_by_role('button', name='Create account', exact=False).click()
    expect_signed_in(page)

    cookie = next(cookie for cookie in context.cookies() if cookie['name'] == 'p60_session')
    assert cookie['httpOnly'] is True
    assert cookie['sameSite'] == 'Lax'
    assert cookie['path'] == '/'
    page.reload()
    expect_signed_in(page)
    snapshot = page.request.get('/api/account').json()
    assert snapshot['contestWallet']['remaining_cents'] == 100_000
    assert snapshot['predictions'] == []


def test_signup_rejects_mismatched_passwords_and_allows_correction(page: Page):
    """A mismatched confirmation leaves the visitor signed out until corrected."""
    page.goto('/signup.html')
    page.get_by_label('Name', exact=True).fill(ACCOUNT['name'])
    page.get_by_label('Email', exact=True).fill(ACCOUNT['email'])
    page.get_by_label('Password', exact=True).fill(ACCOUNT['password'])
    page.get_by_label('Verify password', exact=True).fill('DifferentPass1!')
    page.get_by_role('button', name='Create account', exact=False).click()
    expect(page.locator('#auth-error')).to_have_text('Passwords do not match.')
    assert page.request.get('/api/account').status == 401
    page.get_by_label('Verify password', exact=True).fill(ACCOUNT['password'])
    page.get_by_role('button', name='Create account', exact=False).click()
    expect_signed_in(page)


def test_duplicate_email_cannot_replace_existing_account(page: Page, context: BrowserContext):
    """Duplicate signup must preserve the original account name and credentials."""
    seed_account(page)
    context.clear_cookies()
    page.goto('/signup.html')
    page.get_by_label('Name', exact=True).fill('Duplicate Account')
    page.get_by_label('Email', exact=True).fill(ACCOUNT['email'])
    page.get_by_label('Password', exact=True).fill('DifferentPass1!')
    page.get_by_label('Verify password', exact=True).fill('DifferentPass1!')
    with page.expect_response(lambda response: response.url.endswith('/api/signup')) as response:
        page.get_by_role('button', name='Create account', exact=False).click()
    assert response.value.status == 409
    expect(page.locator('#auth-error')).to_have_text('Account or request already exists.')
    assert page.request.get('/api/account').status == 401
    page.goto('/login.html')
    fill_login(page)
    page.get_by_role('button', name='Log in', exact=False).click()
    expect_signed_in(page)


def test_login_rejects_incorrect_password_and_succeeds_after_correction(page: Page, context: BrowserContext):
    """A failed login is recoverable without leaving the login form."""
    seed_account(page)
    context.clear_cookies()
    page.goto('/login.html')
    fill_login(page, 'WrongPassword1!')
    page.get_by_role('button', name='Log in', exact=False).click()
    expect(page.locator('#auth-error')).to_have_text('Email or password is incorrect.')
    expect(page).to_have_url(re.compile(r'/login\.html$'))
    assert page.request.get('/api/account').status == 401
    fill_login(page)
    page.get_by_role('button', name='Log in', exact=False).click()
    expect_signed_in(page)


def test_unknown_email_does_not_create_session(page: Page):
    """An unregistered email cannot authenticate or receive account data."""
    page.goto('/login.html')
    fill_login(page)
    page.get_by_role('button', name='Log in', exact=False).click()
    expect(page.locator('#auth-error')).to_have_text('Email or password is incorrect.')
    assert page.request.get('/api/account').status == 401


def test_password_visibility_controls_preserve_typed_values(page: Page):
    """Each visibility toggle affects its own input without clearing its value."""
    page.goto('/signup.html')
    password = page.get_by_label('Password', exact=True)
    confirmation = page.get_by_label('Verify password', exact=True)
    password.fill(ACCOUNT['password'])
    confirmation.fill(ACCOUNT['password'])
    page.get_by_role('button', name='Show password', exact=True).click()
    expect(password).to_have_attribute('type', 'text')
    expect(confirmation).to_have_attribute('type', 'password')
    expect(page.get_by_role('button', name='Hide password', exact=True)).to_have_attribute('aria-pressed', 'true')
    page.get_by_role('button', name='Hide password', exact=True).click()
    expect(password).to_have_attribute('type', 'password')
    expect(password).to_have_value(ACCOUNT['password'])
    page.get_by_role('button', name='Show verified password', exact=True).click()
    expect(confirmation).to_have_attribute('type', 'text')
    expect(confirmation).to_have_value(ACCOUNT['password'])


@pytest.mark.parametrize('protected_path', ['/categories.html', '/index.html', '/password.html', '/contests.html'])
def test_signed_out_visitors_cannot_open_protected_pages(page: Page, protected_path: str):
    """Direct protected navigation returns guests to the welcome page."""
    page.goto(protected_path)
    expect(page).to_have_url(re.compile(r'/welcome\.html$'))
    expect(page.get_by_role('link', name='Log in', exact=True)).to_be_visible()
    assert page.request.get('/api/account').status == 401


def test_portfolio_hides_account_data_until_visitor_logs_in(page: Page, context: BrowserContext):
    """The public portfolio prompt reveals personal history only after login."""
    seed_account(page)
    context.clear_cookies()
    page.goto('/portfolio.html')
    expect(page).to_have_url(re.compile(r'/portfolio\.html$'))
    expect(page.get_by_role('heading', name='Your predictions belong here.', exact=True)).to_be_visible()
    expect(page.locator('#portfolio-content')).to_be_hidden()
    expect(page.get_by_role('button', name='Refresh settlements', exact=False)).to_be_disabled()
    assert page.request.get('/api/account').status == 401
    page.get_by_role('link', name='Log in', exact=False).click()
    fill_login(page)
    page.get_by_role('button', name='Log in', exact=False).click()
    expect_signed_in(page)
    page.get_by_role('link', name='Portfolio', exact=True).click()
    expect(page.locator('#portfolio-content')).to_be_visible()
    expect(page.locator('#portfolio-login')).to_be_hidden()
    expect(page.locator('#portfolio-balance')).to_have_text('1,000.00 credits')
    expect(page.locator('#history-empty')).to_contain_text('No predictions yet.')


def test_signed_in_visitors_bypass_welcome_page(page: Page):
    """Both welcome entry URLs redirect a returning account to markets."""
    seed_account(page)
    page.goto('/')
    expect_signed_in(page)
    page.goto('/welcome.html')
    expect_signed_in(page)


def test_logout_revokes_session_and_protects_pages_after_reload(page: Page, context: BrowserContext):
    """Logout removes the cookie and makes replay of the old session fail."""
    seed_account(page)
    page.goto('/categories.html')
    expect_signed_in(page)
    session = next(cookie for cookie in context.cookies() if cookie['name'] == 'p60_session')
    page.get_by_role('button', name='Log out', exact=True).click()
    expect(page).to_have_url(re.compile(r'/welcome\.html$'))
    assert not any(cookie['name'] == 'p60_session' for cookie in context.cookies())
    assert page.request.get('/api/account').status == 401
    page.reload()
    expect(page).to_have_url(re.compile(r'/welcome\.html$'))
    response = page.request.get('/api/account', headers={'Cookie': f"p60_session={session['value']}"})
    assert response.status == 401
    page.goto('/categories.html')
    expect(page).to_have_url(re.compile(r'/welcome\.html$'))


def test_removed_session_sends_open_protected_page_back_to_welcome(page: Page, context: BrowserContext):
    """A returning browser without its session cookie cannot restore protected UI."""
    seed_account(page)
    page.goto('/categories.html')
    expect_signed_in(page)
    context.clear_cookies()
    page.reload()
    expect(page).to_have_url(re.compile(r'/welcome\.html$'))
    expect(page.get_by_text(ACCOUNT['name'], exact=True)).to_have_count(0)


def test_password_change_rejects_wrong_password_and_mismatched_confirmation(page: Page):
    """Invalid password changes report errors while retaining the valid session."""
    seed_account(page)
    page.goto('/categories.html')
    page.get_by_role('link', name='Change password', exact=True).click()
    page.get_by_label('Current password', exact=True).fill('WrongPassword1!')
    page.get_by_label('New password', exact=True).fill('UpdatedPass123!')
    page.get_by_label('Confirm new password', exact=True).fill('UpdatedPass123!')
    page.get_by_role('button', name='Change password', exact=True).click()
    expect(page.locator('#password-error')).to_have_text('Current password is incorrect.')
    page.get_by_label('Current password', exact=True).fill(ACCOUNT['password'])
    page.get_by_label('Confirm new password', exact=True).fill('DifferentPass1!')
    page.get_by_role('button', name='Change password', exact=True).click()
    expect(page.locator('#password-error')).to_have_text('Passwords do not match.')
    expect(page.locator('#password-status')).to_be_empty()
    assert page.request.get('/api/account').status == 200


def test_changing_password_keeps_session_revokes_other_device_and_replaces_credentials(
    page: Page, new_context: CreateContextCallback,
):
    """Change credentials in the UI and verify both devices and later logins."""
    seed_account(page)
    other_device = new_context()
    try:
        other_page = other_device.new_page()
        other_page.goto('/login.html')
        fill_login(other_page)
        other_page.get_by_role('button', name='Log in', exact=False).click()
        expect_signed_in(other_page)

        page.goto('/categories.html')
        page.get_by_role('link', name='Change password', exact=True).click()
        page.get_by_label('Current password', exact=True).fill(ACCOUNT['password'])
        page.get_by_label('New password', exact=True).fill('UpdatedPass123!')
        page.get_by_label('Confirm new password', exact=True).fill('UpdatedPass123!')
        page.get_by_role('button', name='Change password', exact=True).click()
        expect(page.get_by_role('status')).to_have_text('Password changed. Other devices have been signed out.')
        expect(page.get_by_label('Current password', exact=True)).to_be_empty()
        assert page.request.get('/api/account').status == 200
        assert other_device.request.get('/api/account').status == 401
        other_page.reload()
        expect(other_page).to_have_url(re.compile(r'/welcome\.html$'))

        page.goto('/categories.html')
        expect_signed_in(page)
        page.get_by_role('button', name='Log out', exact=True).click()
        expect(page).to_have_url(re.compile(r'/welcome\.html$'))
        page.get_by_role('link', name='Log in', exact=True).click()
        fill_login(page)
        page.get_by_role('button', name='Log in', exact=False).click()
        expect(page.locator('#auth-error')).to_have_text('Email or password is incorrect.')
        fill_login(page, 'UpdatedPass123!')
        page.get_by_role('button', name='Log in', exact=False).click()
        expect_signed_in(page)
    finally:
        other_device.close()


def test_login_change_password_shortcut_opens_password_form(page: Page, context: BrowserContext):
    """The login-page shortcut authenticates before opening password settings."""
    seed_account(page)
    context.clear_cookies()
    page.goto('/login.html')
    fill_login(page)
    page.get_by_role('button', name='Change password', exact=True).click()
    expect(page).to_have_url(re.compile(r'/password\.html$'))
    expect(page.get_by_role('heading', name='Change password', exact=True)).to_be_visible()
    assert page.request.get('/api/account').status == 200
