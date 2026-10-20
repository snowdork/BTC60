# LAMP VPS compatibility review

Docker deployment notes updated October 19, 2026; original capacity review October 14, 2026. This is a source review and local test result, not a verification of a connected VPS.

## Docker deployment

The repository now includes a Dockerfile and Compose stack for one Python app
container and Caddy. Follow [the VPS guide](../deploy/README.md) and
[Docker instructions](../deploy/DOCKER.md). Docker Engine and Compose are required;
PHP and MySQL are not used by this app. Existing Apache listeners on ports 80/443
must be reconciled with the supplied Caddy port mappings before deployment.

The backend listens on `0.0.0.0` inside its container with no host port published.
SQLite lives in a named volume and Docker handles process crash recovery.
Caddy has a fixed private address trusted by the backend. Host systemd deployment
continues to use a loopback listener. Container build, TLS, crash recovery, and
VPS load tests still require execution on a Docker-capable host; see the
[test guide](TEST_GUIDE.md).

## Compatibility

The frontend is plain HTML/CSS/JavaScript. The API is Python 3.10+ and uses SQLite, not PHP or MySQL/MariaDB. A LAMP VPS can host it if Python services and Apache reverse proxy configuration are permitted. Uploading files into a PHP document root alone does not provide the API.

Suggested architecture: browser → HTTPS reverse proxy → loopback Python API,
with SQLite on local persistent storage. The supplied deployment uses Caddy to
proxy the complete application so backend authentication still protects terminal
pages. An Apache installation can instead serve only `dist/` and proxy `/api/`,
but must preserve equivalent access controls. Never use the repository root as a
public document root: it contains backend code and operational files. Keep the
backend running as a dedicated service; it also runs automatic settlement. The
current startup permits only one server process per database.

Apache reverse proxy reference: https://httpd.apache.org/docs/2.4/howto/reverse_proxy.html

## Application deployment protections

- Configure `P60_HOST=https://predict60.com` in the backend service environment. POST Origin headers must match this exact origin, HTTPS enables Secure cookies and HSTS, and malformed values fail startup.
- Configure `P60_TRUSTED_PROXIES` with only the direct proxy address. The app accepts one validated `X-Forwarded-For` address from those peers and otherwise uses the socket address for authentication throttling.
- Keep the backend private: loopback for the host deployment, or an unpublished port on the Docker network. The supplied Caddy and hardened systemd units provide TLS termination, security headers, health checks, process supervision, and persistent service logs for a controlled beta.
- The backend still derives from Python `ThreadingHTTPServer`. Complete a production server refactor before treating the service as a high-assurance or large public deployment.
- Public self-service accounts still need an email provider and flows for email verification and password recovery. Until then, use controlled beta access.

## Deployment requirements

Keep database, keys, and backups outside Apache's document root. Set PREDICT60_DB to a writable persistent local path for the backend service user. Supply provider keys through server-only configuration. Allow outbound provider connections. Test provider subscriptions on the VPS: OilPriceAPI assessments do not support hourly prediction settlement; unsupported Twelve Data grades remain unavailable.

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

Code-derived traffic estimates: 50 visible signed-in tabs check settlement every 15 seconds (about 3.3 requests/second on average, potentially synchronized). If Oil is re-enabled, fifty oil prediction tabs would poll spot every five seconds (about 10 requests/second). The dormant Oil category currently does not request quotes. An enabled implementation with fifty category-selection tabs could poll five grades every five seconds (about 50 requests/second when all five are supported/configured). Initial page loads, history refreshes, orders, and manual actions add traffic. Crypto WebSockets connect directly from browsers to Coinbase.

Remaining capacity concerns:

- Verify forwarded client-IP handling through the actual proxy. Configure only its direct address as trusted and have it overwrite X-Forwarded-For with one client address; otherwise authentication throttling may group users under the proxy address.
- Crypto order confirmation fetches benchmark and spot from the provider for each order; history cache misses can duplicate provider requests across clients. Test cold starts and synchronized orders against provider quotas and add shared request deduplication where appropriate.
- OilPriceAPI holds a shared lock during provider fetches. Slow provider responses can queue requests across grades.
- Account responses return complete prediction history without pagination. Test realistic accumulated history, not only new accounts.
- Run the final load test through Apache/HTTPS on the actual VPS: 50 active sessions for at least 15 minutes, simultaneous order bursts, an interval settlement boundary, and login bursts from distinct client addresses. Monitor errors, p95 response time, CPU/RAM, SQLite lock errors, provider rate limits, and settlement correctness.

SQLite WAL permits concurrent readers but only one writer at a time: https://www.sqlite.org/wal.html
Python's http.server is not recommended for production: https://docs.python.org/3/library/http.server.html
