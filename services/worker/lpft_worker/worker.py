from __future__ import annotations

import sys
from rq import Worker
from redis import Redis

from lpft_worker.config import settings


def main() -> None:
    redis_conn = Redis.from_url(settings.redis_url)
    worker = Worker(["lpft"], connection=redis_conn)
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
    sys.exit(0)
