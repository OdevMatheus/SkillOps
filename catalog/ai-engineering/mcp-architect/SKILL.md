---
name: "mcp-architect"
description: "Use when designing, implementing, or auditing Model Context Protocol (MCP) servers and FastMCP tools in Python or TypeScript to enforce strict JSON-RPC stdio hygiene, Pydantic input schemas, tool docstring clarity, and localhost-bound SSE transport security without polluting stdout or exposing untyped tool handlers to AI coding agents."
version: "1.0.0"
track: "ai-engineering"
tags:
  - "mcp"
  - "fastmcp"
  - "json-rpc"
  - "ai-agents"
  - "tool-design"
routing_signals:
  languages: ["python", "typescript"]
  files_any: ["pyproject.toml", "mcp.json", ".cursor/mcp.json"]
  dependencies_any: ["mcp", "fastmcp"]
  negative_triggers:
    - "Do not trigger for standard REST CRUD controllers or database schema migrations unrelated to MCP."
entrypoints:
  scripts:
    - path: "scripts/validate_mcp_server.py"
      description: "Static AST auditor for FastMCP/MCP servers checking stdio stdout pollution, tool type hints, docstrings, and host binding."
---

# MCP Architect (`mcp-architect`)

## When to Use This Skill
Invoke this skill whenever creating or reviewing a **Model Context Protocol (MCP)** server (`FastMCP` or `mcp.server`) so tool definitions remain deterministic, self-documenting, and safe for stdio/SSE agent harnesses.

## Mandatory Execution Workflow

1. **Run the Deterministic AST Auditor First:**
   Before proposing edits to any MCP server file, execute the bundled script:
   ```bash
   python catalog/ai-engineering/mcp-architect/scripts/validate_mcp_server.py --path <target.py> --json
   ```
2. **Eliminate `stdio` JSON-RPC Frame Corruption:**
   - Never call bare `print(...)` inside an MCP server module or tool handler when using `stdio` transport; bare stdout writes corrupt JSON-RPC 2.0 framing.
   - Route all diagnostics to `sys.stderr` or `logging.StreamHandler(sys.stderr)`.
3. **Enforce Complete Tool Signatures & Docstrings:**
   - Every `@mcp.tool()` function must declare explicit Python 3.12+ parameter and return type annotations (`str`, `int`, `dict[str, Any]`, or `Pydantic` models).
   - Every `@mcp.tool()` function must include a concise docstring explaining its inputs, side effects, and structured return payload.
4. **Restrict Network Transports to Localhost:**
   - When configuring SSE or streamable HTTP transports, bind exclusively to `127.0.0.1` or `localhost` unless behind an authenticated gateway.
5. **Re-Verify with the Bundled Script:**
   Re-run `validate_mcp_server.py --path <target.py> --json` and confirm `"status": "ok"` (exit code `0`).
