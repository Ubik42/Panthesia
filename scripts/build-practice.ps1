param(
    [ValidateNotNullOrEmpty()][ValidateSet('Desktop', 'Service', 'Web')][string[]]$Target = @('Desktop'),
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Debug',
    [switch]$Offline,
    [switch]$Verify
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'practice-build.psm1') -Force
$repository = Get-PracticeRepository
$web = Join-Path $repository 'panthesia-web'
$lock = Enter-PracticeBuild
$previousInfo = [Environment]::GetEnvironmentVariable('PANTHESIA_BUILD_INFO', 'Process')
$previousConsoleEncoding = [Console]::OutputEncoding
$sources = @{}
$identities = @{}
$artifacts = @{}
$cargoOptions = @('--locked')
if ($Offline) { $cargoOptions += '--offline' }
if ($Configuration -eq 'Release') { $cargoOptions += '--release' }
function Set-BuildIdentity([string]$Name) {
    [Environment]::SetEnvironmentVariable('PANTHESIA_BUILD_INFO', ($identities[$Name] | ConvertTo-Json -Depth 8 -Compress), 'Process')
}
function Read-Artifact([string]$Path, [string]$Role) {
    $file = Get-Item -LiteralPath $Path
    return [ordered]@{ role = $Role; path = $file.FullName; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
}
Push-Location $repository
try {
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $desktopConfiguration = Get-Content -LiteralPath (Join-Path $web 'src-tauri/tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $desktopVersion = $desktopConfiguration.version
    $frontendDist = $desktopConfiguration.build.frontendDist
    if ('Desktop' -in $Target -and $env:TAURI_CONFIG) {
        $override = $env:TAURI_CONFIG | ConvertFrom-Json
        if ($override.PSObject.Properties.Name -contains 'version' -and $override.version) { $desktopVersion = $override.version }
        if ($override.PSObject.Properties.Name -contains 'build' -and $override.build -and $override.build.PSObject.Properties.Name -contains 'frontendDist') { $frontendDist = $override.build.frontendDist }
    }
    if ('Desktop' -in $Target) {
        if ($frontendDist -isnot [string] -or $frontendDist -match '^[a-z][a-z0-9+.-]*://') { throw '统一桌面构建需要使用本工程生成的界面目录。' }
        $actualDist = [IO.Path]::GetFullPath((Join-Path (Join-Path $web 'src-tauri') $frontendDist))
        if (-not [string]::Equals($actualDist.TrimEnd('\', '/'), (Join-Path $web 'dist'), [StringComparison]::OrdinalIgnoreCase)) { throw '桌面界面目录与本工程构建目录不同，请核对 Tauri 配置。' }
    }
    foreach ($name in @($Target | Sort-Object -Unique)) {
        $sources[$name] = Get-PracticeSource $name
        $versionFile = if ($name -eq 'Web') { 'package.json' } else { 'src-tauri/tauri.conf.json' }
        $version = if ($name -eq 'Desktop') { $desktopVersion } else { (Get-Content -LiteralPath (Join-Path $web $versionFile) -Raw -Encoding UTF8 | ConvertFrom-Json).version }
        $identities[$name] = [ordered]@{
            schemaVersion = 1; buildId = [Guid]::NewGuid().ToString('N'); version = $version
            target = $name; configuration = $Configuration; builtAt = [DateTime]::UtcNow.ToString('o')
            revision = $sources[$name].revision; dirty = $sources[$name].dirty
            sourceFingerprint = $sources[$name].fingerprint; sourceFiles = $sources[$name].files
        }
    }
    if ('Desktop' -in $Target -or 'Web' -in $Target) {
        $frontendTarget = if ('Desktop' -in $Target) { 'Desktop' } else { 'Web' }
        Set-BuildIdentity $frontendTarget
        Push-Location $web
        try {
            $dependencyReceiptPath = Join-Path $repository 'target/practice-build/frontend-dependencies.json'
            $dependencyLock = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
            $dependencyPackage = (Get-FileHash -LiteralPath 'package.json' -Algorithm SHA256).Hash
            $dependencyConfig = if (Test-Path -LiteralPath '.npmrc' -PathType Leaf) { (Get-FileHash -LiteralPath '.npmrc' -Algorithm SHA256).Hash } else { 'absent' }
            $dependencyReceipt = $null
            if (Test-Path -LiteralPath $dependencyReceiptPath -PathType Leaf) {
                try { $dependencyReceipt = Get-Content -LiteralPath $dependencyReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
            }
            $dependenciesReady = $false
            try {
                $dependenciesReady = $dependencyReceipt.schemaVersion -eq 1 -and $dependencyReceipt.lock -eq $dependencyLock -and $dependencyReceipt.package -eq $dependencyPackage -and $dependencyReceipt.config -eq $dependencyConfig -and
                    (Test-Path -LiteralPath 'node_modules/.bin/vite.cmd') -and (Test-Path -LiteralPath 'node_modules/.bin/tsc.cmd')
            } catch { }
            if (-not $dependenciesReady) {
                Write-Host '正在按锁定版本准备界面依赖。'
                Write-PracticeJson $dependencyReceiptPath ([ordered]@{ schemaVersion = 0; state = 'preparing' })
                $npmOptions = @('ci', '--include=dev', '--no-audit', '--no-fund')
                if ($Offline) { $npmOptions += '--offline' }
                & npm.cmd @npmOptions
                if ($LASTEXITCODE) { throw '前端依赖安装失败' }
                if ((Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash -ne $dependencyLock -or (Get-FileHash -LiteralPath 'package.json' -Algorithm SHA256).Hash -ne $dependencyPackage) { throw '准备依赖期间清单发生变化，请完成源码修改后重新构建。' }
                $configAfter = if (Test-Path -LiteralPath '.npmrc' -PathType Leaf) { (Get-FileHash -LiteralPath '.npmrc' -Algorithm SHA256).Hash } else { 'absent' }
                if ($configAfter -ne $dependencyConfig) { throw '准备依赖期间安装配置发生变化，请重新构建。' }
                Write-PracticeJson $dependencyReceiptPath ([ordered]@{ schemaVersion = 1; lock = $dependencyLock; package = $dependencyPackage; config = $dependencyConfig })
            }
            & npm.cmd run build
            if ($LASTEXITCODE) { throw '前端构建失败' }
            if ($Verify) {
                & node --test scripts/rust-wire-types.test.mjs
                if ($LASTEXITCODE) { throw '协议生成器测试失败' }
            }
            if ('Web' -in $Target) {
                $artifacts['Web'] = @(Get-ChildItem -LiteralPath (Join-Path $web 'dist') -Recurse -File | ForEach-Object { Read-Artifact $_.FullName 'frontend' })
                if ($frontendTarget -eq 'Desktop') { $identities['Web'] = $identities['Desktop'] }
            }
        } finally { Pop-Location }
    }
    if ($Verify) {
        $testOptions = @('test', '-p', 'panthesia-core', '-p', 'panthesia-engine', '--lib', '--locked', '--quiet')
        if ($Offline) { $testOptions += '--offline' }
        & cargo @testOptions
        if ($LASTEXITCODE) { throw '核心或引擎测试失败' }
    }
    foreach ($name in @('Service', 'Desktop')) {
        if ($name -notin $Target) { continue }
        Set-BuildIdentity $name
        $binaryName = if ($name -eq 'Desktop') { 'panthesia-desktop' } else { 'panthesia-service' }
        $options = if ($name -eq 'Desktop') { @('build', '-p', 'panthesia-desktop', '--features', 'custom-protocol') } else { @('build', '-p', 'panthesia-engine', '--bin', 'panthesia-service') }
        $executables = [Collections.Generic.List[string]]::new()
        $nativePreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & cargo @options @cargoOptions --message-format=json-render-diagnostics 2>&1 | ForEach-Object {
                $line = [string]$_
                $cargoMessage = $null
                try { $cargoMessage = $line | ConvertFrom-Json -ErrorAction Stop } catch { }
                if (-not $cargoMessage -or $cargoMessage.PSObject.Properties.Name -notcontains 'reason') { Write-Host $line }
                elseif ($cargoMessage.reason -eq 'compiler-message') { Write-Host $cargoMessage.message.rendered }
                elseif ($cargoMessage.reason -eq 'compiler-artifact' -and $cargoMessage.target.name -eq $binaryName -and $cargoMessage.executable) { $executables.Add([string]$cargoMessage.executable) }
            }
            $cargoExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $nativePreference }
        if ($cargoExitCode) { throw "$name 构建失败" }
        if ($executables.Count -ne 1) { throw "$name 构建未返回唯一的可执行文件，旧构建记录保留。" }
        $artifacts[$name] = @(Read-Artifact $executables[0] 'executable')
    }
    foreach ($name in @($Target | Sort-Object -Unique)) {
        $after = Get-PracticeSource $name
        if ($sources[$name].fingerprint -ne $after.fingerprint) { throw "构建期间 $name 源码发生变化，本次结果不登记为可交付版本。" }
    }
    foreach ($name in @($Target | Sort-Object -Unique)) {
        Write-PracticeJson (Get-PracticeReceiptPath $name $Configuration) ([ordered]@{
            schemaVersion = 2; target = $name; configuration = $Configuration
            source = $sources[$name]; identity = $identities[$name]
            completedAt = [DateTime]::UtcNow.ToString('o'); artifacts = @($artifacts[$name])
        })
    }
    Write-Output "构建完成：$($Target -join ', ') / $Configuration；来源与文件内容已记录。"
} finally {
    Pop-Location
    [Environment]::SetEnvironmentVariable('PANTHESIA_BUILD_INFO', $previousInfo, 'Process')
    [Console]::OutputEncoding = $previousConsoleEncoding
    $lock.Dispose()
}
