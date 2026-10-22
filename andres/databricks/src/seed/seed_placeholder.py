# Databricks notebook source
# COMMAND ----------
# MAGIC %md
# MAGIC # Seed (placeholder)
# MAGIC Empty for now. Later: DEMO `rules.*` packs, sample webhooks, fixture assets.

# COMMAND ----------

dbutils.widgets.text("catalog", "spurs2")
catalog = dbutils.widgets.get("catalog")

print(f"[seed] catalog={catalog} — no-op. Add policy pack / fixture inserts here.")
