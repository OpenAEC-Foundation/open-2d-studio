#!/usr/bin/env pwsh
# Bulk-render LibreDWG test corpus DWG/DXF pairs across all AutoCAD versions.
# Output: docs/superpowers/plans/artefacts/corpus-renders-libredwg/<version>/<basename>.{dwg,dxf}.png
#         + per-pair .log file with exit code, stderr tail, file size.

$ErrorActionPreference = 'Stop'
$root = "C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data"
$out  = "C:\Users\rickd\Documents\GitHub\open-2d-studio\docs\superpowers\plans\artefacts\corpus-renders-libredwg"
$exe  = "C:\Users\rickd\Documents\GitHub\open-2d-studio\kernel\target\release\headless-render.exe"
$timeoutSec = 90
$widthHeight = 1024
$picksPerVersion = 3

$versions = @('r1.4','r2.6','r2.10','r9','r10','r11','r12','r13','r14','2000','2004','2007','2010','2013','2018')

New-Item -ItemType Directory -Force -Path $out | Out-Null

foreach ($v in $versions) {
    $vDir = Join-Path $root $v
    if (-not (Test-Path $vDir)) { Write-Host "skip $v (no folder)"; continue }
    $vOut = Join-Path $out $v
    New-Item -ItemType Directory -Force -Path $vOut | Out-Null

    $dwgs = Get-ChildItem -Path $vDir -Filter *.dwg -ErrorAction SilentlyContinue
    $dxfs = Get-ChildItem -Path $vDir -Filter *.dxf -ErrorAction SilentlyContinue

    # Build pair list (basename → has dwg + has dxf)
    $bases = @{}
    foreach ($f in $dwgs) { $b = [io.path]::GetFileNameWithoutExtension($f.Name); if (-not $bases[$b]) { $bases[$b] = @{} }; $bases[$b].dwg = $f.FullName }
    foreach ($f in $dxfs) { $b = [io.path]::GetFileNameWithoutExtension($f.Name); if (-not $bases[$b]) { $bases[$b] = @{} }; $bases[$b].dxf = $f.FullName }

    $pairs   = $bases.GetEnumerator() | Where-Object { $_.Value.dwg -and $_.Value.dxf }
    $dwgOnly = $bases.GetEnumerator() | Where-Object { $_.Value.dwg -and -not $_.Value.dxf }
    $dxfOnly = $bases.GetEnumerator() | Where-Object { -not $_.Value.dwg -and $_.Value.dxf }

    # Prefer pairs; if none, fall back to dwg-only or dxf-only
    $picks = @($pairs | Select-Object -First $picksPerVersion)
    if ($picks.Count -lt $picksPerVersion) {
        $picks += @($dwgOnly | Select-Object -First ($picksPerVersion - $picks.Count))
    }
    if ($picks.Count -lt $picksPerVersion) {
        $picks += @($dxfOnly | Select-Object -First ($picksPerVersion - $picks.Count))
    }

    Write-Host "== $v : picked $($picks.Count) ==" -ForegroundColor Cyan

    foreach ($p in $picks) {
        $base = $p.Key
        foreach ($ext in @('dwg','dxf')) {
            $src = $p.Value[$ext]
            if (-not $src) { continue }
            $png = Join-Path $vOut "$base.$ext.png"
            $log = Join-Path $vOut "$base.$ext.log"

            $stdoutTmp = [io.path]::GetTempFileName()
            $stderrTmp = [io.path]::GetTempFileName()
            $startTs = Get-Date
            try {
                $proc = Start-Process -FilePath $exe `
                    -ArgumentList @($src, $png, "--width=$widthHeight", "--height=$widthHeight") `
                    -RedirectStandardOutput $stdoutTmp `
                    -RedirectStandardError  $stderrTmp `
                    -PassThru -NoNewWindow

                if (-not $proc.WaitForExit($timeoutSec * 1000)) {
                    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
                    "TIMEOUT after ${timeoutSec}s -- $src" | Out-File $log -Encoding utf8
                    Write-Host "  TIMEOUT $base.$ext" -ForegroundColor Red
                    continue
                }

                $code = $proc.ExitCode
                $secs = ((Get-Date) - $startTs).TotalSeconds
                $stderrText = Get-Content $stderrTmp -Raw -ErrorAction SilentlyContinue
                if ($null -eq $stderrText) { $stderrText = '' }
                $stdoutText = Get-Content $stdoutTmp -Raw -ErrorAction SilentlyContinue
                if ($null -eq $stdoutText) { $stdoutText = '' }
                $sizeKb = if (Test-Path $png) { [int]((Get-Item $png).Length / 1024) } else { 0 }

                @(
                    "exit=$code  duration=$([math]::Round($secs,1))s  png_kb=$sizeKb",
                    "src=$src",
                    "png=$png",
                    "--- stderr (last 40 lines) ---",
                    (($stderrText -split "`r?`n") | Select-Object -Last 40 | Out-String),
                    "--- stdout (last 20 lines) ---",
                    (($stdoutText -split "`r?`n") | Select-Object -Last 20 | Out-String)
                ) | Out-File $log -Encoding utf8

                $tag = if ($code -eq 0 -and $sizeKb -gt 0) { 'OK' } else { "FAIL($code)" }
                Write-Host ("  {0,-6} {1}.{2}  ({3}s, {4} KB)" -f $tag, $base, $ext, [math]::Round($secs,1), $sizeKb)
            } finally {
                Remove-Item $stdoutTmp, $stderrTmp -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Host "DONE -- see $out" -ForegroundColor Green
