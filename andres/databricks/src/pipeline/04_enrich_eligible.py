# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Enrich eligible (stub)
# MAGIC Later: TwelveLabs URL ingest + observations into `silver.observations`.
# MAGIC For now, mark `tl_status` as `skipped` when still `pending`.

# COMMAND ----------

from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "spurs2")
catalog = dbutils.widgets.get("catalog")
eligible = f"{catalog}.silver.eligible_artifacts"

# COMMAND ----------

pending = spark.table(eligible).where(F.col("tl_status") == "pending")
n = pending.count()
print(f"[enrich] pending TL enrichment={n}")

if n:
    spark.sql(
        f"""
        UPDATE {eligible}
        SET tl_status = 'skipped',
            updated_at = current_timestamp()
        WHERE tl_status = 'pending'
        """
    )
    print("[enrich] marked pending → skipped (stub)")
else:
    print("[enrich] nothing to update")

display(spark.table(eligible).orderBy(F.col("updated_at").desc()).limit(20))
