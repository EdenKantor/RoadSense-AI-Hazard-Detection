"""
RQ worker entrypoint.

Run this script to start a single RQ worker listening on the `roadsense` queue.
For multi-worker mode (default for the demo), use ``worker_supervisor.py``
which spawns N copies of this script.

Usage:
    python worker_main.py
    python worker_main.py --name worker-2
    WORKER_NAME=worker-3 python worker_main.py

On Linux/macOS: uses standard Worker (fork-based job isolation).
On Windows: uses SimpleWorker (in-process, no fork required).

The worker name is exposed to the pipeline via the WORKER_NAME environment
variable so observability events can be tagged with it. CLI ``--name`` takes
precedence over the env var.

The worker will block and process jobs enqueued by the backend upload service.
"""
import argparse
import multiprocessing
import multiprocessing.context
import os
import sys

# RQ 2.x's scheduler does get_context('fork') at module load. On Windows there
# is no fork context, so we alias the spawn context under the name 'fork' to
# satisfy that lookup before we import rq below.
if sys.platform == "win32" and "fork" not in multiprocessing.context._concrete_contexts:
    _ctx = multiprocessing.get_context("spawn")
    multiprocessing.context._concrete_contexts["fork"] = _ctx

from rq import Worker, SimpleWorker
from queue_setup import redis_conn, roadsense_queue


def _resolve_worker_name(cli_name: str | None) -> str:
    """Pick a display name for this worker process.

    Args:
        cli_name: Value of the ``--name`` CLI flag, if any.

    Returns:
        The CLI value if provided, else ``WORKER_NAME`` from the environment,
        else the default ``"worker-1"``.
    """
    if cli_name:
        return cli_name
    env_name = os.environ.get("WORKER_NAME")
    if env_name:
        return env_name
    return "worker-1"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RoadSenseAI RQ worker")
    parser.add_argument("--name", default=None, help="Worker display name (e.g. worker-1)")
    args = parser.parse_args()

    name = _resolve_worker_name(args.name)
    # Make the name visible to observability.publish_event() in this process.
    os.environ["WORKER_NAME"] = name

    if sys.platform == "win32":
        print(f"[worker:{name}] Windows detected -- using SimpleWorker (no fork)")
        worker = SimpleWorker([roadsense_queue], connection=redis_conn, name=name)
    else:
        print(f"[worker:{name}] Starting standard Worker with fork-based isolation")
        worker = Worker([roadsense_queue], connection=redis_conn, name=name)

    print(f"[worker:{name}] ready -- listening on queue: roadsense")
    worker.work(with_scheduler=False)
