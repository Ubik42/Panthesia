param([switch]$Offline, [switch]$SkipBuild, [string[]]$Spec = @())
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'build-practice.ps1') -Target Service,Web -Offline:$Offline -Verify
}
$checks = @($Spec | ForEach-Object { "--spec=$_" })
& node (Join-Path $PSScriptRoot 'smoke-practice.mjs') @checks
if ($LASTEXITCODE) { throw '浏览器流程检查失败' }
