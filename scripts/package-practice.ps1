param(
    [Parameter(Mandatory)][string]$Destination,
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Release',
    [switch]$Offline,
    [switch]$SkipBuild
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'practice-build.psm1') -Force
$repository = Get-PracticeRepository
$Destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination).TrimEnd('\', '/')
if (Test-Path -LiteralPath $Destination) { throw '运行包目录已存在，请使用新的目录；已有内容继续保留。' }
$parent = Split-Path $Destination -Parent
if (-not $parent) { throw '请为运行包指定完整目录位置。' }
[void][IO.Directory]::CreateDirectory($parent)
$stage = [IO.Path]::GetFullPath((Join-Path $parent ('.' + [IO.Path]::GetFileName($Destination) + '.stage-' + [Guid]::NewGuid().ToString('N'))))
if (-not [string]::Equals((Split-Path $stage -Parent), $parent, [StringComparison]::OrdinalIgnoreCase)) { throw '暂存目录未位于指定的运行包目录旁。' }
try {
    if (-not $SkipBuild) {
        & (Join-Path $PSScriptRoot 'build-practice.ps1') -Target Desktop -Configuration $Configuration -Offline:$Offline
    }
    $source = Get-PracticeSource Desktop
    $receipt = Get-PracticeBuildReceipt Desktop $Configuration $source
    if (-not $receipt) { throw '桌面程序缺少与当前源码和文件内容一致的构建记录，请先完成构建。' }
    [void][IO.Directory]::CreateDirectory($stage)
    $executable = @($receipt.artifacts | Where-Object role -eq 'executable')[0]
    $platform = Get-PracticeExecutableInfo $executable.path
    Copy-Item -LiteralPath $executable.path -Destination (Join-Path $stage 'Panthesia.exe')
    Copy-Item -LiteralPath (Join-Path $repository 'panthesia-engine/assets/starter-pack') -Destination (Join-Path $stage '入门曲库') -Recurse
    if ((Get-FileHash -LiteralPath (Join-Path $stage 'Panthesia.exe') -Algorithm SHA256).Hash -ne $executable.sha256) { throw '复制后的程序与原构建记录不一致。' }
    $resources = [ordered]@{
        'default.sf2' = 'default.sf2'
        'LICENSE' = 'LICENSE'
        'NOTICE.md' = 'NOTICE.md'
        'third-party/MIDIVisualizer/LICENSE' = 'ThirdParty/MIDIVisualizer/LICENSE'
        'docs/development/desktop-guide.txt' = '使用说明.txt'
        'panthesia-web/public/verovio/NOTICE.md' = 'ThirdParty/Verovio/NOTICE.md'
        'panthesia-web/public/verovio/COPYING' = 'ThirdParty/Verovio/COPYING'
        'panthesia-web/public/verovio/COPYING.LESSER' = 'ThirdParty/Verovio/COPYING.LESSER'
        'panthesia-web/public/pdfjs/LICENSE' = 'ThirdParty/PDF.js/LICENSE'
        'third-party/audio_thread_priority/LICENSE' = 'ThirdParty/audio_thread_priority/LICENSE'
        'third-party/audio_thread_priority/NOTICE.md' = 'ThirdParty/audio_thread_priority/NOTICE.md'
        'third-party/audio_thread_priority/audio_thread_priority-0.35.1.crate' = 'ThirdParty/audio_thread_priority/audio_thread_priority-0.35.1.crate'
    }
    foreach ($inputPath in $resources.Keys) {
        $original = Join-Path $repository $inputPath
        $hash = (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash
        $output = Join-Path $stage $resources[$inputPath]
        [void][IO.Directory]::CreateDirectory((Split-Path $output -Parent))
        Copy-Item -LiteralPath $original -Destination $output
        if ((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash -ne $hash) { throw "资源复制期间发生变化：$inputPath" }
    }
    $launcher = @('@echo off', 'setlocal', 'set PANTHESIA_HEADLESS_CHECK=', 'start "" /D "%~dp0" "%~dp0Panthesia.exe" %*') -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $stage 'Open.cmd'), ($launcher + "`r`n"), [Text.Encoding]::ASCII)
    Write-PracticeJson (Join-Path $stage 'build-info.json') $receipt.identity
    $revision = if ($receipt.source.revision) { $receipt.source.revision } else { '未登记' }
    $dirty = if ($null -eq $receipt.source.dirty) { '未登记' } elseif ($receipt.source.dirty) { '包含本地修改' } else { '源码提交已保存' }
    $versionText = @(
        "Panthesia $($receipt.identity.version)", "$($platform.platform) / $($platform.architecture)",
        "构建时间：$($receipt.identity.builtAt)", "完成时间：$($receipt.completedAt)", "来源提交：$revision", "源码状态：$dirty",
        "构建编号：$($receipt.identity.buildId)", "源码内容标识：$($receipt.source.fingerprint)", '',
        '双击 Panthesia.exe 打开。移动软件时请保留整个运行包与 default.sf2。',
        '在应用设置中打开“关于此版本”，可查看实际程序与练习资料的位置。'
    ) -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $stage '版本信息.txt'), ($versionText + "`r`n"), [Text.UTF8Encoding]::new($true))
    $files = @(Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($stage.Length + 1).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; bytes = $_.Length }
    })
    Write-PracticeJson (Join-Path $stage 'build-manifest.json') ([ordered]@{
        manifestVersion = 2; version = $receipt.identity.version; buildId = $receipt.identity.buildId
        revision = $receipt.source.revision; dirty = $receipt.source.dirty
        sourceFingerprint = $receipt.source.fingerprint; sourceFiles = $receipt.source.files
        configuration = $Configuration; builtAt = $receipt.identity.builtAt; completedAt = $receipt.completedAt; packagedAt = [DateTime]::UtcNow.ToString('o')
        platform = $platform.platform; architecture = $platform.architecture
        packagedFromRevision = $source.revision; files = $files
    })
    $null = Read-PracticePackage $stage
    if ((Get-PracticeSource Desktop).fingerprint -ne $source.fingerprint) { throw '复制运行包期间源码发生变化，本次暂存目录继续保留。' }
    if (-not [string]::Equals((Split-Path ([IO.Path]::GetFullPath($Destination)) -Parent), $parent, [StringComparison]::OrdinalIgnoreCase)) { throw '运行包发布位置发生变化。' }
    [IO.Directory]::Move($stage, $Destination)
    Write-Output "运行包已生成：$Destination"
    Write-Output "直接打开：$(Join-Path $Destination 'Panthesia.exe')"
} catch {
    if (Test-Path -LiteralPath $stage) { throw "运行包未发布，暂存文件保留在 $stage。$($_.Exception.Message)" }
    throw
}
