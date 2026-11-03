"""Data sources: the hoopR mirror (season parquet + raw per-game JSON), PATCH files, ESPN, and input files."""
from __future__ import annotations

import time

import httpx

from nba_pipeline.config import USER_AGENT


def http_client(timeout: float = 60.0) -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=timeout, follow_redirects=True)


def get_with_retry(client: httpx.Client, url: str, params: dict | None = None, tries: int = 3) -> httpx.Response | None:
    """GET with a short backoff. Returns None after the last failure (404 fails fast)."""
    last: Exception | None = None
    for i in range(tries):
        try:
            r = client.get(url, params=params)
            if r.status_code == 404:
                return None
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(f"{r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return r
        except (httpx.HTTPError, OSError) as e:
            last = e
            if i < tries - 1:
                time.sleep(2 * (i + 1))
    if last is not None:
        import sys
        print(f"fetch failed: {url}: {last}", file=sys.stderr)
    return None
