param([string]$Report = 'work/notation-capabilities.json')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
    foreach ($entry in (Get-Content -LiteralPath 'panthesia-engine/assets/notation-corpus/manifest.json' -Raw | ConvertFrom-Json)) {
        $actual = (Get-FileHash -LiteralPath (Join-Path 'panthesia-engine/assets/notation-corpus' $entry.file) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $entry.sha256) { throw "固定谱例内容不一致：$($entry.file)" }
    }
    $fixtures = @(Get-ChildItem -LiteralPath 'panthesia-engine/assets/notation-corpus' -Filter '*.musicxml' | ForEach-Object FullName)
    $fixtures += @(Get-ChildItem -LiteralPath 'panthesia-engine/assets/notation-corpus' -Filter '*.mxl' | ForEach-Object FullName)
    $fixtures += @(Get-ChildItem -LiteralPath 'panthesia-engine/assets/starter-pack' -Filter '*.musicxml' | ForEach-Object FullName)
    & cargo run --quiet -p panthesia-core --example notation-capabilities -- @fixtures | Set-Content -LiteralPath $Report -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw '乐谱能力检查失败，请查看报告。' }
} finally { Pop-Location }
