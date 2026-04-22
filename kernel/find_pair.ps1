$path = '\\Driebm-nas\3bm\50_projecten\3_3BM_bouwtechniek'
Write-Host "Looking for matching DWG/DXF pairs..."
$dwgs = Get-ChildItem -Path $path -Filter '*.dwg' -Recurse -ErrorAction SilentlyContinue
$matches = 0
foreach ($dwg in $dwgs) {
    $base = $dwg.FullName.Substring(0, $dwg.FullName.Length - 4)
    $dxf = $base + '.dxf'
    if (Test-Path -LiteralPath $dxf) {
        # Both exist; report size
        $dwgMb = [math]::Round($dwg.Length / 1MB, 1)
        $dxfMb = [math]::Round((Get-Item -LiteralPath $dxf).Length / 1MB, 1)
        # Prefer pairs where both are under 50 MB and at least 1 MB
        if ($dwgMb -lt 50 -and $dwgMb -gt 1 -and $dxfMb -lt 50 -and $dxfMb -gt 1) {
            Write-Host "DWG=$dwgMb MB / DXF=$dxfMb MB  $($dwg.FullName)"
            $matches++
            if ($matches -ge 10) { break }
        }
    }
}
Write-Host "Found $matches matching pairs (showing first 10)"
