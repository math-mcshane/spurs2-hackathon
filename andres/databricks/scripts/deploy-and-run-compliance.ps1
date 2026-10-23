# Deploy bundle with PAT from andres/.env, then backfill + full L1 pipeline.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/deploy-and-run-compliance.ps1

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvFile = (Resolve-Path (Join-Path $PSScriptRoot "..\..\.env")).Path

function Read-DotEnv([string]$Path) {
  $map = @{}
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $map[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
  }
  return $map
}

$envMap = Read-DotEnv $EnvFile
$hostUrl = $envMap["DATABRICKS_HOST"]
if (-not $hostUrl) { $hostUrl = $envMap["DATBARICKS_URL"] }
$token = $envMap["DATABRICKS_TOKEN"]
if (-not $token) { $token = $envMap["DATABRICKS_API_KEY"] }
if (-not $hostUrl -or -not $token) { throw "Missing Databricks host/token in .env" }

$env:DATABRICKS_HOST = $hostUrl.TrimEnd("/")
$env:DATABRICKS_TOKEN = $token
$env:DATABRICKS_AUTH_TYPE = "pat"
Remove-Item Env:DATABRICKS_CONFIG_PROFILE -ErrorAction SilentlyContinue

Set-Location $Root
Write-Host ("Host: " + $env:DATABRICKS_HOST)
Write-Host "Validating bundle..."
databricks bundle validate -t dev
if ($LASTEXITCODE -ne 0) { throw "bundle validate failed" }

Write-Host "Deploying..."
databricks bundle deploy -t dev
if ($LASTEXITCODE -ne 0) { throw "bundle deploy failed" }

Write-Host "Running scoreplay_backfill..."
databricks bundle run -t dev scoreplay_backfill
if ($LASTEXITCODE -ne 0) { throw "backfill job failed" }

# force=false / enrich_force=false → no duplicate L1 decisions or TL re-analyze
Write-Host "Running policy_engine_pipeline (run_mode=full, force=false, enrich_force=false)..."
databricks bundle run -t dev policy_engine_pipeline --params "run_mode=full,force=false,enrich_force=false"
if ($LASTEXITCODE -ne 0) { throw "pipeline job failed" }

Write-Host "Done. Query:"
Write-Host "  SELECT * FROM spurs2.gold.compliance_summary"
Write-Host "  SELECT * FROM spurs2.gold.compliance_rejected LIMIT 50"
Write-Host "  SELECT * FROM spurs2.gold.compliance_eligible LIMIT 50"
