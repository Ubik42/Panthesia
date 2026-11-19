param([switch]$Launch, [switch]$Offline)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$applicationArguments = @($args)
Import-Module (Join-Path $PSScriptRoot 'practice-build.psm1') -Force
try {
    $source = Get-PracticeSource Desktop
    $receipt = Get-PracticeBuildReceipt Desktop Debug $source
    if (-not $receipt) {
        Write-Host '正在生成与当前源码一致的桌面程序。首次构建可能需要几分钟。'
        & (Join-Path $PSScriptRoot 'build-practice.ps1') -Target Desktop -Offline:$Offline
        $source = Get-PracticeSource Desktop
        $receipt = Get-PracticeBuildReceipt Desktop Debug $source
        if (-not $receipt) { throw '构建结果尚未与当前源码核对，原程序与资料继续保留。' }
    } else { Write-Host '桌面程序已与当前源码核对。' }
    $binary = @($receipt.artifacts | Where-Object role -eq 'executable')[0].path
    if ($Launch) {
        $options = @{ FilePath = $binary; WorkingDirectory = (Split-Path $binary -Parent) }
        if ($applicationArguments.Count) { $options.ArgumentList = (($applicationArguments | ForEach-Object { ConvertTo-PracticeArgument $_ }) -join ' ') }
        Start-Process @options
        Write-Host 'Panthesia 已打开。'
    } else { Write-Output $binary }
} catch {
    Write-Host "Panthesia 无法打开：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}