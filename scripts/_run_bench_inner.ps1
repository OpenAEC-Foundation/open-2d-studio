# Helper invoked by bench_ifcdraw_size.ps1 — just run the binary once per
# file in series, capture each JSON line, dump to a `.jsonl` file. Easier
# to debug than Start-Job and avoids inheriting timeouts on huge files.

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BinPath,
    [Parameter(Mandatory=$true)][string]$TmpDir,
    [Parameter(Mandatory=$true)][string]$JsonlOut,
    [Parameter(Mandatory=$true)][string[]]$Files,
    [int]$TimeoutSec = 1500
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
"" | Out-File -LiteralPath $JsonlOut -Encoding utf8

$i = 0
foreach ($src in $Files) {
    $i += 1
    $name = Split-Path -Leaf $src
    if (-not (Test-Path -LiteralPath $src)) {
        Write-Host "[$i/$($Files.Count)] skip missing: $src"
        continue
    }
    $safe = ($name -replace '[^A-Za-z0-9_.-]','_')
    $out  = Join-Path $TmpDir ($safe + ".ifcdraw")
    Write-Host "[$i/$($Files.Count)] $name"

    $proc = Start-Process -FilePath $BinPath `
        -ArgumentList @('"' + $src + '"', '"' + $out + '"') `
        -NoNewWindow -PassThru -RedirectStandardOutput "$TmpDir/last.out" -RedirectStandardError "$TmpDir/last.err"
    if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
        try { $proc.Kill() } catch {}
        $errJson = "{`"name`":`"$name`",`"error`":`"timeout`"}"
        Add-Content -LiteralPath $JsonlOut -Value $errJson
        Write-Host "  TIMEOUT"
        continue
    }

    $stdout = (Get-Content -LiteralPath "$TmpDir/last.out" -ErrorAction SilentlyContinue) -join "`n"
    $line = $null
    foreach ($l in ($stdout -split "`n")) {
        $t = $l.Trim()
        if ($t.StartsWith("{") -and $t.EndsWith("}")) { $line = $t }
    }
    if (-not $line) {
        Write-Host "  no-json (exit=$($proc.ExitCode))"
        $errJson = "{`"name`":`"$name`",`"error`":`"no-json-exit=$($proc.ExitCode)`"}"
        Add-Content -LiteralPath $JsonlOut -Value $errJson
        continue
    }
    Add-Content -LiteralPath $JsonlOut -Value $line
    try {
        $obj = $line | ConvertFrom-Json
        $sk = if ($obj.src_bytes -gt 0) { [math]::Round($obj.src_bytes/1KB,1) } else { 0 }
        $ok = if ($obj.ifcdraw_bytes) { [math]::Round($obj.ifcdraw_bytes/1KB,1) } else { 0 }
        Write-Host ("  ok: src={0}KB ifc={1}KB ratio={2:N3} segs={3} tris={4}" -f $sk, $ok, [double]$obj.ratio, $obj.n_segs, $obj.n_tris)
    } catch {
        Write-Host "  parse-err"
    }
}
Write-Host "[bench] done. jsonl: $JsonlOut"
