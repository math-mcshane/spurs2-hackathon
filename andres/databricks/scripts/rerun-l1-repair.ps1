# Redeploy and run only l1_preprocess (includes eligible repair merge).
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
$env:DATABRICKS_HOST = $hostUrl.TrimEnd("/")
$env:DATABRICKS_TOKEN = $token
$env:DATABRICKS_AUTH_TYPE = "pat"
Remove-Item Env:DATABRICKS_CONFIG_PROFILE -ErrorAction SilentlyContinue

Set-Location $Root
databricks bundle deploy -t dev
if ($LASTEXITCODE -ne 0) { throw "deploy failed" }
databricks bundle run -t dev policy_engine_pipeline --only l1_preprocess --params run_mode=full
if ($LASTEXITCODE -ne 0) { throw "l1 repair run failed" }
Write-Host "L1 repair complete"
