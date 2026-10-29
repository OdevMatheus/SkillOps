---
name: "fastapi-production"
description: "Use when building, refactoring, or reviewing async FastAPI REST endpoints and Pydantic v2 request or response pipelines to eliminate event-loop blocking calls inside async def routes, enforce explicit response_model contracts, configure lifespan dependency injection, and prevent wildcard CORS vulnerabilities in high-throughput production APIs."
version: "1.0.0"
track: "python-backend"
tags:
  - "fastapi"
  - "pydantic"
  - "async-python"
  - "rest-api"
  - "backend"
routing_signals:
  languages: ["python"]
  files_any: ["pyproject.toml", "requirements.txt"]
  dependencies_any: ["fastapi", "uvicorn", "starlette"]
  negative_triggers:
    - "Do not trigger for pure CLI scripts, frontend React components, or offline batch pandas jobs."
entrypoints:
  scripts:
    - path: "scripts/audit_fastapi_routes.py"
      description: "Static AST auditor for FastAPI routers detecting blocking sync calls in async def, missing response contracts, and wildcard CORS."
---

# FastAPI Production (`fastapi-production`)

## When to Use This Skill
Invoke this skill when designing, implementing, or reviewing **FastAPI** applications and routers (`APIRouter`, `FastAPI`) to guarantee non-blocking `asyncio` execution, strict Pydantic v2 serialization contracts, and secure middleware defaults.

## Mandatory Execution Workflow

1. **Run the Deterministic FastAPI Route Auditor First:**
   ```bash
   python catalog/python-backend/fastapi-production/scripts/audit_fastapi_routes.py --path <target.py> --json
   ```
2. **Eliminate Blocking Calls Inside `async def` Endpoints:**
   - Never invoke `time.sleep(...)`, `requests.get(...)`, or synchronous `subprocess.run(...)` directly inside an `async def` route handler—doing so stalls the entire Uvicorn event loop.
   - Replace with `await asyncio.sleep(...)`, `httpx.AsyncClient`, or define pure synchronous I/O routes as `def` so FastAPI runs them in a worker threadpool.
3. **Declare Explicit Response Contracts:**
   - Every `@router.get/post/put/delete/patch` endpoint must specify either `response_model=...` in the decorator or an explicit Python return type annotation (`-> ResponseSchema`).
4. **Harden CORS & Lifespan Configuration:**
   - Never combine `allow_origins=["*"]` with `allow_credentials=True` in `CORSMiddleware`.
   - Prefer `@asynccontextmanager` `lifespan` over deprecated `@app.on_event("startup")`.
5. **Re-Verify with the Bundled Script:**
   Re-run `audit_fastapi_routes.py --path <target.py> --json` and verify `"status": "ok"`.
