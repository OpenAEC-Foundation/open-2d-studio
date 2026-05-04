# Capture screenshot of open_2d_studio.exe window.
# Usage: powershell -File scripts/capture-ours.ps1 -Round 01
param(
    [string]$Round = "01"
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\.."
$exe = Join-Path $repo "kernel\target\release\open_2d_studio.exe"
$outDir = Join-Path $repo "docs\superpowers\plans\artefacts"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir "ours-$Round.png"

# Kill any existing instance.
Get-Process -Name "open_2d_studio" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Launch the binary.
Write-Host "Launching $exe ..."
$proc = Start-Process -FilePath $exe -PassThru -WindowStyle Maximized
Start-Sleep -Seconds 4

# Find window.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Find by main window handle.
$h = $proc.MainWindowHandle
$tries = 0
while ($h -eq [IntPtr]::Zero -and $tries -lt 20) {
    Start-Sleep -Milliseconds 500
    $proc.Refresh()
    $h = $proc.MainWindowHandle
    $tries++
}
if ($h -eq [IntPtr]::Zero) {
    Write-Error "Could not find main window."
    exit 1
}

# Maximize via ShowWindow SW_MAXIMIZE = 3
[Win32]::ShowWindow($h, 3) | Out-Null
[Win32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Seconds 2

$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($h, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$hh = $rect.Bottom - $rect.Top
Write-Host ("Window: {0}x{1} at ({2},{3})" -f $w, $hh, $rect.Left, $rect.Top)

$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "Saved: $outPath"

# Cleanup.
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
