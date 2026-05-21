# bench_ifcdraw_size.ps1
# -----------------------------------------------------------------------------
# Benchmark IFCDraw file size vs. source DWG/DXF across the canonical test
# corpus. Calls the `ifcdraw-bench` binary once per file (single JSON line
# stdout per call), rolls the results into a markdown table, and writes them
# to docs/superpowers/plans/artefacts/ifcdraw-size-baseline.md.
#
# Usage:
#   powershell -File scripts\bench_ifcdraw_size.ps1
#   powershell -File scripts\bench_ifcdraw_size.ps1 -Round R0 -Notes "baseline"
#   powershell -File scripts\bench_ifcdraw_size.ps1 -Files @("C:\foo.dwg")
#   powershell -File scripts\bench_ifcdraw_size.ps1 -MaxSizeMB 5
#
# When -Append, rounds are concatenated under one another for easy diffing.

[CmdletBinding()]
param(
    [string]   $Round   = "baseline",
    [string]   $Notes   = "",
    [string[]] $Files   = @(),
    [string]   $OutMd   = "docs/superpowers/plans/artefacts/ifcdraw-size-baseline.md",
    [string]   $TmpDir  = "$env:TEMP/ifcdraw-bench",
    [int]      $MaxSizeMB = 0,
    [switch]   $Append,
    [switch]   $SkipBuild,
    [int]      $TimeoutSec = 1500
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Kernel = Join-Path $Root "kernel"
$Bin = Join-Path $Kernel "target/release/ifcdraw-bench.exe"

if (-not $SkipBuild) {
    Write-Host "[bench] building ifcdraw-bench (release)..."
    Push-Location $Kernel
    try {
        & cargo build --release --bin ifcdraw-bench --bin ifcx-size-check 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "cargo build failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $Bin)) { throw "ifcdraw-bench not found at $Bin" }
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

# -----------------------------------------------------------------------------
# Default corpus.  Pair lives in verification-files (NOT Desktop) on this box.
# -----------------------------------------------------------------------------
if (-not $Files -or $Files.Count -eq 0) {
    $Files = @()
    $candidates = @(
        "C:/Users/rickd/Documents/GitHub/verification-files/DWG-DXF/pair.dwg",
        "C:/Users/rickd/Documents/GitHub/verification-files/DWG-DXF/pair.dxf",
        "C:/Users/rickd/Documents/GitHub/verification-files/DWG-DXF/test65.dwg",
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/2705_model Funderingsherstel - Constructie - Sheet - CP-21 - Constructietekening.dwg",
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/2705_model Funderingsherstel - Constructie - Sheet - CP-21 - Constructietekening.dxf"
    )
    foreach ($p in $candidates) { if (Test-Path -LiteralPath $p) { $Files += $p } }

    $testDir = "C:/Users/rickd/Desktop/dwg_samples/test"
    if (Test-Path $testDir) {
        $Files += (Get-ChildItem -LiteralPath $testDir -File -Filter "*.dwg" | ForEach-Object { $_.FullName })
    }
}

if ($MaxSizeMB -gt 0) {
    $cap = $MaxSizeMB * 1MB
    $Files = $Files | Where-Object { (Test-Path -LiteralPath $_) -and ((Get-Item -LiteralPath $_).Length -lt $cap) }
}

Write-Host "[bench] $($Files.Count) input files"
$Jsonl = Join-Path $TmpDir ("results-" + ($Round -replace '[^A-Za-z0-9_.-]','_') + ".jsonl")
& (Join-Path $PSScriptRoot "_run_bench_inner.ps1") -BinPath $Bin -TmpDir $TmpDir -JsonlOut $Jsonl -Files $Files -TimeoutSec $TimeoutSec

# -----------------------------------------------------------------------------
# Read JSONL into result objects.
# -----------------------------------------------------------------------------
$Results = New-Object System.Collections.Generic.List[psobject]
$lines = Get-Content -LiteralPath $Jsonl -ErrorAction SilentlyContinue
foreach ($line in $lines) {
    if (-not $line) { continue }
    $t = $line.Trim()
    if (-not $t.StartsWith("{")) { continue }
    try { $obj = $t | ConvertFrom-Json } catch { continue }
    if ($obj.PSObject.Properties.Name -contains "error") {
        $Results.Add([pscustomobject]@{
            name = $obj.name; ok = $false; ratio = $null
            src_bytes = if ($obj.src_bytes) { [long]$obj.src_bytes } else { 0L }
            ifcdraw_bytes = $null; n_segs = $null; n_tris = $null; n_layers = $null
            parse_ms = $null; save_ms = $null; error = $obj.error
        })
    } else {
        $Results.Add([pscustomobject]@{
            name = $obj.name; ok = $true; ratio = [double]$obj.ratio
            src_bytes = [long]$obj.src_bytes; ifcdraw_bytes = [long]$obj.ifcdraw_bytes
            n_segs = [long]$obj.n_segs; n_tris = [long]$obj.n_tris; n_layers = [int]$obj.n_layers
            n_entities = [long]$obj.n_entities
            parse_ms = [long]$obj.parse_ms; save_ms = [long]$obj.save_ms; error = $null
        })
    }
}

# -----------------------------------------------------------------------------
# Pretty markdown table.
# -----------------------------------------------------------------------------
function Format-Size([Nullable[long]]$b) {
    if ($null -eq $b) { return "-" }
    if ($b -lt 1024) { return "$b B" }
    elseif ($b -lt 1024*1024) { return ("{0:N1} KB" -f ($b/1024)) }
    elseif ($b -lt 1024*1024*1024) { return ("{0:N1} MB" -f ($b/(1024*1024))) }
    else { return ("{0:N2} GB" -f ($b/(1024*1024*1024))) }
}

$table = New-Object System.Text.StringBuilder
[void]$table.AppendLine("## Round: $Round")
if ($Notes) { [void]$table.AppendLine(""); [void]$table.AppendLine($Notes) }
[void]$table.AppendLine("")
[void]$table.AppendLine("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$table.AppendLine("")
[void]$table.AppendLine("| File | Src | IFCDraw | Ratio | < 1.0? | Segs | Tris | Layers | Parse ms | Save ms |")
[void]$table.AppendLine("|---|---:|---:|---:|:---:|---:|---:|---:|---:|---:|")

$sumSrc = 0L; $sumOut = 0L
foreach ($r in $Results | Sort-Object -Property name) {
    if ($r.ok) {
        $sumSrc += $r.src_bytes
        $sumOut += $r.ifcdraw_bytes
        $mark = if ($r.ratio -lt 1.0) { "yes" } else { "**NO**" }
        $line = "| ``{0}`` | {1} | {2} | {3:N3} | {4} | {5:N0} | {6:N0} | {7} | {8} | {9} |" -f `
            $r.name, (Format-Size $r.src_bytes), (Format-Size $r.ifcdraw_bytes), $r.ratio, $mark, `
            $r.n_segs, $r.n_tris, $r.n_layers, $r.parse_ms, $r.save_ms
    } else {
        $line = "| ``{0}`` | {1} | error: {2} | - | - | - | - | - | - | - |" -f $r.name, (Format-Size $r.src_bytes), $r.error
    }
    [void]$table.AppendLine($line)
}

if ($sumSrc -gt 0) {
    $totRatio = $sumOut / $sumSrc
    [void]$table.AppendLine("| **TOTAL** | **$(Format-Size $sumSrc)** | **$(Format-Size $sumOut)** | **$([string]::Format('{0:N3}',$totRatio))** | | | | | | |")
}
[void]$table.AppendLine("")

# -----------------------------------------------------------------------------
# Write / append output markdown.
# -----------------------------------------------------------------------------
$outPath = Join-Path $Root $OutMd
$outDir = Split-Path -Parent $outPath
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if ($Append -and (Test-Path $outPath)) {
    Add-Content -LiteralPath $outPath -Value $table.ToString()
} else {
    $header = "# IFCDraw size baseline vs. source DWG/DXF`n`n" + `
              "Measurements emitted by ``scripts/bench_ifcdraw_size.ps1``.`n" + `
              "``ratio = ifcdraw_bytes / src_bytes``; values < 1.0 mean we beat the source DWG.`n`n"
    Set-Content -LiteralPath $outPath -Value ($header + $table.ToString())
}

Write-Host "[bench] wrote $outPath"
Write-Host ""
$table.ToString() | Out-Host
