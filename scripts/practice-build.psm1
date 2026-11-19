Set-StrictMode -Version Latest

function Get-PracticeRepository {
    return [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
}

function Get-PracticeDigest([string[]]$Records) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes(($Records -join "`n")))).Replace('-', '')
    } finally { $algorithm.Dispose() }
}

function Get-PracticeSource {
    param([ValidateSet('Desktop', 'Service', 'Web')][string]$Target)
    $repository = Get-PracticeRepository
    $files = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $required = @('product.json', 'NOTICE.md', 'Cargo.toml', 'Cargo.lock', 'scripts/build-practice.ps1', 'scripts/practice-build.psm1', 'panthesia-web/src-tauri/tauri.conf.json')
    $directories = @('.cargo', 'assets/fonts')
    foreach ($relative in @('rust-toolchain', 'rust-toolchain.toml')) {
        if (Test-Path -LiteralPath (Join-Path $repository $relative) -PathType Leaf) { [void]$files.Add($relative) }
    }
    # Web protocol generation also reads the Rust declarations.
    foreach ($crate in @('wgpu-jumpstart', 'panthesia-image', 'piano-layout', 'midi-file', 'midi-io', 'panthesia-core', 'panthesia-engine', 'panthesia-vst3')) {
        $required += "$crate/Cargo.toml"
        foreach ($entry in @('src', 'assets', 'resources')) { $directories += "$crate/$entry" }
        $candidate = Join-Path $repository "$crate/build.rs"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { [void]$files.Add("$crate/build.rs") }
    }
    if ($Target -ne 'Service') {
        $required += @('panthesia-web/package.json', 'panthesia-web/package-lock.json', 'panthesia-web/index.html', 'panthesia-web/vite.config.ts')
        $directories += @('panthesia-web/src', 'panthesia-web/public', 'panthesia-web/scripts')
        if ($Target -eq 'Web') { $directories += 'panthesia-web/src-tauri/src' }
        foreach ($relative in @('.env', '.env.local', '.env.production', '.env.production.local', '.npmrc')) {
            if (Test-Path -LiteralPath (Join-Path $repository "panthesia-web/$relative") -PathType Leaf) { [void]$files.Add("panthesia-web/$relative") }
        }
        foreach ($config in Get-ChildItem -LiteralPath (Join-Path $repository 'panthesia-web') -Filter 'tsconfig*.json' -File) {
            [void]$files.Add('panthesia-web/' + $config.Name)
        }
    }
    if ($Target -eq 'Desktop') {
        $required += @('default.sf2', 'panthesia-web/src-tauri/Cargo.toml', 'panthesia-web/src-tauri/build.rs', 'panthesia-web/src-tauri/tauri.conf.json')
        $directories += @('panthesia-web/src-tauri/src', 'panthesia-web/src-tauri/icons', 'panthesia-web/src-tauri/capabilities')
        foreach ($config in Get-ChildItem -LiteralPath (Join-Path $repository 'panthesia-web/src-tauri') -Filter 'tauri.*.conf.json' -File) {
            [void]$files.Add('panthesia-web/src-tauri/' + $config.Name)
        }
    }
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $repository $relative) -PathType Leaf)) { throw "构建输入缺失：$relative" }
        [void]$files.Add($relative)
    }
    foreach ($relative in $directories) {
        $directory = Join-Path $repository $relative
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $directory -Recurse -File -Force) {
            [void]$files.Add($file.FullName.Substring($repository.TrimEnd('\', '/').Length + 1).Replace('\', '/'))
        }
    }
    $names = [Collections.Generic.List[string]]::new()
    foreach ($name in $files) { $names.Add($name) }
    $names.Sort([StringComparer]::Ordinal)
    $records = [Collections.Generic.List[string]]::new()
    foreach ($name in $names) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $repository $name) -Algorithm SHA256).Hash
        $records.Add("$name`0$hash")
    }
    $environmentNames = [Collections.Generic.List[string]]::new()
    foreach ($name in [Environment]::GetEnvironmentVariables('Process').Keys) {
        if ([string]$name -match '^(RUSTFLAGS$|RUSTC($|_)|RUSTUP_TOOLCHAIN$|CARGO_ENCODED_RUSTFLAGS$|CARGO_BUILD_|CARGO_TARGET_|CARGO_PROFILE_)' -or
            ($Target -ne 'Service' -and [string]$name -match '^VITE_') -or ($Target -eq 'Desktop' -and [string]$name -match '^TAURI_')) { $environmentNames.Add([string]$name) }
    }
    $environmentNames.Sort([StringComparer]::Ordinal)
    $environment = foreach ($name in $environmentNames) {
        $name + '=' + [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $environmentFingerprint = Get-PracticeDigest $environment
    $records.Add('environment=' + $environmentFingerprint)
    $revision = $null
    $dirty = $null
    if (Get-Command git -ErrorAction SilentlyContinue) {
        try {
            $value = & git -C $repository rev-parse HEAD 2>$null
            if ($LASTEXITCODE -eq 0) {
                $revision = [string]$value
                $status = @(& git -C $repository status --porcelain 2>$null)
                if ($LASTEXITCODE -eq 0) { $dirty = $status.Count -gt 0 }
            }
        } catch { $revision = $null; $dirty = $null }
    }
    return [ordered]@{ inputVersion = 2; target = $Target; revision = $revision; dirty = $dirty; fingerprint = (Get-PracticeDigest $records.ToArray()); files = $names.Count; environmentFingerprint = $environmentFingerprint }
}

function Get-PracticeReceiptPath {
    param([ValidateSet('Desktop', 'Service', 'Web')][string]$Target, [ValidateSet('Debug', 'Release')][string]$Configuration)
    return Join-Path (Get-PracticeRepository) "target/practice-build/$Target.$Configuration.receipt.json"
}

function Write-PracticeJson {
    param([string]$Path, [object]$Value)
    $parent = Split-Path $Path -Parent
    [void][IO.Directory]::CreateDirectory($parent)
    $temporary = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 12) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
}

