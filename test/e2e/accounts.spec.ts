import { account, expect, expectSignedIn, fillLogin, localRequestsOnly, seedAccount, test } from './fixtures';

test('signup creates an account, signs in, and restores the session after reload', async ({ page, context }) => {
  await page.goto('/signup.html');
  await expect(page.getByLabel('Signup code', { exact: true })).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill(account.name);
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Verify password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account', exact: false }).click();
  await expectSignedIn(page);

  const cookie = (await context.cookies()).find((cookie) => cookie.name === 'p60_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  await page.reload();
  await expectSignedIn(page);
  const response = await page.request.get('/api/account');
  const snapshot = await response.json();
  expect(snapshot.contestWallet.remaining_cents).toBe(100_000);
  expect(snapshot.predictions).toEqual([]);
});

test('signup rejects mismatched passwords and allows correction', async ({ page }) => {
  await page.goto('/signup.html');
  await page.getByLabel('Name', { exact: true }).fill(account.name);
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByLabel('Verify password', { exact: true }).fill('DifferentPass1!');
  await page.getByRole('button', { name: 'Create account', exact: false }).click();
  await expect(page.locator('#auth-error')).toHaveText('Passwords do not match.');
  expect((await page.request.get('/api/account')).status()).toBe(401);
  await page.getByLabel('Verify password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account', exact: false }).click();
  await expectSignedIn(page);
});

test('duplicate email cannot replace an existing account', async ({ page, context }) => {
  await seedAccount(page);
  await context.clearCookies();
  await page.goto('/signup.html');
  await page.getByLabel('Name', { exact: true }).fill('Duplicate Account');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('DifferentPass1!');
  await page.getByLabel('Verify password', { exact: true }).fill('DifferentPass1!');
  const response = page.waitForResponse((response) => response.url().endsWith('/api/signup'));
  await page.getByRole('button', { name: 'Create account', exact: false }).click();
  expect((await response).status()).toBe(409);
  await expect(page.locator('#auth-error')).toHaveText('Account or request already exists.');
  expect((await page.request.get('/api/account')).status()).toBe(401);
  await page.goto('/login.html');
  await fillLogin(page);
  await page.getByRole('button', { name: 'Log in', exact: false }).click();
  await expectSignedIn(page);
});

test('login rejects an incorrect password and succeeds after correction', async ({ page, context }) => {
  await seedAccount(page);
  await context.clearCookies();
  await page.goto('/login.html');
  await fillLogin(page, 'WrongPassword1!');
  await page.getByRole('button', { name: 'Log in', exact: false }).click();
  await expect(page.locator('#auth-error')).toHaveText('Email or password is incorrect.');
  await expect(page).toHaveURL(/\/login\.html$/);
  expect((await page.request.get('/api/account')).status()).toBe(401);
  await fillLogin(page);
  await page.getByRole('button', { name: 'Log in', exact: false }).click();
  await expectSignedIn(page);
});

test('unknown email does not create a session', async ({ page }) => {
  await page.goto('/login.html');
  await fillLogin(page);
  await page.getByRole('button', { name: 'Log in', exact: false }).click();
  await expect(page.locator('#auth-error')).toHaveText('Email or password is incorrect.');
  expect((await page.request.get('/api/account')).status()).toBe(401);
});

test('password visibility controls preserve typed values', async ({ page }) => {
  await page.goto('/signup.html');
  const password = page.getByLabel('Password', { exact: true });
  const confirmation = page.getByLabel('Verify password', { exact: true });
  await password.fill(account.password);
  await confirmation.fill(account.password);
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(confirmation).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue(account.password);
  await page.getByRole('button', { name: 'Show verified password', exact: true }).click();
  await expect(confirmation).toHaveAttribute('type', 'text');
  await expect(confirmation).toHaveValue(account.password);
});

for (const protectedPath of ['/categories.html', '/index.html', '/password.html', '/contests.html']) {
  test(`signed-out visitors cannot open ${protectedPath}`, async ({ page }) => {
    await page.goto(protectedPath);
    await expect(page).toHaveURL(/\/welcome\.html$/);
    await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
    expect((await page.request.get('/api/account')).status()).toBe(401);
  });
}

