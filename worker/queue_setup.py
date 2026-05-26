"""Redis connection and RQ Queue bootstrap.

Import ``redis_conn`` and ``roadsense_queue`` wherever needed in the worker.

Windows compatibility note:
    RQ 2.x's ``scheduler`` module calls
    ``multiprocessing.get_context('fork').Process`` at import time, which
    fails on Windows because the ``fork`` context is POSIX-only. The patch
    below registers the ``spawn`` context under the name ``"fork"`` in the
    private ``multiprocessing.context._concrete_contexts`` table so that the
    subsequent ``import rq`` succeeds without modifying RQ itself.
"""
import multiprocessing
import multiprocessing.context
import sys

# RQ 2.x's scheduler does get_context('fork') at module load. On Windows there
# is no fork context, so we alias the spawn context under the name 'fork' to
# satisfy that lookup before we import rq below.
if sys.platform == "win32" and "fork" not in multiprocessing.context._concrete_contexts:
    _ctx = multiprocessing.get_context("spawn")
    multiprocessing.context._concrete_contexts["fork"] = _ctx

import redis
from rq import Queue
from config import settings

redis_conn = redis.from_url(settings.redis_url)
roadsense_queue = Queue("roadsense", connection=redis_conn)
