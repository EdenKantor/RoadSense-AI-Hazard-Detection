"""
Multi-worker supervisor.

Spawns ``settings.worker_count`` copies of ``worker_main.py``, each with a
distinct ``--name`` (worker-1, worker-2, ...). Stdout/stderr from every
child are read line-by-line and printed with a colored worker-id prefix so
the operator can see which worker picked which job in a single terminal.

On Ctrl+C (SIGINT), all child processes are signalled and the supervisor
waits up to a few seconds for them to exit cleanly.

Cross-platform note:
    Windows uses CREATE_NEW_PROCESS_GROUP for child processes so that a
    Ctrl+Break event can be sent to them without also killing the supervisor.
    SimpleWorker still applies (the children import ``worker_main.py`` which
    keeps the fork->spawn patch).
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

# Make sibling modules importable when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import settings


# ANSI colors — picked to be readable on both white and dark terminals.
# When stdout isn't a TTY (e.g. piped to file) we fall back to plain text.
_COLORS = ["\033[36m", "\033[35m", "\033[33m", "\033[32m", "\033[34m", "\033[31m"]
_RESET = "\033[0m"


def _color_for(idx: int) -> str:
    """Return an ANSI color escape for worker ``idx`` (empty when not a TTY)."""
    if not sys.stdout.isatty():
        return ""
    return _COLORS[idx % len(_COLORS)]


def _reset() -> str:
    """Return the ANSI reset escape (empty when stdout is not a TTY)."""
    return _RESET if sys.stdout.isatty() else ""


def _stream_pipe(name: str, color: str, pipe) -> None:
    """Read a child stream line-by-line and print with a prefix."""
    prefix = f"{color}[{name}]{_reset()}"
    try:
        for raw in iter(pipe.readline, b""):
            try:
                line = raw.decode("utf-8", errors="replace").rstrip()
            except Exception:  # noqa: BLE001
                line = repr(raw)
            print(f"{prefix} {line}", flush=True)
    finally:
        try:
            pipe.close()
        except Exception:  # noqa: BLE001
            pass


def _spawn_worker(idx: int, worker_dir: Path) -> tuple[subprocess.Popen, str]:
    """Spawn one ``worker_main.py`` with ``--name worker-<idx+1>``."""
    name = f"worker-{idx + 1}"
    color = _color_for(idx)

    cmd = [sys.executable, "worker_main.py", "--name", name]
    env = os.environ.copy()
    # Force unbuffered child stdout so prefix lines stream in real time.
    env["PYTHONUNBUFFERED"] = "1"
    env["WORKER_NAME"] = name

    creationflags = 0
    if sys.platform == "win32":
        # CREATE_NEW_PROCESS_GROUP lets us send CTRL_BREAK_EVENT to the child
        # without affecting the supervisor.
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

    proc = subprocess.Popen(
        cmd,
        cwd=str(worker_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        creationflags=creationflags,
    )
    threading.Thread(target=_stream_pipe, args=(name, color, proc.stdout), daemon=True).start()
    print(f"{color}[supervisor]{_reset()} spawned {name} (PID {proc.pid})", flush=True)
    return proc, name


def _stop_all(procs: list[subprocess.Popen], timeout: float = 5.0) -> None:
    """Politely stop all children, then escalate if needed."""
    for proc in procs:
        if proc.poll() is not None:
            continue
        try:
            if sys.platform == "win32":
                proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                proc.terminate()
        except Exception:  # noqa: BLE001
            pass

    deadline = time.time() + timeout
    for proc in procs:
        remaining = max(0.0, deadline - time.time())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass


def main() -> int:
    """Spawn the configured number of workers and supervise them.

    Returns:
        Exit code: 0 on clean Ctrl+C shutdown, otherwise the non-zero exit
        code of the first child worker that died (or 1 if a worker exited
        with code 0 unexpectedly).
    """
    n = max(1, int(settings.worker_count))
    worker_dir = Path(__file__).resolve().parent
    print(f"[supervisor] starting {n} worker(s)", flush=True)

    procs: list[subprocess.Popen] = []
    try:
        for idx in range(n):
            proc, _ = _spawn_worker(idx, worker_dir)
            procs.append(proc)
            # Tiny stagger so the [worker:N] startup banners don't interleave badly.
            time.sleep(0.15)

        # Wait for any child to exit. If ANY exits non-zero the supervisor
        # also exits — this prevents zombie partial deployments.
        while True:
            for proc in procs:
                rc = proc.poll()
                if rc is not None:
                    print(f"[supervisor] worker process PID {proc.pid} exited with code {rc}", flush=True)
                    return rc if rc != 0 else 1
            time.sleep(0.5)

    except KeyboardInterrupt:
        print("[supervisor] Ctrl+C — stopping workers...", flush=True)
        _stop_all(procs)
        return 0


if __name__ == "__main__":
    sys.exit(main())
