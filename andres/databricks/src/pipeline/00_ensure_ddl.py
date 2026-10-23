# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Ensure Unity Catalog DDL
# MAGIC Applies `sql/*.sql` (IF NOT EXISTS) under catalog **spurs2** (or widget override).

# COMMAND ----------

from pathlib import Path

dbutils.widgets.text("catalog", "spurs2")
dbutils.widgets.text("bundle_root", "")

catalog = dbutils.widgets.get("catalog")
bundle_root = dbutils.widgets.get("bundle_root").strip()

# COMMAND ----------

def _sql_paths(root: str) -> list[Path]:
    candidates = []
    if root:
        base = Path(root) / "sql"
        if not base.exists():
            base = Path("/Workspace") / root.lstrip("/") / "sql"
        candidates.append(base)
    # Local / repo-relative fallbacks when developing in IDE
    here = Path.cwd()
    candidates.extend(
        [
            here / "sql",
            here.parent / "sql",
            here.parent.parent / "sql",
            Path("/Workspace") / "sql",
        ]
    )
    for c in candidates:
        if c.exists():
            # Numbered migrations; skip convenience 99_all.sql
            return sorted(
                p for p in c.glob("[0-9]*.sql") if not p.name.startswith("99_")
            )
    return []


def _split_statements(sql_text: str) -> list[str]:
    parts = []
    buf = []
    for line in sql_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        buf.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(buf).strip().rstrip(";").strip()
            if stmt:
                parts.append(stmt)
            buf = []
    tail = "\n".join(buf).strip().rstrip(";").strip()
    if tail:
        parts.append(tail)
    return parts


def _rewrite_catalog(sql_text: str, catalog_name: str) -> str:
    # DDL files hardcode spurs2; rewrite if widget differs
    if catalog_name == "spurs2":
        return sql_text
    return sql_text.replace("spurs2.", f"{catalog_name}.").replace(
        "CATALOG IF NOT EXISTS spurs2", f"CATALOG IF NOT EXISTS {catalog_name}"
    )

# COMMAND ----------

paths = _sql_paths(bundle_root)
if not paths:
    raise FileNotFoundError(
        f"No sql/[0-9]*.sql found (bundle_root={bundle_root!r}). "
        "Deploy the bundle so sql/ syncs to the workspace."
    )

print(f"[ensure_ddl] catalog={catalog}")
print(f"[ensure_ddl] applying {len(paths)} files from {paths[0].parent}")

for path in paths:
    text = _rewrite_catalog(path.read_text(encoding="utf-8"), catalog)
    stmts = _split_statements(text)
    print(f"  → {path.name}: {len(stmts)} statements")
    for stmt in stmts:
        try:
            spark.sql(stmt)
        except Exception as e:
            msg = str(e).lower()
            # ALTER ADD COLUMNS / MERGE seed re-runs are expected after first apply
            if any(
                t in msg
                for t in (
                    "already exists",
                    "field_already_exists",
                    "fields_already_exists",
                    "duplicate column",
                    "cannot be resolved",  # view recreate before columns exist (ordering race)
                )
            ):
                print(f"    skip (already applied / deferred): {type(e).__name__}: {str(e)[:160]}")
                continue
            raise

print("[ensure_ddl] done")

# COMMAND ----------
# Seed passport / L1 packs from src/policy/packs/*.json into UC rules.*

import sys
from pathlib import Path

_policy_roots = []
if bundle_root:
    _policy_roots.append(Path(bundle_root) / "src")
_policy_roots.extend(
    [
        Path.cwd() / "src",
        Path.cwd().parent / "src",
        Path("/Workspace") / "src",
    ]
)
for root in _policy_roots:
    if (root / "policy").exists():
        sys.path.insert(0, str(root))
        break

try:
    from policy.uc_seed import seed_packs_via_spark

    seeded = seed_packs_via_spark(spark, catalog)
    print(f"[ensure_ddl] seeded packs: {seeded}")
except Exception as e:
    print(f"[ensure_ddl] pack seed skipped: {type(e).__name__}: {e}")
