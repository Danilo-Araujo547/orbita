$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
foreach ($line in Get-Content -LiteralPath (Join-Path $projectRoot '.env')) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
if ($env:DATABASE_ENGINE -ne 'sqlite' -and $env:POSTGRES_DATA_DIR) {
    & (Join-Path $PSScriptRoot 'Start-Postgres.ps1')
}
& (Join-Path $projectRoot '.venv\Scripts\python.exe') (Join-Path $projectRoot 'backend\manage.py') tick
