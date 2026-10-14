param([switch]$Demo, [string]$OracleCredentialPath, [string]$OracleDsn = '172.19.0.250:1521/prdamevo')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$envPath = Join-Path $projectRoot '.env'
if (!(Test-Path -LiteralPath $pythonPath)) { throw 'Crie .venv e instale backend/requirements.txt antes de iniciar.' }
if (!(Test-Path -LiteralPath $envPath)) {
    $secretBytes = New-Object byte[] 48
    $passwordBytes = New-Object byte[] 24
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($secretBytes); $rng.GetBytes($passwordBytes); $rng.Dispose()
    $localSecret = [Convert]::ToBase64String($secretBytes)
    $localPassword = [Convert]::ToBase64String($passwordBytes)
    @("DJANGO_SECRET_KEY=$localSecret", "BOOTSTRAP_PASSWORD=$localPassword", 'DEBUG=1', 'SEND_MODE=simulated', 'TEST_RECIPIENTS=') | Set-Content -LiteralPath $envPath -Encoding UTF8
}
& $pythonPath (Join-Path $PSScriptRoot 'initialize_instance_identity.py')
if ($LASTEXITCODE -ne 0) { throw 'Falha na inicialização da identidade da instância.' }
foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
if ($env:DATABASE_ENGINE -ne 'sqlite' -and $env:POSTGRES_DATA_DIR) {
    & (Join-Path $PSScriptRoot 'Start-Postgres.ps1')
}
$env:DEBUG = '1'
$networkAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -Unique)
$networkOrigins = @($networkAddresses | ForEach-Object { "http://${_}:5173" })
$env:CSRF_TRUSTED_ORIGINS = (@('http://localhost:5173','http://127.0.0.1:5173') + $networkOrigins + @($env:CSRF_TRUSTED_ORIGINS -split ',' | Where-Object { $_ })) -join ','
if ($OracleCredentialPath) {
    $oracleCredential = Import-Clixml -LiteralPath $OracleCredentialPath
    $env:ORACLE_USER = $oracleCredential.UserName.ToUpperInvariant()
    $env:ORACLE_PASSWORD = $oracleCredential.GetNetworkCredential().Password
    $env:ORACLE_DSN = $OracleDsn
    $env:ORACLE_THICK = '1'
    $env:ORACLE_CLIENT_DIR = Join-Path $projectRoot 'artifacts\oracle\instantclient_19_32'
}
Push-Location $projectRoot
try {
    & $pythonPath backend/manage.py migrate --noinput
    if ($LASTEXITCODE -ne 0) { throw 'Falha nas migrações.' }
    & $pythonPath backend/manage.py bootstrap
    if ($LASTEXITCODE -ne 0) { throw 'Falha no bootstrap.' }
    & $pythonPath backend/manage.py bootstrap_operations
    if ($LASTEXITCODE -ne 0) { throw 'Falha no catálogo operacional.' }
    if ($Demo) { & $pythonPath backend/manage.py seed_demo; if ($LASTEXITCODE -ne 0) { throw 'Falha na demonstração.' } }
    $runtimeDir = Join-Path $projectRoot 'artifacts'
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $api = Start-Process -FilePath $pythonPath -ArgumentList @('backend/manage.py','runserver','127.0.0.1:8000','--noreload') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'api.log') -RedirectStandardError (Join-Path $runtimeDir 'api-error.log')
    $nodePath = (Get-Command node.exe).Source
    $vitePath = Join-Path $projectRoot 'frontend\node_modules\vite\bin\vite.js'
    $panel = Start-Process -FilePath $nodePath -ArgumentList @($vitePath,'--host','0.0.0.0','--port','5173','--strictPort') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'panel.log') -RedirectStandardError (Join-Path $runtimeDir 'panel-error.log')
    @{api=$api.Id;panel=$panel.Id;project=$projectRoot} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'runtime.json') -Encoding UTF8
    Write-Output 'Painel: http://127.0.0.1:5173'
    $networkOrigins | ForEach-Object { Write-Output "Rede: $_" }
    Write-Output 'Usuário: admin. Senha local: BOOTSTRAP_PASSWORD no arquivo .env (não versionado).'
    Write-Output 'Para parar: scripts/Stop-Local.ps1. Para executar tarefas: scripts/Run-Tick.ps1.'
} finally { Pop-Location; Remove-Item Env:ORACLE_PASSWORD -ErrorAction SilentlyContinue }
