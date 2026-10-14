$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'artifacts\oracle'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$archive = Join-Path $runtimeRoot 'instantclient-basiclite-windows.x64-19.32.zip'
Invoke-WebRequest -Uri 'https://download.oracle.com/otn_software/nt/instantclient/1932000/instantclient-basiclite-windows.x64-19.32.0.0.0dbru.zip' -OutFile $archive
$expected = '4da06c122baf7139a7b7bf52d4a59e628cb400fa54cfbf081eac8ae4ff98c4a6'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Checksum Oracle incorreto.' }
Expand-Archive -LiteralPath $archive -DestinationPath $runtimeRoot -Force
Write-Output ('ORACLE_CLIENT_DIR=' + (Join-Path $runtimeRoot 'instantclient_19_32'))
