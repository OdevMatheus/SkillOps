---
name: "fastapi-async-guard"
description: "Use when building, refactoring, or reviewing FastAPI endpoints, async def route handlers, and Pydantic v2 BaseModel schemas in Python backends to prevent event-loop blocking calls such as time.sleep or synchronous requests, eliminate mutable field defaults without default_factory, and enforce explicit response_model or return type contracts. Do not trigger for Django synchronous views, Flask WSGI apps, or frontend UI code."
version: "1.0.0"
track: "python-backend"
tags:
  - "fastapi"
  - "pydantic"
  - "asyncio"
  - "python-backend"
  - "api-hygiene"
routing_signals:
  languages: ["python"]
  files_any: ["pyproject.toml", "requirements.txt", "app/main.py", "main.py"]
  dependencies_any: ["fastapi", "pydantic", "starlette", "uvicorn"]
  negative_triggers:
    - "Do not trigger for synchronous Django views, Flask WSGI handlers, or frontend UI code."
entrypoints:
  scripts:
    - path: "scripts/audit_fastapi_async.py"
      description: "Static Python AST auditor detecting blocking calls inside async def handlers, mutable Pydantic BaseModel defaults, and missing FastAPI response contracts."
---

# FastAPI Async Guard (`fastapi-async-guard`)

## When to Use This Skill
Invoke this skill whenever authoring, refactoring, or reviewing **FastAPI** routers, `async def` dependencies/handlers, or **Pydantic v2** `BaseModel` schemas so single-threaded `asyncio` workers never stall under concurrency and response payloads remain strictly typed.

## Mandatory Execution Workflow

1. **Run the Deterministic AST Auditor First:**
   Execute the bundled offline AST checker against the target file or backend package before proposing edits:
   ```bash
   python catalog/python-backend/fastapi-async-guard/scripts/audit_fastapi_async.py --path <target_dir_or_file> --json
   ```
   Exit code `0` means `"status": "ok"`; `1` indicates findings requiring remediation; `2` indicates an invalid path.

2. **Eliminate Event-Loop Blocking Calls (`async-blocking-sleep`, `async-blocking-http`):**
   - Never call `time.sleep(...)` inside an `async def` route or dependency; replace it with `await asyncio.sleep(...)`.
   - Never call `requests.get/post/put/delete/request(...)`, synchronous `urllib.request.urlopen(...)`, or top-level `httpx.get(...)` inside `async def` functions.
   - Prefer shared `httpx.AsyncClient` instances managed via FastAPI `lifespan` context managers (`await client.get(...)`), or offload unavoidable legacy synchronous SDK calls via `await fastapi.concurrency.run_in_threadpool(sync_fn, *args)` (or convert pure synchronous routes to plain `def` so Starlette runs them in its worker threadpool).

3. **Replace Mutable Pydantic Defaults (`pydantic-mutable-default`):**
   - Never assign literal `[]`, `{}`, `set()`, `list()`, or `dict()` directly on `BaseModel` / `BaseSettings` fields (`tags: list[str] = []`).
   - Always declare `Field(default_factory=list)` (or `dict` / `set`) from `pydantic` so per-instance defaults stay explicit, self-documenting, and safe across model subclasses and validators.
   - Use `ClassVar[...]` from `typing` when defining immutable class-level lookup constants on a model.

4. **Enforce Explicit FastAPI Response Contracts (`fastapi-missing-response-model`, `fastapi-untyped-response-model`):**
   - Every `@router.<method>(...)` or `@app.<method>(...)` handler must declare an explicit Pydantic `response_model=OutSchema` or a concrete return type annotation (`-> OutSchema`, `-> list[OutSchema]`, or `-> None` for `204 No Content`).
   - Avoid returning bare `dict` or `Any` from route handlers; unfiltered ORM or dictionary returns risk leaking internal attributes (such as `hashed_password` or internal audit metadata) and degrade generated OpenAPI client schemas.

5. **Re-Verify with the Bundled Script:**
   Re-run `audit_fastapi_async.py --path <target_dir_or_file> --json` and confirm `"status": "ok"` (exit code `0`) before completing the task.

## Rule Reference

| Rule ID | Severity | Remediation |
| :--- | :---: | :--- |
| `async-blocking-sleep` | `error` | Replace `time.sleep(s)` with `await asyncio.sleep(s)`. |
| `async-blocking-http` | `error` | Replace `requests.*` / `urllib.request.*` / sync `httpx.*` with `httpx.AsyncClient` or `run_in_threadpool`. |
| `pydantic-mutable-default` | `error` | Replace `= []` / `= {}` with `= Field(default_factory=list)` / `dict`. |
| `fastapi-missing-response-model` | `error` | Add `response_model=Schema` or an explicit return type annotation (`-> Schema`). |
| `fastapi-untyped-response-model` | `warning` | Replace `-> dict` / `-> Any` with a concrete Pydantic `BaseModel` schema. |
