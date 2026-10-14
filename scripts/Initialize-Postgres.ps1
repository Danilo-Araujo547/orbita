param([string]$BinDir = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretDir = Join-Path $projectRoot 'secrets'
$dataDir = Join-Path $env:LOCALAPPDATA 'Orbita\postgresql18\data'
if (Test-Path -LiteralPath $dataDir) { throw 'O diretório do cluster já existe; nenhuma reinicialização foi executada.' }
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
function New-DatabasePassword {
    $bytes = New-Object byte[] 36
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return [Convert]::ToBase64String($bytes)
}
$adminPassword = New-DatabasePassword
$appPassword = New-DatabasePassword
$credential = New-Object System.Management.Automation.PSCredential('orbita_admin', (ConvertTo-SecureString $adminPassword -AsPlainText -Force))
$credential | Export-Clixml -LiteralPath (Join-Path $secretDir 'postgres-admin.xml')
$passwordFile = Join-Path $secretDir 'postgres-init-password.tmp'
try {
    [IO.File]::WriteAllText($passwordFile, $adminPassword, (New-Object Text.UTF8Encoding($false)))
    & (Join-Path $BinDir 'initdb.exe') '-D' $dataDir '-U' 'orbita_admin' '--encoding=UTF8' '--locale-provider=builtin' '--locale=C' '--builtin-locale=C.UTF-8' '--auth-host=scram-sha-256' '--auth-local=scram-sha-256' "--pwfile=$passwordFile" '-c' 'listen_addresses=127.0.0.1' '-c' 'port=5432'
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao inicializar o cluster.' }
} finally {
    Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue
}
$config = @('DATABASE_ENGINE=postgresql','DATABASE_HOST=127.0.0.1','DATABASE_PORT=5432','DATABASE_NAME=orbita','DATABASE_USER=orbita',"DATABASE_PASSWORD=$appPassword","POSTGRES_BIN_DIR=$BinDir","POSTGRES_DATA_DIR=$dataDir")
[IO.File]::WriteAllLines((Join-Path $secretDir 'postgres.env'), $config, (New-Object Text.UTF8Encoding($false)))
$pgCtl = Join-Path $BinDir 'pg_ctl.exe'
$start = Start-Process -FilePath $pgCtl -ArgumentList @('start','-D',('"' + $dataDir + '"'),'-l',('"' + (Join-Path $dataDir 'server.log') + '"'),'-w','-t','30') -WindowStyle Hidden -PassThru
if (!$start.WaitForExit(45000)) { throw 'Tempo limite ao iniciar PostgreSQL.' }
if ($start.ExitCode -ne 0) { throw 'Falha ao iniciar PostgreSQL.' }
$env:ORBITA_PG_ADMIN_PASSWORD = $adminPassword
$env:ORBITA_PG_APP_PASSWORD = $appPassword
try {
    & (Join-Path $projectRoot '.venv\Scripts\python.exe') (Join-Path $PSScriptRoot 'provision_postgres.py')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o banco da aplicação.' }
} finally {
    Remove-Item Env:ORBITA_PG_ADMIN_PASSWORD,Env:ORBITA_PG_APP_PASSWORD -ErrorAction SilentlyContinue
}
Write-Output 'PostgreSQL inicializado em 127.0.0.1:5432; banco orbita, usuário da aplicação sem superusuário.'
