FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PREDICT60_DB=/app/data/p60.sqlite3
WORKDIR /app

RUN groupadd --gid 10001 p60 \
    && useradd --uid 10001 --gid p60 --no-create-home p60 \
    && mkdir /app/data \
    && chown p60:p60 /app/data

COPY server.py contests.py p60_logging.py odds.py simulated_prices.py live_oil.py oilprice_api.py weather.py ./
COPY *.html *.css *.js *.seed.json ./
COPY assets/ ./assets/
COPY scripts/database.py scripts/contest-admin.py ./scripts/

USER p60
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).read()"]
CMD ["python3", "-u", "server.py", "--bind", "0.0.0.0", "--port", "8000"]
