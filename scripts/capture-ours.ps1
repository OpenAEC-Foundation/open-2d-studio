# Capture screenshot of open_2d_studio.exe window using PrintWindow.
# Binds strictly to the launched PID so we never grab unrelated windows.
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
Start-Sleep -Milliseconds 500

# Launch.
Write-Host "Launching $exe ..."
$proc = Start-Process -FilePath $exe -PassThru -WindowStyle Maximized
$pid_target = $proc.Id

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WinApi {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static List<IntPtr> WindowsForPid(uint pid) {
        var result = new List<IntPtr>();
        EnumWindows((h, l) => {
            uint wpid; GetWindowThreadProcessId(h, out wpid);
            if (wpid == pid && IsWindowVisible(h) && GetWindowTextLength(h) > 0) {
                RECT r; GetWindowRect(h, out r);
                if ((r.Right - r.Left) > 200 && (r.Bottom - r.Top) > 200) {
                    result.Add(h);
                }
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@

# Wait for a real window of the launched PID — keep polling until we
# find one with on-screen geometry (filter out splashes / off-screen
# placeholder windows used during egui startup).
$h = [IntPtr]::Zero
$tries = 0
while ($h -eq [IntPtr]::Zero -and $tries -lt 60) {
    Start-Sleep -Milliseconds 500
    $list = [WinApi]::WindowsForPid([uint32]$pid_target)
    if ($list.Count -gt 0) {
        $best = [IntPtr]::Zero; $bestArea = 0
        foreach ($hh in $list) {
            $r = New-Object WinApi+RECT
            [WinApi]::GetWindowRect($hh, [ref]$r) | Out-Null
            $w_ = $r.Right - $r.Left; $h_ = $r.Bottom - $r.Top
            # Reject offscreen (winit's pre-init phantom is at -32000,-32000)
            # and tiny placeholder windows.
            if ($r.Left -lt -10000 -or $r.Top -lt -10000) { continue }
            if ($w_ -lt 400 -or $h_ -lt 300) { continue }
            $a = $w_ * $h_
            if ($a -gt $bestArea) { $bestArea = $a; $best = $hh }
        }
        $h = $best
    }
    $tries++
}
if ($h -eq [IntPtr]::Zero) {
    Write-Error "No window for PID $pid_target after 20s."
    Stop-Process -Id $pid_target -Force -ErrorAction SilentlyContinue
    exit 1
}

$sb = New-Object System.Text.StringBuilder 256
[WinApi]::GetWindowText($h, $sb, 256) | Out-Null
Write-Host "Window: HWND=$h PID=$pid_target Title='$($sb.ToString())'"

# Move/size and bring to front.
[WinApi]::ShowWindow($h, 9) | Out-Null  # SW_RESTORE
Start-Sleep -Milliseconds 300
[WinApi]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 1920, 1200, 0x44) | Out-Null
Start-Sleep -Milliseconds 300
[WinApi]::ShowWindow($h, 3) | Out-Null  # SW_MAXIMIZE
[WinApi]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Seconds 3

$rect = New-Object WinApi+RECT
[WinApi]::GetWindowRect($h, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$hh = $rect.Bottom - $rect.Top
Write-Host ("Geometry: {0}x{1} at ({2},{3})" -f $w, $hh, $rect.Left, $rect.Top)

# PrintWindow with PW_RENDERFULLCONTENT (= 0x2) to capture egui contents
# even when occluded. Fall back to CopyFromScreen if PrintWindow returns false.
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $gfx.GetHdc()
$ok = [WinApi]::PrintWindow($h, $hdc, 0x2)
$gfx.ReleaseHdc($hdc)
if (-not $ok) {
    Write-Host "PrintWindow failed, falling back to CopyFromScreen."
    $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
}
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose(); $bmp.Dispose()
Write-Host "Saved: $outPath"

Stop-Process -Id $pid_target -Force -ErrorAction SilentlyContinue
