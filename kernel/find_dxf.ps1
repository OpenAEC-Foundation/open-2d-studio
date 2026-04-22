$path = '\\Driebm-nas\3bm\50_projecten\3_3BM_bouwtechniek'
Write-Host "Scanning $path for DXF files..."
$files = Get-ChildItem -Path $path -Filter '*.dxf' -Recurse -ErrorAction SilentlyContinue
Write-Host "Found $($files.Count) DXF files"
$top = $files | Sort-Object Length -Descending | Select-Object -First 10
foreach ($f in $top) {
    $mb = [math]::Round($f.Length / 1MB, 1)
    Write-Host "$mb MB  $($f.FullName)"
}
