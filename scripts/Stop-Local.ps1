$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectRoot 'artifacts\runtime.json'
if (!(Test-Path -LiteralPath $runtimePath)) { return }
$runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
if ($runtime.project -ne $projectRoot) { throw 'Registro de processos não pertence a este projeto.' }
foreach ($processId in @($runtime.api, $runtime.panel, $runtime.dispatcher, $runtime.inbox)) {
    if (!$processId) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if ($process -and ($process.CommandLine -like '*backend/manage.py*' -or $process.CommandLine -like '*orbita*frontend*node_modules*vite*')) {
        Stop-Process -Id $processId -Force
    }
}
Remove-Item -LiteralPath $runtimePath
