import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const root = path.resolve(__dirname, '../..');

async function stopServer(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

export async function localRequestsOnly(context: BrowserContext, baseURL: string) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL) return route.continue();
    // Password-account coverage does not depend on the Google Identity widget.
    if (url.href === 'https://accounts.google.com/gsi/client') {
      return route.fulfill({ contentType: 'application/javascript', body: '' });
    }
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected external browser request: ${url.origin}${url.pathname}`);
  });
}

export const test = base.extend<{ appURL: string }>({
  appURL: async ({}, use, testInfo) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'p60-e2e-'));
    const virtualenv = path.join(root, '.venv/bin/python');
    const python = process.env.P60_E2E_PYTHON || (existsSync(virtualenv) ? virtualenv : 'python3');
    // Do not inherit provider keys, deployment origins, cookies, DB paths or proxies.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      P60_SIGNUP_CODE: '',
    };
    const child = spawn(python, ['test/e2e/server.py', '--database', path.join(directory, 'accounts.sqlite3')], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout!.on('data', (data) => { logs += data; });
    child.stderr!.on('data', (data) => { logs += data; });
    const lines = createInterface({ input: child.stdout! });
    try {
      const baseURL = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Account server startup timed out.\n${logs}`)), 10_000);
        const finish = (error?: Error, url?: string) => {
          clearTimeout(timer);
          if (error) reject(error); else resolve(url!);
        };
        child.once('error', (error) => finish(error));
        child.once('exit', (code, signal) => finish(new Error(`Account server exited (${code ?? signal}).\n${logs}`)));
        lines.on('line', (line) => {
          if (line.startsWith('{"baseURL":')) finish(undefined, JSON.parse(line).baseURL);
        });
      });
      const health = await fetch(`${baseURL}/healthz`);
      expect(health.ok, 'isolated database and server are ready').toBe(true);
      await health.arrayBuffer();
      await use(baseURL);
    } finally {
      await stopServer(child);
      lines.close();
      await rm(directory, { recursive: true, force: true });
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('backend.log', { body: logs, contentType: 'text/plain' });
      }
    }
  },
  baseURL: async ({ appURL }, use) => { await use(appURL); },
  context: async ({ context, appURL }, use) => {
    await localRequestsOnly(context, appURL);
    const errors: string[] = [];
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    await use(context);
    expect(errors, 'no uncaught browser JavaScript errors').toEqual([]);
  },
});

export { expect };

export const account = {
  name: 'Account Browser Tester',
  email: 'account@example.test',
  password: 'OriginalPass123!',
};

export async function seedAccount(page: Page) {
  // The page context receives the real HttpOnly session cookie from the API.
  const response = await page.request.post('/api/signup', {
    data: { ...account, confirmPassword: account.password },
  });
  expect(response.status(), 'create a disposable account through the real API').toBe(200);
}

export async function fillLogin(page: Page, password = account.password) {
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
}

export async function expectSignedIn(page: Page) {
  await expect(page).toHaveURL(/\/categories\.html$/);
  await expect(page.getByText(account.name, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
  const response = await page.request.get('/api/account');
  expect(response.status()).toBe(200);
  expect((await response.json()).user.email).toBe(account.email);
}
