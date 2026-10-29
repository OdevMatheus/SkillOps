---
name: "ast-blast-radius"
description: "Use when modifying shared Python functions, classes, or public module interfaces to compute the exact AST call-graph blast radius, direct callers, transitive module dependents, and broken signature contract risks before refactoring, renaming, or changing parameter defaults across a multi-module production Python codebase."
version: "1.0.0"
track: "arch-quality"
tags:
  - "python"
  - "ast"
  - "refactoring"
  - "architecture"
  - "call-graph"
routing_signals:
  languages: ["python"]
  files_any: ["pyproject.toml", "setup.py"]
  dependencies_any: []
  negative_triggers:
    - "Do not trigger for pure CSS styling edits, static Markdown documentation changes, or SQL-only queries."
entrypoints:
  scripts:
    - path: "scripts/analyze_call_graph.py"
      description: "Computes direct callers, import dependents, and signature blast radius for a target Python symbol."
---

# AST Blast Radius (`ast-blast-radius`)

## When to Use This Skill
Invoke this skill before changing the signature, return type, or behavior of any shared Python function, method, or class so no downstream caller or test is silently broken.

## Mandatory Execution Workflow

1. **Compute the Exact Call-Graph Blast Radius First:**
   ```bash
   python catalog/arch-quality/ast-blast-radius/scripts/analyze_call_graph.py --path src --symbol <function_or_class_name> --json
   ```
2. **Inspect Direct Callers & Import Dependents:**
   - Review every file and line returned in `findings` before modifying the target symbol.
   - Classify the risk level (`low`: 0–2 callers, `medium`: 3–7 callers, `high`: 8+ callers).
3. **Apply Backward-Compatible or Atomic Signature Updates:**
   - When adding a new parameter to a widely called function, prefer keyword-only arguments with safe defaults (`*, strict: bool = False`) or update all call sites atomically in the same change.
4. **Re-Verify Call Sites & Type Contracts:**
   - Re-run `analyze_call_graph.py` and `mypy --strict` to confirm every caller matches the updated signature.
