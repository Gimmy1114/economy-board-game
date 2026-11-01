# 無 Node.js 環境的建置替代方案。
# 將來源模組依相依順序串接成 game.js，並移除 import / export 語法。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$files = @(
  'data.js',
  'party_data.js',
  'engine.js',
  'party_engine.js',
  'sync.js',
  'net.js',
  'audio_system.js',
  'ui_party.js',
  'app.js'
)
$parts = foreach ($file in $files) {
  $path = Join-Path $root $file
  $text = [System.IO.File]::ReadAllText($path)
  $text = [regex]::Replace($text, "(?ms)^import\s+[^;]*?\s+from\s+'\./[^']+';\s*", '')
  $text = [regex]::Replace($text, "(?m)^import\s+'\./[^']+';\s*", '')
  $text = [regex]::Replace($text, '(?m)^export\s+(?=(?:const|let|var|function|class)\b)', '')
  $text.TrimEnd()
}
$header = "// Generated from $($files -join ', '). Run node build.mjs (or build.ps1) after source edits.`r`n'use strict';`r`n"
$output = $header + ($parts -join "`r`n`r`n")
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $root 'game.js'), $output, $utf8)
Write-Host "Built game.js from $($files.Count) source files."
