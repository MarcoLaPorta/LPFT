from __future__ import annotations

from redis import Redis
from rq import Queue, Worker

from lpft_api.config import settings


def get_queue() -> Queue:
    redis_conn = Redis.from_url(settings.redis_url)
    return Queue("lpft", connection=redis_conn)


def lpft_worker_available() -> bool:
    """
    True se Redis risponde ed esiste almeno un worker RQ in ascolto sulla coda ``lpft``.
    Se False, i job resterebbero in pending senza worker: l'API deve usare il backtest inline.
    """
    try:
        redis_conn = Redis.from_url(settings.redis_url)
        redis_conn.ping()
    except Exception:
        return False
    try:
        workers = Worker.all(connection=redis_conn)
    except Exception:
        return False
    for w in workers:
        for q in getattr(w, "queues", None) or []:
            if getattr(q, "name", None) == "lpft":
                return True
    return False