test('portfolio hides account data until the visitor logs in', async ({ page, context }) => {
  await seedAccount(page);
  await context.clearCookies();
  await page.goto('/portfolio.html');
  await expect(page).toHaveURL(/\/portfolio\.html$/);
  await expect(page.getByRole('heading', { name: 'Your predictions belong here.', exact: true })).toBeVisible();
  await expect(page.locator('#portfolio-content')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Refresh settlements', exact: false })).toBeDisabled();
  expect((await page.request.get('/api/account')).status()).toBe(401);
  await page.getByRole('link', { name: 'Log in', exact: false }).click();
  await fillLogin(page);
  await page.getByRole('button', { name: 'Log in', exact: false }).click();
  await expectSignedIn(page);
  await page.getByRole('link', { name: 'Portfolio', exact: true }).click();
  await expect(page.locator('#portfolio-content')).toBeVisible();
  await expect(page.locator('#portfolio-login')).toBeHidden();
  await expect(page.locator('#portfolio-balance')).toHaveText('1,000.00 credits');
  await expect(page.locator('#history-empty')).toContainText('No predictions yet.');
});

test('signed-in visitors bypass the welcome page', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/');
  await expectSignedIn(page);
  await page.goto('/welcome.html');
  await expectSignedIn(page);
});

test('logout revokes the server session and protects pages after reload', async ({ page, context }) => {
  await seedAccount(page);
  await page.goto('/categories.html');
  await expectSignedIn(page);
  const session = (await context.cookies()).find((cookie) => cookie.name === 'p60_session')!;
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/\/welcome\.html$/);
  expect((await context.cookies()).some((cookie) => cookie.name === 'p60_session')).toBe(false);
  expect((await page.request.get('/api/account')).status()).toBe(401);
  await page.reload();
  await expect(page).toHaveURL(/\/welcome\.html$/);
  // Replaying the old cookie must also fail: logout invalidates SQLite state.
  expect((await page.request.get('/api/account', { headers: { Cookie: `p60_session=${session.value}` } })).status()).toBe(401);
  await page.goto('/categories.html');
  await expect(page).toHaveURL(/\/welcome\.html$/);
});

test('a removed session sends an open protected page back to welcome', async ({ page, context }) => {
  await seedAccount(page);
  await page.goto('/categories.html');
  await expectSignedIn(page);
  // Clear the session cookie to model a returning browser without valid credentials.
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/welcome\.html$/);
  await expect(page.getByText(account.name, { exact: true })).toHaveCount(0);
});

test('password change rejects the wrong current password and mismatched confirmation', async ({ page }) => {
  await seedAccount(page);
  await page.goto('/categories.html');
  await page.getByRole('link', { name: 'Change password', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('WrongPassword1!');
  await page.getByLabel('New password', { exact: true }).fill('UpdatedPass123!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedPass123!');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.locator('#password-error')).toHaveText('Current password is incorrect.');
  await page.getByLabel('Current password', { exact: true }).fill(account.password);
  await page.getByLabel('Confirm new password', { exact: true }).fill('DifferentPass1!');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.locator('#password-error')).toHaveText('Passwords do not match.');
  await expect(page.locator('#password-status')).toBeEmpty();
  expect((await page.request.get('/api/account')).status()).toBe(200);
});

test('changing password keeps this session, revokes another device, and replaces credentials', async ({ page, browser, baseURL }) => {
  await seedAccount(page);
  const otherDevice = await browser.newContext({ baseURL });
  await localRequestsOnly(otherDevice, baseURL!);
  try {
    const otherPage = await otherDevice.newPage();
    await otherPage.goto('/login.html');
    await fillLogin(otherPage);
    await otherPage.getByRole('button', { name: 'Log in', exact: false }).click();
    await expectSignedIn(otherPage);

    await page.goto('/categories.html');
    await page.getByRole('link', { name: 'Change password', exact: true }).click();
    await page.getByLabel('Current password', { exact: true }).fill(account.password);
    await page.getByLabel('New password', { exact: true }).fill('UpdatedPass123!');
    await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedPass123!');
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Password changed. Other devices have been signed out.');
    await expect(page.getByLabel('Current password', { exact: true })).toBeEmpty();
    expect((await page.request.get('/api/account')).status()).toBe(200);
    expect((await otherDevice.request.get('/api/account')).status()).toBe(401);
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/welcome\.html$/);

    await page.goto('/categories.html');
    await expectSignedIn(page);
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(page).toHaveURL(/\/welcome\.html$/);
    await page.getByRole('link', { name: 'Log in', exact: true }).click();
    await fillLogin(page);
    await page.getByRole('button', { name: 'Log in', exact: false }).click();
    await expect(page.locator('#auth-error')).toHaveText('Email or password is incorrect.');
    await fillLogin(page, 'UpdatedPass123!');
    await page.getByRole('button', { name: 'Log in', exact: false }).click();
    await expectSignedIn(page);
  } finally {
    await otherDevice.close();
  }
});

test('login page Change password shortcut opens the password form', async ({ page, context }) => {
  await seedAccount(page);
  await context.clearCookies();
  await page.goto('/login.html');
  await fillLogin(page);
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page).toHaveURL(/\/password\.html$/);
  await expect(page.getByRole('heading', { name: 'Change password', exact: true })).toBeVisible();
  expect((await page.request.get('/api/account')).status()).toBe(200);
});
