---
name: "bug-reproducer-tdd"
description: "Use when investigating production defects, edge-case regressions, or intermittent test failures to synthesize a minimal deterministic failing reproduction test harness before touching implementation code, verifying red-to-green state transitions, boundary-value assertions, explicit exception contracts, and zero-flakiness fixture isolation without sleep timers or skipped test decorators."
version: "1.0.0"
track: "arch-quality"
tags:
  - "tdd"
  - "regression-testing"
  - "bug-reproduction"
  - "pytest"
  - "vitest"
routing_signals:
  languages: ["python", "typescript"]
  files_any: ["pytest.ini", "vitest.config.ts", "pyproject.toml"]
  dependencies_any: ["pytest", "vitest", "hypothesis"]
  negative_triggers:
    - "Do not trigger for pure documentation edits, static asset bundling, or database DDL migrations."
entrypoints:
  scripts:
    - path: "scripts/repro_harness_check.py"
      description: "Verifies reproduction test modules contain explicit assertions, zero sleep flakiness, and no skipped tests."
---

# Bug Reproducer TDD (`bug-reproducer-tdd`)

## When to Use This Skill
Invoke this skill whenever fixing a bug, regression, or edge-case crash so a minimal, deterministic failing test (`Red`) proves the root cause before any implementation line is modified (`Green`).

## Mandatory Execution Workflow

1. **Synthesize a Minimal Failing Reproduction Test (`Red`):**
   - Isolate the exact input payload, state transition, or boundary condition that triggers the defect.
   - Author a focused reproduction test (`test_repro_<issue_slug>`) with zero external network calls or `sleep()` timers.
2. **Validate the Reproduction Harness with the Bundled Script:**
   ```bash
   python catalog/arch-quality/bug-reproducer-tdd/scripts/repro_harness_check.py --path <test_file_or_dir> --json
   ```
3. **Execute the Failing Test Before Editing Source Code:**
   - Run the test runner (`pytest -k <test_name>` or `npx vitest run <test_file>`) and verify the test fails for the exact expected reason.
4. **Apply the Surgical Fix (`Green`) & Re-Verify:**
   - Modify the minimal production code path required to pass the reproduction test without regressing existing suites.
   - Re-run `repro_harness_check.py` to confirm zero skipped assertions or flaky sleeps remain.
