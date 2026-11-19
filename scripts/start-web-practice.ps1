param([switch]$NoBrowser)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$web = Join-Path $repository 'panthesia-web'
$logs = Join-Path $repository 'work/web-runtime'
[System.IO.Directory]::CreateDirectory($logs) | Out-Null
function Test-Endpoint([string]$Uri) {
    try { $null = Invoke-WebRequest -Uri $Uri -TimeoutSec 2 -UseBasicParsing; return $true } catch { return $false }
}
if (-not (Test-Endpoint 'http://127.0.0.1:32124/api/state')) {
    Import-Module (Join-Path $PSScriptRoot 'practice-build.psm1') -Force
    $source = Get-PracticeSource Service
    $receipt = Get-PracticeBuildReceipt Service Debug $source
    if (-not $receipt) {
        Write-Output '音乐服务源码已更新，正在生成当前版本。'
        & (Join-Path $PSScriptRoot 'build-practice.ps1') -Target Service
        $receipt = Get-PracticeBuildReceipt Service Debug (Get-PracticeSource Service)
        if (-not $receipt) { throw '音乐服务构建结果尚未与当前源码核对。' }
    }
    $service = @($receipt.artifacts | Where-Object role -eq 'executable')[0].path
    $process = Start-Process -FilePath $service -WorkingDirectory $repository -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'engine.log') -RedirectStandardError (Join-Path $logs 'engine-error.log')
    $process.Id | Set-Content -LiteralPath (Join-Path $logs 'engine.pid')
}
if (-not (Test-Endpoint 'http://127.0.0.1:5173')) {
    $vite = Join-Path $web 'node_modules/vite/bin/vite.js'
    if (-not (Test-Path -LiteralPath $vite)) {
        Push-Location $web
        try { & npm.cmd ci; if ($LASTEXITCODE) { throw '前端依赖准备失败' } } finally { Pop-Location }
    }
    $process = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('"' + $vite + '"','--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory $web -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'web.log') -RedirectStandardError (Join-Path $logs 'web-error.log')
    $process.Id | Set-Content -LiteralPath (Join-Path $logs 'web.pid')
}
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while (-not (Test-Endpoint 'http://127.0.0.1:5173') -or -not (Test-Endpoint 'http://127.0.0.1:32124/api/state')) {
    if ([DateTime]::UtcNow -gt $deadline) { throw "启动超时，请查看 $logs 中的日志" }
    Start-Sleep -Milliseconds 300
}
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:5173' }
Write-Output '练习室已启动：http://127.0.0.1:5173'
