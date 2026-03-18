from __future__ import annotations

from redis import Redis
from rq import Queue

from lpft_api.config import settings


def get_queue() -> Queue:
    redis_conn = Redis.from_url(settings.redis_url)
    return Queue("lpft", connection=redis_conn)
