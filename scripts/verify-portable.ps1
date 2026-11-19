param(
    [Parameter(Mandatory)][string]$Package,
    [string]$Results,
    [int]$TimeoutSeconds = 90,
    [switch]$IntegrityOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Package = (Resolve-Path -LiteralPath $Package).Path
$repository = Split-Path $PSScriptRoot -Parent
Import-Module (Join-Path $PSScriptRoot 'practice-build.psm1') -Force
$manifest = Read-PracticePackage $Package
if ($IntegrityOnly) {
    Write-Output "运行包文件内容已核对：$(@($manifest.files).Count) 个文件；此操作未启动程序。"
    return
}
if (-not $Results) { $Results = Join-Path $repository ('work/portable-check/' + [Guid]::NewGuid().ToString('N')) }
$Results = [IO.Path]::GetFullPath($Results)
if ((Test-Path -LiteralPath $Results) -and @(Get-ChildItem -LiteralPath $Results -Force).Count) { throw '检查记录目录必须为空，已有结果保留' }
[IO.Directory]::CreateDirectory($Results) | Out-Null
if ($manifest.configuration -ne 'Release') { throw '此入口检查 Release 运行包，请先生成 Release 包' }
$data = Join-Path $Results 'data'
$library = Join-Path $Results 'library'
[IO.Directory]::CreateDirectory($data) | Out-Null
[IO.Directory]::CreateDirectory($library) | Out-Null
Set-Content -LiteralPath (Join-Path $library 'catalog.csv') -Value 'Title,Composer,Source,Category,License,SourceUrl,LocalPath' -Encoding UTF8
function Normalize-Path([string]$Path) {
    if ($Path.StartsWith('\\?\UNC\')) { $Path = '\\' + $Path.Substring(8) }
    elseif ($Path.StartsWith('\\?\')) { $Path = $Path.Substring(4) }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}
function Start-Check([string]$Executable, [string]$Phase) {
    $report = Join-Path $Results "$Phase.json"
    $process = Start-Process -FilePath $Executable -ArgumentList "--portable-check=$Phase" -WorkingDirectory $Results -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Results "$Phase.stdout.log") -RedirectStandardError (Join-Path $Results "$Phase.stderr.log")
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not $process.WaitForExit(500)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
            throw "运行包检查超时：$Phase，记录保留在 $Results"
        }
    }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "运行包检查失败：$Phase，退出码 $($process.ExitCode)，记录：$Results" }
    $value = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    foreach ($key in @('frontendReady', 'ipcReady', 'notationWasmReady', 'pdfReady', 'audioProbeReady', 'silentPlayback')) {
        if ($value.$key -ne $true) { throw "运行包检查缺少成功证据：$Phase / $key" }
    }
    if ($value.status -ne 'pass' -or $value.phase -ne $Phase) { throw "运行包报告阶段无效：$Phase" }
    if ((Normalize-Path $value.fontPath) -ne (Normalize-Path (Join-Path $Package 'default.sf2'))) { throw '检查使用了程序目录外的音色' }
    if ((Normalize-Path $value.dataRoot) -ne (Normalize-Path $data)) { throw '检查未使用独立练习资料' }
    if ((Normalize-Path $value.webviewDataRoot) -ne (Normalize-Path (Join-Path $data 'webview-profile'))) { throw '检查未隔离窗口设置与缓存' }
    return $value
}
$keys = @('PATH', 'PANTHESIA_DATA_ROOT', 'PANTHESIA_LIBRARY_ROOT', 'PANTHESIA_STARTUP_CHECK_LOG', 'PANTHESIA_HEADLESS_CHECK')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    $env:PATH = (Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot
    $env:PANTHESIA_DATA_ROOT = $data
    $env:PANTHESIA_LIBRARY_ROOT = $library
    $env:PANTHESIA_HEADLESS_CHECK = $null
    $env:PANTHESIA_STARTUP_CHECK_LOG = Join-Path $Results 'save.json'
    $saved = Start-Check (Join-Path $Package 'Panthesia.exe') 'save'
    $env:PANTHESIA_STARTUP_CHECK_LOG = Join-Path $Results 'restore.json'
    $restored = Start-Check (Join-Path $Package 'Panthesia.exe') 'restore'
    if ($saved.contentId -ne $restored.contentId -or $saved.savedRounds -ne 2 -or $restored.savedRounds -ne 3) { throw '重启前后的练习身份或成绩数量不一致' }
    $planProgressRestartVerified = $false
    $fingerAnnotationsRestartVerified = $false
    if (($saved.PSObject.Properties.Name -contains 'portableCheckVersion') -and $saved.portableCheckVersion -ge 2) {
        $env:PANTHESIA_STARTUP_CHECK_LOG = Join-Path $Results 'resume-plan.json'
        $resumed = Start-Check (Join-Path $Package 'Panthesia.exe') 'resume-plan'
        if ($resumed.contentId -ne $saved.contentId -or $resumed.savedRounds -ne 3 -or $resumed.planProgressRestored -ne $true) { throw '再次重启后未恢复计划项目进度，或意外增加了成绩' }
        $planProgressRestartVerified = $true
        if ($saved.portableCheckVersion -ge 3) {
            if ($resumed.fingerAnnotationsRestored -ne $true) { throw '再次重启后未恢复切换手别保存的个人指法' }
            $fingerAnnotationsRestartVerified = $true
        }
    }
    $negative = Join-Path $Results 'missing-font'
    [IO.Directory]::CreateDirectory($negative) | Out-Null
    Copy-Item -LiteralPath (Join-Path $Package 'Panthesia.exe') -Destination (Join-Path $negative 'Panthesia.exe')
    $env:PANTHESIA_DATA_ROOT = Join-Path $Results 'negative-data'
    $env:PANTHESIA_STARTUP_CHECK_LOG = Join-Path $Results 'missing-font.txt'
    $bad = Start-Process -FilePath (Join-Path $negative 'Panthesia.exe') -ArgumentList '--headless-check' -WorkingDirectory $Results -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $Results 'missing-font.stderr.log')
    if (-not $bad.WaitForExit(30000)) { Stop-Process -Id $bad.Id -ErrorAction SilentlyContinue; throw '缺少音色的运行包未及时退出' }
    $bad.Refresh()
    if ($bad.ExitCode -eq 0 -or -not (Get-Content -LiteralPath (Join-Path $Results 'missing-font.txt') -Raw).Contains('运行包缺少钢琴音色')) { throw '缺少运行包音色时未明确拒绝启动' }
    [ordered]@{ status = 'pass'; package = $Package; revision = $manifest.revision; sourceFingerprint = $manifest.sourceFingerprint; checkedFiles = @($manifest.files).Count; savedRounds = $saved.savedRounds; restoredRounds = $restored.savedRounds; planProgressRestartVerified = $planProgressRestartVerified; fingerAnnotationsRestartVerified = $fingerAnnotationsRestartVerified; missingFontRejected = $true; restrictedPath = $true; isolatedWebview = $true; cleanMachineVerified = $false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Results 'result.json') -Encoding UTF8
    Write-Output "Release 运行包、资源、练习与真实重启检查通过：$Results"
} finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
