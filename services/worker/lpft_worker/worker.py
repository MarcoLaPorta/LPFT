from __future__ import annotations

import os
import sys

from redis import Redis
from rq import SimpleWorker, Worker

from lpft_worker.config import settings


def _worker_class() -> type[Worker]:
    worker_mode = os.getenv("LPFT_WORKER_CLASS", "").strip().lower()
    if worker_mode == "simple":
        return SimpleWorker
    if worker_mode == "worker":
        return Worker

    # macOS + forked workers can crash when jobs initialize
    # Objective-C-backed libraries (for example curl/yfinance).
    if sys.platform == "darwin":
        return SimpleWorker
    return Worker


def main() -> None:
    redis_conn = Redis.from_url(settings.redis_url)
    worker_cls = _worker_class()
    worker = worker_cls(["lpft"], connection=redis_conn)
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
    sys.exit(0)
