param([switch]$Offline, [switch]$SkipBuild, [switch]$Workspaces, [switch]$Expression, [switch]$Background, [switch]$Playback, [switch]$Imports, [switch]$Loads, [switch]$History, [switch]$RoundRecovery, [string[]]$Spec = @())
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'build-practice.ps1') -Target Service,Web -Offline:$Offline -Verify
}
$checks = @()
if ($Workspaces) { $checks += '--workspaces' }
if ($Expression) { $checks += '--expression' }
if ($Background) { $checks += '--background' }
if ($Playback) { $checks += '--playback' }
if ($Imports) { $checks += '--imports' }
if ($Loads) { $checks += '--loads' }
if ($History) { $checks += '--history' }
if ($RoundRecovery) { $checks += '--round-recovery' }
foreach ($name in $Spec) { $checks += "--spec=$name" }
& node (Join-Path $PSScriptRoot 'smoke-practice.mjs') @checks
if ($LASTEXITCODE) { throw '日常练习流程检查失败' }
