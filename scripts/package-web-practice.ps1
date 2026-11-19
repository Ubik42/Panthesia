param(
    [Parameter(Mandatory)][string]$Destination,
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Release',
    [switch]$Offline,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'package-practice.ps1') -Destination $Destination -Configuration $Configuration -Offline:$Offline -SkipBuild:$SkipBuild
