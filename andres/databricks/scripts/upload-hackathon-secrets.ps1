# Upload andres/.env into Databricks secret scope spurs2-hackathon (policy engine).
# Uses PAT from .env via REST (avoids stale CLI OAuth profiles). Never prints secret values.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/upload-hackathon-secrets.ps1

$ErrorActionPreference = "Stop"
$Scope = "spurs2-hackathon"
$EnvFile = (Resolve-Path (Join-Path $PSScriptRoot "..\..\.env")).Path

function Read-DotEnv([string]$Path) {
  $map = @{}
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    $map[$k] = $v
  }
  return $map
}

function Invoke-DbxJson {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Body = $null
  )
  $uri = $script:HostUrl.TrimEnd("/") + $Path
  $headers = @{ Authorization = "Bearer $script:Token" }
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
  }
  $json = $Body | ConvertTo-Json -Compress -Depth 6
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType "application/json" -Body $json
}

$envMap = Read-DotEnv $EnvFile

$script:HostUrl = $envMap["DATABRICKS_HOST"]
if (-not $script:HostUrl) { $script:HostUrl = $envMap["DATBARICKS_URL"] }
$script:Token = $envMap["DATABRICKS_TOKEN"]
if (-not $script:Token) { $script:Token = $envMap["DATABRICKS_API_KEY"] }

if (-not $script:HostUrl -or -not $script:Token) {
  throw "Need DATABRICKS_HOST (or DATBARICKS_URL) and DATABRICKS_TOKEN (or DATABRICKS_API_KEY) in .env"
}

$script:HostUrl = $script:HostUrl.TrimEnd("/")
Write-Host ("Host: " + $script:HostUrl)
Write-Host ("Scope: " + $Scope)

try {
  Invoke-DbxJson -Method POST -Path "/api/2.0/secrets/scopes/create" -Body @{
    scope = $Scope
    initial_manage_principal = "users"
    scope_backend_type = "DATABRICKS"
  } | Out-Null
  Write-Host ("Created scope " + $Scope + " (MANAGE -> users)")
} catch {
  $errText = $_.ErrorDetails.Message
  if (-not $errText) { $errText = $_.Exception.Message }
  if ($errText -match "RESOURCE_ALREADY_EXISTS|already exists") {
    Write-Host "Scope already exists - updating secrets"
  } else {
    throw ("create-scope failed: " + $errText)
  }
}

$puts = [ordered]@{
  "DATABRICKS_HOST"          = $script:HostUrl
  "DATABRICKS_TOKEN"         = $script:Token
  "SCOREPLAY_API_KEY"        = $envMap["SCOREPLAY_API_KEY"]
  "TWELVELABS_API_KEY"       = $envMap["TWELVELABS_API_KEY"]
  "SUPABASE_URL"             = $envMap["SUPABASE_URL"]
  "SUPABASE_SECRET_KEY"      = $envMap["SUPABASE_SECRET_KEY"]
  "APP_URL"                  = $envMap["APP_URL"]
  "SCOREPLAY_WEBHOOK_SECRET" = $envMap["SCOREPLAY_WEBHOOK_SECRET"]
}

foreach ($key in $puts.Keys) {
  $val = $puts[$key]
  if ([string]::IsNullOrWhiteSpace($val)) {
    Write-Host ("SKIP  " + $key + " (empty)")
    continue
  }
  Invoke-DbxJson -Method POST -Path "/api/2.0/secrets/put" -Body @{
    scope = $Scope
    key = $key
    string_value = $val
  } | Out-Null
  Write-Host ("PUT   " + $key)
}

try {
  Invoke-DbxJson -Method POST -Path "/api/2.0/secrets/acls/put" -Body @{
    scope = $Scope
    principal = "users"
    permission = "READ"
  } | Out-Null
  Write-Host "ACL   users -> READ"
} catch {
  Write-Host "ACL   users READ skipped (may already have MANAGE)"
}

Write-Host ""
Write-Host "Keys in scope:"
$list = Invoke-DbxJson -Method GET -Path ("/api/2.0/secrets/list?scope=" + [uri]::EscapeDataString($Scope))
foreach ($item in $list.secrets) {
  Write-Host ("  " + $item.key)
}
Write-Host ""
Write-Host "Notebook usage: dbutils.secrets.get scope spurs2-hackathon key SCOREPLAY_API_KEY"
