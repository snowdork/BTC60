# LAMP VPS compatibility review

Reviewed October 14, 2026. This is a source review and local test result, not a verification of a connected VPS.

## Compatibility

The frontend is plain HTML/CSS/JavaScript. The API is Python 3.10+ and uses SQLite, not PHP or MySQL/MariaDB. A LAMP VPS can host it if Python services and Apache reverse proxy configuration are permitted. Uploading files into a PHP document root alone does not provide the API.

Suggested architecture: browser → Apache HTTPS → loopback Python API, with SQLite on local persistent storage. Apache can serve only dist/ as its document root and proxy /api/ to the backend. Set DirectoryIndex welcome.html. Never use the repository root as a public document root: it contains backend code, credentials, and database files. Keep the backend running as a dedicated service; it also runs automatic settlement. The current startup permits only one server process per database.

Apache reverse proxy reference: https://httpd.apache.org/docs/2.4/howto/reverse_proxy.html

## Blockers before publication

- server.py do_POST compares Origin against http://Host only. HTTPS browser requests will fail with 403; deployment needs an explicit configured public HTTPS origin and matching proxy configuration.
- Session cookies currently omit Secure, both at login and logout. Add HTTPS deployment cookie configuration.
- The backend uses Python http.server.ThreadingHTTPServer, described as a local demo server. A production backend/server strategy and process supervision remain necessary; adding Apache alone does not verify production readiness.
- Authentication throttling uses the direct socket client address. Behind Apache this will be loopback for all users; implement trusted proxy client address handling or suitable edge throttling.

## Deployment requirements

Keep database, keys, and backups outside Apache's document root. Set BTC60_DB to a writable persistent local path for the backend service user. Supply provider keys through server-only configuration. Allow outbound provider connections. Test provider subscriptions on the VPS: OilPriceAPI assessments do not support hourly prediction settlement; unsupported Twelve Data grades remain unavailable.

After HTTPS configuration, verify signup, login, logout, session invalidation, predictions, filters/sorting, settlement after restart, and backup/restore through the public domain. No VPS or Apache instance was available in the local environment for an end-to-end deployment check.

## Capacity target: 50 simultaneous users

Proposed VPS: 4 vCPU, 8 GB RAM, 200 GB NVMe. These resources are a reasonable starting capacity for this app at 50 active users; this is an engineering estimate, not a measured result on that VPS. MySQL/PHP and other hosted workloads will consume some of those resources. Unmetered transfer does not specify port speed; data-center choice mostly affects latency rather than application concurrency.

An isolated local HTTP test used 50 client workers, 50 seeded authenticated users, a temporary SQLite database, and the existing ThreadingHTTPServer. It did not modify the application database. Provider functions for orders were mocked to return immediately. Sessions were seeded, so authentication throughput was not tested. No Apache/TLS or real provider traffic was included, and each user had at most one prediction.

| Scenario | Requests | Successes | Median latency | 95th percentile latency | Total elapsed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Account reads, empty history | 500 | 500 HTTP 200 | 23.9 ms | 1,061.5 ms | 2.363 s |
| Concurrent order submissions | 50 | 50 HTTP 201 | 208.6 ms | 1,109.8 ms | 1.206 s |
| Account reads after orders | 500 | 500 HTTP 200 | 14.4 ms | 1,269.6 ms | 3.068 s |

This shows basic local concurrency works, not that the proposed VPS or production deployment has passed a load test.

Code-derived traffic estimates: 50 visible signed-in tabs check settlement every 15 seconds (about 3.3 requests/second on average, potentially synchronized). Fifty oil prediction tabs poll spot every five seconds (about 10 requests/second). Fifty category-selection tabs can poll five grades every five seconds (about 50 requests/second when all five are supported/configured). Initial page loads, history refreshes, orders, and manual actions add traffic. Crypto WebSockets connect directly from browsers to Coinbase.

Remaining capacity concerns:

- Apache currently makes every login appear to come from loopback: the 20-attempt/minute authentication limit would apply to everyone together. Fix trusted client-IP handling or edge throttling before inviting 50 users.
- Crypto order confirmation fetches benchmark and spot from the provider for each order; history cache misses can duplicate provider requests across clients. Test cold starts and synchronized orders against provider quotas and add shared request deduplication where appropriate.
- OilPriceAPI holds a shared lock during provider fetches. Slow provider responses can queue requests across grades.
- Account responses return complete prediction history without pagination. Test realistic accumulated history, not only new accounts.
- Run the final load test through Apache/HTTPS on the actual VPS: 50 active sessions for at least 15 minutes, simultaneous order bursts, an interval settlement boundary, and login bursts from distinct client addresses. Monitor errors, p95 response time, CPU/RAM, SQLite lock errors, provider rate limits, and settlement correctness.

SQLite WAL permits concurrent readers but only one writer at a time: https://www.sqlite.org/wal.html
Python's http.server is not recommended for production: https://docs.python.org/3/library/http.server.html
