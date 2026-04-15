# Applies backend/.env to Azure Container App cvconv-api via Azure CLI Python entrypoint (avoids cmd.exe mangling % and parentheses).
$ErrorActionPreference = "Stop"
$azRoot = (Get-Command az).Source | Split-Path
$py = Join-Path $azRoot "..\python.exe" | Resolve-Path

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root "backend\.env"
if (-not (Test-Path $envPath)) { throw "Missing $envPath" }

$map = @{}
Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*)$') {
    $k = $matches[1].Trim()
    $v = $matches[2].Trim()
    if ($k) { $map[$k] = $v }
  }
}

$apiHost = "cvconv-api.orangefield-92a742dc.germanywestcentral.azurecontainerapps.io"
$webOrigin = "https://cvconv-web.orangefield-92a742dc.germanywestcentral.azurecontainerapps.io"

$map["DEBUG"] = "False"
$map["ALLOWED_HOSTS"] = $apiHost
$map["CORS_ALLOWED_ORIGINS"] = $webOrigin

$keys = @(
  "DATABASE_URL", "SECRET_KEY", "JWT_SECRET_KEY",
  "OLLAMA_API_KEY", "OLLAMA_MODEL",
  "OPENAI_API_KEY", "OPENAI_RECRUITER_MODEL", "OPENAI_REALTIME_MODEL",
  "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
  "API_THROTTLE_USER_RATE", "API_THROTTLE_LOGIN_IP_RATE", "API_THROTTLE_LOGIN_EMAIL_RATE", "API_THROTTLE_NUM_PROXIES",
  "DEBUG", "ALLOWED_HOSTS", "CORS_ALLOWED_ORIGINS"
)

$pairs = @()
foreach ($k in $keys) {
  if (-not $map.ContainsKey($k)) { continue }
  $pairs += ($k + "=" + $map[$k])
}

$cliArgs = @('-IBm', 'azure.cli', 'containerapp', 'update', '-n', 'cvconv-api', '-g', 'cv-converter-agent', '--set-env-vars') + $pairs
& $py @cliArgs
if ($LASTEXITCODE -ne 0) { throw "az containerapp update failed" }
Write-Host "Updated cvconv-api environment variables."
