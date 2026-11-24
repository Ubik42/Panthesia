param(
    [Parameter(Mandatory)][string]$Destination,
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Release',
    [switch]$Offline,
    [switch]$SkipBuild,
    # Same-day rebuild: replace an existing package at the destination once the new one is ready.
    [switch]$Replace,
    # Make the new package the one Windows starts: App Paths, Start-menu and desktop shortcuts that
    # start Panthesia point at it, and older Panthesia-YYYYMMDD packages beside it go to the
    # recycle bin (one version a day; a launcher must never start yesterday's build).
    [switch]$Publish
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'practice-build.psm1') -Force
$repository = Get-PracticeRepository
$Destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination).TrimEnd('\', '/')
if ((Test-Path -LiteralPath $Destination) -and -not $Replace) { throw '运行包目录已存在：同一天重新打包请加 -Replace，否则使用新的目录；已有内容继续保留。' }
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
        'docs/pages/guide.md' = '使用说明.md'
        'panthesia-web/public/verovio/NOTICE.md' = 'ThirdParty/Verovio/NOTICE.md'
        'panthesia-web/public/verovio/COPYING' = 'ThirdParty/Verovio/COPYING'
        'panthesia-web/public/verovio/COPYING.LESSER' = 'ThirdParty/Verovio/COPYING.LESSER'
        'panthesia-web/public/pdfjs/LICENSE' = 'ThirdParty/PDF.js/LICENSE'
        'panthesia-audio/vendor/signalsmith-stretch/LICENSE.txt' = 'ThirdParty/Signalsmith-Stretch/LICENSE.txt'
        'panthesia-audio/vendor/signalsmith-stretch/dsp/LICENSE.txt' = 'ThirdParty/Signalsmith-Stretch/dsp/LICENSE.txt'
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
    if (Test-Path -LiteralPath $Destination) {
        # The old package moves aside first; a running copy keeps it locked, and then nothing changes.
        $old = Join-Path $parent ('.' + [IO.Path]::GetFileName($Destination) + '.old-' + [Guid]::NewGuid().ToString('N'))
        try { [IO.Directory]::Move($Destination, $old) } catch { throw "旧运行包正在使用（请先退出 Panthesia），新包保留在暂存目录 $stage。" }
        [IO.Directory]::Move($stage, $Destination)
        Remove-Item -LiteralPath $old -Recurse -Force
    } else {
        [IO.Directory]::Move($stage, $Destination)
    }
    Write-Output "运行包已生成：$Destination"
    Write-Output "直接打开：$(Join-Path $Destination 'Panthesia.exe')"
    if ($Publish) {
        $exe = Join-Path $Destination 'Panthesia.exe'
        $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\Panthesia.exe'
        if (-not (Test-Path $key)) { [void](New-Item -Path $key -Force) }
        Set-ItemProperty -Path $key -Name '(default)' -Value $exe
        Set-ItemProperty -Path $key -Name 'Path' -Value $Destination
        $shell = New-Object -ComObject WScript.Shell
        $places = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'))
        foreach ($place in $places | Where-Object { $_ -and (Test-Path $_) }) {
            foreach ($link in Get-ChildItem -LiteralPath $place -Filter *.lnk -File -ErrorAction SilentlyContinue) {
                $shortcut = $shell.CreateShortcut($link.FullName)
                if ($shortcut.TargetPath -match '[\\/]Panthesia-\d{8}[\\/]Panthesia\.exe$' -and $shortcut.TargetPath -ne $exe) {
                    $shortcut.TargetPath = $exe
                    $shortcut.WorkingDirectory = $Destination
                    $shortcut.Save()
                    Write-Output "已更新快捷方式：$($link.FullName)"
                }
            }
        }
        Add-Type -AssemblyName Microsoft.VisualBasic
        foreach ($older in Get-ChildItem -LiteralPath $parent -Directory | Where-Object { $_.Name -match '^Panthesia-\d{8}$' -and $_.Name -ne [IO.Path]::GetFileName($Destination) }) {
            try {
                [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($older.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
                Write-Output "旧运行包已移入回收站：$($older.Name)"
            } catch { Write-Output "旧运行包正在使用，未移除：$($older.Name)" }
        }
    }
} catch {
    if (Test-Path -LiteralPath $stage) { throw "运行包未发布，暂存文件保留在 $stage。$($_.Exception.Message)" }
    throw
}
