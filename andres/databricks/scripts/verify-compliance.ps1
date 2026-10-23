# Query compliance views via Databricks Statement Execution API (PAT from .env).
$ErrorActionPreference = "Stop"
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

function Invoke-Sql([string]$Sql) {
  $body = @{
    warehouse_id = $script:WarehouseId
    statement = $Sql
    wait_timeout = "50s"
  } | ConvertTo-Json
  $resp = Invoke-RestMethod -Method POST -Uri ($script:HostUrl + "/api/2.0/sql/statements") `
    -Headers @{ Authorization = "Bearer $script:Token" } -ContentType "application/json" -Body $body
  return $resp
}

$envMap = Read-DotEnv $EnvFile
$script:HostUrl = $envMap["DATABRICKS_HOST"]
if (-not $script:HostUrl) { $script:HostUrl = $envMap["DATBARICKS_URL"] }
$script:HostUrl = $script:HostUrl.TrimEnd("/")
$script:Token = $envMap["DATABRICKS_TOKEN"]
if (-not $script:Token) { $script:Token = $envMap["DATABRICKS_API_KEY"] }

# Pick first running SQL warehouse
$wh = Invoke-RestMethod -Method GET -Uri ($script:HostUrl + "/api/2.0/sql/warehouses") `
  -Headers @{ Authorization = "Bearer $script:Token" }
$running = @($wh.warehouses | Where-Object { $_.state -eq "RUNNING" -or $_.state -eq "STARTING" })
if (-not $running -or $running.Count -eq 0) {
  $running = @($wh.warehouses)
}
if (-not $running -or $running.Count -eq 0) { throw "No SQL warehouses found" }
$script:WarehouseId = $running[0].id
Write-Host ("Warehouse: " + $running[0].name + " (" + $script:WarehouseId + ")")

$queries = @(
  "SELECT count(*) AS n FROM spurs2.bronze.scoreplay_webhooks",
  "SELECT count(*) AS n FROM spurs2.silver.assets",
  "SELECT * FROM spurs2.gold.compliance_summary",
  "SELECT count(*) AS n FROM spurs2.gold.compliance_rejected",
  "SELECT count(*) AS n FROM spurs2.gold.compliance_eligible"
)

foreach ($q in $queries) {
  Write-Host ""
  Write-Host ("SQL> " + $q)
  $r = Invoke-Sql $q
  if ($r.status.state -ne "SUCCEEDED") {
    Write-Host ("STATE: " + $r.status.state)
    if ($r.status.error) { Write-Host ($r.status.error.message) }
    continue
  }
  $cols = ($r.manifest.schema.columns | ForEach-Object { $_.name }) -join " | "
  Write-Host ("COLS: " + $cols)
  foreach ($row in $r.result.data_array) {
    Write-Host ("ROW:  " + ($row -join " | "))
  }
}
