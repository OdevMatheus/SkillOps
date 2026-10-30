---
name: "concurrency-race-detector"
description: "Use when debugging or authoring asynchronous Python coroutines, background worker pools, and concurrent task pipelines to detect event-loop blocking synchronous calls, orphaned fire-and-forget tasks, lock acquisition deadlocks, unbounded gather fan-out starvation, and non-idempotent retry storms across high-throughput distributed asyncio services before deploying background workers to production."
version: "1.0.0"
track: "python-backend"
tags:
  - "asyncio"
  - "concurrency"
  - "race-conditions"
  - "event-loop"
  - "deadlocks"
routing_signals:
  languages: ["python"]
  files_any: ["pyproject.toml", "workers.py", "tasks.py"]
  dependencies_any: ["anyio", "aiohttp", "celery", "redis"]
  negative_triggers:
    - "Do not trigger for synchronous CLI scripts, static SQL DDL migrations, or pure CSS layouts."
entrypoints:
  scripts:
    - path: "scripts/event_loop_blocking_scanner.py"
      description: "AST scanner detecting synchronous blocking calls and untracked tasks inside async def coroutines."
---

# Concurrency & Race Condition Detector (`concurrency-race-detector`)

## When to Use This Skill
Invoke this skill when authoring or troubleshooting `asyncio` coroutines, concurrent task groups, distributed locks, or background worker queues to prevent event-loop stalls, silent task garbage collection, and race conditions.

## Mandatory Execution Workflow

1. **Run the Deterministic Event-Loop Scanner First:**
   ```bash
   python catalog/python-backend/concurrency-race-detector/scripts/event_loop_blocking_scanner.py --path <target_dir_or_file> --json
   ```
2. **Eliminate Synchronous Event-Loop Blockers:**
   - Never invoke `time.sleep()`, `requests.*`, `urllib.request.*`, synchronous `open()`, or `subprocess.run()` directly inside an `async def` coroutine.
   - Replace with `await asyncio.sleep()`, `httpx.AsyncClient`, or offload CPU/blocking I/O via `await asyncio.to_thread(...)`.
3. **Prevent Orphaned Fire-and-Forget Tasks:**
   - Never call `asyncio.create_task(coro())` without storing a strong reference (e.g., `background_tasks.add(task); task.add_done_callback(background_tasks.discard)`) or using `asyncio.TaskGroup()`.
4. **Enforce Bounded Concurrency & Lock Ordering:**
   - Guard fan-out `asyncio.gather` calls with `asyncio.Semaphore(limit)` and wrap external awaits in `asyncio.timeout(seconds)`.
5. **Re-Verify Concurrency Safety:**
   - Re-run `event_loop_blocking_scanner.py` and confirm `"status": "ok"` with `0` blocking hazards.
