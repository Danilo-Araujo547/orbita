param([string[]]$TestArguments = @('-q','--reuse-db'))
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
foreach ($line in Get-Content -LiteralPath (Join-Path $projectRoot '.env')) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
if ($env:DATABASE_ENGINE -ne 'postgresql' -or $env:DATABASE_HOST -ne '127.0.0.1' -or $env:DATABASE_NAME -ne 'orbita') {
    throw 'Este script destina-se apenas ao cluster local PostgreSQL do Órbita.'
}
& (Join-Path $PSScriptRoot 'Start-Postgres.ps1')
$originalUser = $env:DATABASE_USER
$originalPassword = $env:DATABASE_PASSWORD
try {
    # Django creates test_orbita; the application account never gets CREATEDB/superuser.
    $credential = Import-Clixml -LiteralPath (Join-Path $projectRoot 'secrets\postgres-admin.xml')
    $env:DATABASE_USER = $credential.UserName
    $env:DATABASE_PASSWORD = $credential.GetNetworkCredential().Password
    Push-Location $projectRoot
    try {
        & (Join-Path $projectRoot '.venv\Scripts\python.exe') -m pytest @TestArguments
        if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }
    } finally { Pop-Location }
} finally {
    $env:DATABASE_USER = $originalUser
    $env:DATABASE_PASSWORD = $originalPassword
}
