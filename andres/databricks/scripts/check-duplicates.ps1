# Quick UC duplicate / volume checks after pipeline run.
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

function Show-Sql([string]$Sql) {
  Write-Host ""
  Write-Host ("SQL> " + ($Sql -replace "\s+", " ").Substring(0, [Math]::Min(120, $Sql.Length)) + "...")
  $r = Invoke-Sql $Sql
  if ($r.status.state -ne "SUCCEEDED") {
    Write-Host ("STATE: " + $r.status.state)
    if ($r.status.error) { Write-Host $r.status.error.message }
    return
  }
  $cols = ($r.manifest.schema.columns | ForEach-Object { $_.name }) -join " | "
  Write-Host ("COLS: " + $cols)
  foreach ($row in $r.result.data_array) {
    Write-Host ("ROW:  " + ($row -join " | "))
  }
}

$envMap = Read-DotEnv $EnvFile
$script:HostUrl = $envMap["DATABRICKS_HOST"]
if (-not $script:HostUrl) { $script:HostUrl = $envMap["DATBARICKS_URL"] }
$script:HostUrl = $script:HostUrl.TrimEnd("/")
$script:Token = $envMap["DATABRICKS_TOKEN"]
if (-not $script:Token) { $script:Token = $envMap["DATABRICKS_API_KEY"] }

$wh = Invoke-RestMethod -Method GET -Uri ($script:HostUrl + "/api/2.0/sql/warehouses") `
  -Headers @{ Authorization = "Bearer $script:Token" }
$running = @($wh.warehouses | Where-Object { $_.state -eq "RUNNING" -or $_.state -eq "STARTING" })
if (-not $running -or $running.Count -eq 0) { $running = @($wh.warehouses) }
if (-not $running -or $running.Count -eq 0) { throw "No SQL warehouses found" }
$script:WarehouseId = $running[0].id
Write-Host ("Warehouse: " + $running[0].name)

Show-Sql @"
SELECT
  (SELECT count(*) FROM spurs2.bronze.scoreplay_webhooks) AS bronze_events,
  (SELECT count(DISTINCT event_id) FROM spurs2.bronze.scoreplay_webhooks) AS bronze_distinct_event_id,
  (SELECT count(*) FROM spurs2.silver.assets) AS silver_assets,
  (SELECT count(DISTINCT media_id) FROM spurs2.silver.assets) AS silver_distinct_media,
  (SELECT count(*) FROM spurs2.gold.l1_decisions) AS l1_rows,
  (SELECT count(DISTINCT media_id) FROM spurs2.gold.l1_decisions) AS l1_distinct_media,
  (SELECT count(*) FROM spurs2.silver.eligible_artifacts) AS eligible_rows,
  (SELECT count(DISTINCT media_id) FROM spurs2.silver.eligible_artifacts) AS eligible_distinct,
  (SELECT count(*) FROM spurs2.silver.observations WHERE source = 'twelvelabs') AS tl_obs,
  (SELECT count(DISTINCT observation_id) FROM spurs2.silver.observations WHERE source = 'twelvelabs') AS tl_obs_distinct_id
"@

Show-Sql "SELECT tl_status, count(*) AS n FROM spurs2.silver.eligible_artifacts GROUP BY tl_status ORDER BY n DESC"
Show-Sql "SELECT * FROM spurs2.gold.compliance_summary"
Show-Sql @"
SELECT media_id, count(*) AS n
FROM spurs2.gold.l1_decisions
GROUP BY media_id
HAVING count(*) > 1
ORDER BY n DESC
LIMIT 10
"@
