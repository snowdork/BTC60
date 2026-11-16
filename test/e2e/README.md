# TypeScript Playwright backup

This account suite is retained as an optional backup for troubleshooting and
comparison. Use the [Python Playwright suite](../e2e_python/README.md) for routine
development and release validation, and add new browser coverage there.

The backup runs 17 account scenarios on desktop Chromium and emulated Pixel 7,
for 34 checks. Terminal-navigation coverage lives in the primary Python suite.
Both suites use the Python server launcher in this directory, `server.py`.

From the repository root, with application Python dependencies installed:

```bash
npm ci
npx playwright install chromium
npm run test:e2e:accounts -- --retries=0 --output=test-results/e2e_typescript
```

The separate output directory preserves primary Python artifacts when both
suites are run. The HTML report is written to `playwright-report/`.

See the [backup test guide](../../doc/TEST_GUIDE.md#typescript-playwright-backup)
for requirements, device selection, reports and debugging commands.