function Get-PracticeBuildReceipt {
    param([ValidateSet('Desktop', 'Service', 'Web')][string]$Target, [ValidateSet('Debug', 'Release')][string]$Configuration, [object]$Source)
    $path = Get-PracticeReceiptPath $Target $Configuration
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($value.schemaVersion -ne 2 -or $value.target -ne $Target -or $value.configuration -ne $Configuration -or $value.source.fingerprint -ne $Source.fingerprint) { return $null }
        if ($value.identity.schemaVersion -ne 1 -or $value.identity.configuration -ne $Configuration -or [string]$value.identity.buildId -notmatch '^[a-fA-F0-9]{32}$' -or -not $value.completedAt) { return $null }
        if ($Target -ne 'Web' -and ($value.identity.target -ne $Target -or $value.identity.sourceFingerprint -ne $Source.fingerprint)) { return $null }
        foreach ($artifact in $value.artifacts) {
            if (-not (Test-Path -LiteralPath $artifact.path -PathType Leaf)) { return $null }
            if ((Get-Item -LiteralPath $artifact.path).Length -ne $artifact.bytes -or (Get-FileHash -LiteralPath $artifact.path -Algorithm SHA256).Hash -ne $artifact.sha256) { return $null }
        }
        if (@($value.artifacts).Count -lt 1) { return $null }
        if ($Target -ne 'Web' -and @($value.artifacts | Where-Object role -eq 'executable').Count -ne 1) { return $null }
        return $value
    } catch { return $null }
}

function Enter-PracticeBuild {
    $directory = Join-Path (Get-PracticeRepository) 'target/practice-build'
    [void][IO.Directory]::CreateDirectory($directory)
    try { return [IO.File]::Open((Join-Path $directory 'build.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch {
        $code = $_.Exception.HResult -band 0xFFFF
        if ($code -in @(32, 33)) { throw '已有构建正在使用此工程，请等待原构建结束后再继续。' }
        throw "无法打开构建锁记录：$($_.Exception.Message)"
    }
}

function ConvertTo-PracticeArgument([string]$Value) {
    if ($Value -notmatch '[\s"]' -and $Value.Length -gt 0) { return $Value }
    return '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Get-PracticeExecutableInfo([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        if ($stream.Length -lt 70 -or $reader.ReadUInt16() -ne 0x5A4D) { throw '当前构建不是 Windows 程序，请检查 Rust 目标平台。' }
        $stream.Position = 0x3C
        $offset = $reader.ReadUInt32()
        if ($offset -lt 64 -or $offset -gt $stream.Length - 6) { throw 'Windows 程序头位置无效。' }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Windows 程序头无法识别。' }
        $machine = $reader.ReadUInt16()
        $architecture = switch ($machine) { 0x8664 { 'x64' } 0x014C { 'x86' } 0xAA64 { 'ARM64' } default { 'machine-' + $machine.ToString('X4') } }
        return [ordered]@{ platform = 'Windows'; architecture = $architecture }
    } finally { $reader.Dispose() }
}

function Read-PracticePackage {
    param([Parameter(Mandatory)][string]$Package)
    $root = [IO.Path]::GetFullPath($Package).TrimEnd('\', '/')
    $manifest = Get-Content -LiteralPath (Join-Path $root 'build-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not @($manifest.files).Count) { throw '运行包文件清单为空。' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $manifest.files) {
        $relative = [string]$file.path
        if (-not $relative -or [IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or $relative.Contains('\') -or $relative -match '(^|/)\.\.?(/|$)' -or -not $seen.Add($relative)) {
            throw "运行包文件位置无效或重复：$relative"
        }
        $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
        if (-not $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '文件清单包含程序目录外的位置。' }
        $item = Get-Item -LiteralPath $path -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "文件清单指向了链接或目录：$relative" }
        $parent = $item.Directory
        while ($parent -and $parent.FullName.Length -gt $root.Length) {
            if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "运行包包含链接目录：$relative" }
            $parent = $parent.Parent
        }
        if ([string]$file.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $item.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "运行包文件内容不一致：$relative" }
    }
    foreach ($required in @('Panthesia.exe', 'default.sf2')) {
        if (-not $seen.Contains($required)) { throw "运行包清单缺少：$required" }
    }
    foreach ($actual in Get-ChildItem -LiteralPath $root -Recurse -File -Force) {
        $relative = $actual.FullName.Substring($root.Length + 1).Replace('\', '/')
        if ($relative -ne 'build-manifest.json' -and -not $seen.Contains($relative)) { throw "运行包包含未登记文件：$relative" }
    }
    return $manifest
}

Export-ModuleMember -Function Get-PracticeRepository, Get-PracticeSource, Get-PracticeReceiptPath, Write-PracticeJson, Get-PracticeBuildReceipt, Enter-PracticeBuild, ConvertTo-PracticeArgument, Read-PracticePackage, Get-PracticeExecutableInfo
