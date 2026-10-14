$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
foreach ($line in Get-Content -LiteralPath (Join-Path $projectRoot '.env')) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
if (!$env:POSTGRES_DATA_DIR -or !$env:POSTGRES_BIN_DIR) { throw 'Configure POSTGRES_DATA_DIR e POSTGRES_BIN_DIR no .env.' }
$pgCtl = Join-Path $env:POSTGRES_BIN_DIR 'pg_ctl.exe'
if (!(Test-Path -LiteralPath (Join-Path $env:POSTGRES_DATA_DIR 'PG_VERSION'))) { throw 'Cluster PostgreSQL não inicializado.' }
& $pgCtl status -D $env:POSTGRES_DATA_DIR *> $null
if ($LASTEXITCODE -ne 0) {
    $start = Start-Process -FilePath $pgCtl -ArgumentList @('start','-D',('"' + $env:POSTGRES_DATA_DIR + '"'),'-l',('"' + (Join-Path $env:POSTGRES_DATA_DIR 'server.log') + '"'),'-w','-t','120') -WindowStyle Hidden -PassThru
    if (!$start.WaitForExit(135000)) { throw 'Tempo limite ao iniciar PostgreSQL.' }
    if ($start.ExitCode -ne 0) { throw 'Falha ao iniciar PostgreSQL; verifique server.log no diretório do cluster.' }
}
$readyDeadline = [DateTime]::UtcNow.AddSeconds(120)
do {
    & (Join-Path $env:POSTGRES_BIN_DIR 'pg_isready.exe') -h $env:DATABASE_HOST -p $env:DATABASE_PORT -t 2 *> $null
    if ($LASTEXITCODE -eq 0) { break }
    if ([DateTime]::UtcNow -ge $readyDeadline) { throw 'PostgreSQL não ficou disponível após a recuperação.' }
    Start-Sleep -Seconds 1
} while ($true)
Write-Output 'PostgreSQL local ativo.'
