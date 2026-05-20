# install-viewer.ps1 — install Open 2D Viewer for the current Windows user.
#
# Builds (if needed) and installs the open_2d_viewer.exe binary to
# %LOCALAPPDATA%\Open2DViewer\, creates a desktop shortcut, and a Start
# Menu entry. Does NOT touch any existing Open 2D Studio install.
#
# Usage (from the repo root, PowerShell):
#   .\scripts\install-viewer.ps1
#   .\scripts\install-viewer.ps1 -SkipBuild           # use existing release exe
#   .\scripts\install-viewer.ps1 -NoDesktopShortcut   # skip desktop link
#
# The script is idempotent — re-running it overwrites the installed exe
# and refreshes both shortcuts.

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$NoDesktopShortcut,
    [switch]$NoStartMenu
)

$ErrorActionPreference = 'Stop'
$RepoRoot              = Resolve-Path (Join-Path $PSScriptRoot '..')
$KernelDir             = Join-Path $RepoRoot 'kernel'
$ReleaseBin            = Join-Path $KernelDir 'target\release\open_2d_viewer.exe'
$InstallDir            = Join-Path $env:LOCALAPPDATA 'Open2DViewer'
$InstalledBin          = Join-Path $InstallDir 'Open2DViewer.exe'

Write-Host "Open 2D Viewer installer"
Write-Host "  repo:    $RepoRoot"
Write-Host "  target:  $InstallDir"

# --- 1. Build (unless skipped) ----------------------------------------------
if (-not $SkipBuild) {
    Write-Host "`n[1/4] Building release binary..."
    Push-Location $KernelDir
    try {
        cargo build --release --bin open_2d_viewer
        if ($LASTEXITCODE -ne 0) {
            throw "cargo build failed (exit $LASTEXITCODE)"
        }
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "`n[1/4] Skipping build (--SkipBuild)"
}

if (-not (Test-Path $ReleaseBin)) {
    throw "Release binary not found: $ReleaseBin"
}

# --- 2. Copy binary into the user-local install dir ------------------------
Write-Host "`n[2/4] Installing binary to $InstallDir"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path $ReleaseBin -Destination $InstalledBin -Force
$installedSize = (Get-Item $InstalledBin).Length
Write-Host ("       wrote {0} ({1:N0} bytes)" -f $InstalledBin, $installedSize)

# --- 3. Desktop shortcut ---------------------------------------------------
$WScriptShell = New-Object -ComObject WScript.Shell

if (-not $NoDesktopShortcut) {
    $desktopDir  = [Environment]::GetFolderPath('Desktop')
    $desktopLink = Join-Path $desktopDir 'Open 2D Viewer.lnk'
    Write-Host "`n[3/4] Creating desktop shortcut: $desktopLink"
    $sc            = $WScriptShell.CreateShortcut($desktopLink)
    $sc.TargetPath = $InstalledBin
    $sc.WorkingDirectory = $InstallDir
    $sc.IconLocation = "$InstalledBin,0"
    $sc.Description  = 'Open 2D Viewer — view-only DWG/DXF browser'
    $sc.Save()
} else {
    Write-Host "`n[3/4] Skipping desktop shortcut (--NoDesktopShortcut)"
}

# --- 4. Start Menu entry ---------------------------------------------------
if (-not $NoStartMenu) {
    $startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $startLink    = Join-Path $startMenuDir 'Open 2D Viewer.lnk'
    Write-Host "`n[4/4] Creating Start Menu entry: $startLink"
    $sm            = $WScriptShell.CreateShortcut($startLink)
    $sm.TargetPath = $InstalledBin
    $sm.WorkingDirectory = $InstallDir
    $sm.IconLocation = "$InstalledBin,0"
    $sm.Description  = 'Open 2D Viewer — view-only DWG/DXF browser'
    $sm.Save()
} else {
    Write-Host "`n[4/4] Skipping Start Menu entry (--NoStartMenu)"
}

Write-Host "`nInstalled. Launch from:"
Write-Host "  - Desktop:    'Open 2D Viewer'"
Write-Host "  - Start Menu: 'Open 2D Viewer'"
Write-Host "  - CLI:        $InstalledBin"
Write-Host "`nThe existing Open 2D Studio install (if any) is unchanged."
