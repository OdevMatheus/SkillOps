---
name: "postgres-query-doctor"
description: "Use when diagnosing slow PostgreSQL queries, authoring SQL schema migrations, or analyzing EXPLAIN ANALYZE execution plans to detect sequential table scans, missing composite or foreign-key B-Tree indexes, unsafe non-concurrent DDL table locks, and unparameterized SQL strings across high-concurrency transactional production database workloads."
version: "1.0.0"
track: "python-backend"
tags:
  - "postgresql"
  - "sql"
  - "database"
  - "migrations"
  - "query-optimization"
routing_signals:
  languages: ["sql", "python"]
  files_any: ["alembic.ini", "migrations", "schema.sql", "pyproject.toml"]
  dependencies_any: ["sqlalchemy", "asyncpg", "psycopg", "alembic"]
  negative_triggers:
    - "Do not trigger for pure in-memory data structures, CSS layouts, or frontend state management."
entrypoints:
  scripts:
    - path: "scripts/analyze_sql_safety.py"
      description: "Static SQL and migration safety analyzer detecting non-concurrent index locks, SELECT *, and unbounded DELETE/UPDATE statements."
---

# Postgres Query Doctor (`postgres-query-doctor`)

## When to Use This Skill
Invoke this skill when writing or reviewing **PostgreSQL** queries, Alembic/SQL migrations, or SQLAlchemy repositories to prevent production table lockouts, sequential scan regressions, and SQL injection risks.

## Mandatory Execution Workflow

1. **Run the Deterministic SQL Safety Analyzer First:**
   ```bash
   python catalog/python-backend/postgres-query-doctor/scripts/analyze_sql_safety.py --path <target.sql> --json
   ```
2. **Prevent DDL Table Lockouts in Migrations:**
   - Always use `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` on existing production tables to avoid `SHARE` locks that block writes.
   - When adding a `NOT NULL` constraint to a large table, add a `CHECK (... IS NOT NULL) NOT VALID` constraint first, run `VALIDATE CONSTRAINT`, and only then set `NOT NULL`.
3. **Eliminate `SELECT *` & Unbounded Mutations:**
   - Project explicit columns instead of `SELECT *` to enable index-only scans and prevent network payload bloat.
   - Never execute `UPDATE` or `DELETE` without an explicit `WHERE` clause.
4. **Index Foreign Keys & Filter Predicates:**
   - PostgreSQL does not automatically create an index on the referencing side of a `FOREIGN KEY`; always add a B-Tree index on foreign-key columns used in joins or cascading deletes.
5. **Re-Verify with the Bundled Script:**
   Re-run `analyze_sql_safety.py --path <target.sql> --json` and confirm `"status": "ok"`.
