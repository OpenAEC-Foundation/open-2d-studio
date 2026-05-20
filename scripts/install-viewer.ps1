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
# Matches studio_app::run's SetCurrentProcessExplicitAppUserModelID call.
# Setting the same string on the .lnk's System.AppUserModel.ID property
# tells Windows that "launching this shortcut" and "the running process"
# belong to the same taskbar group — so the pinned-entry icon, the
# Alt-Tab icon, and the running-window icon all come from the .exe
# resource we embed via winres (build.rs).
$AppUserModelId        = 'OpenAEC.Open2DViewer.1'

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

# Stamp System.AppUserModel.ID (PKEY_AppUserModel_ID) onto a .lnk so the
# taskbar / Start menu / Alt-Tab bind the shortcut to our process group.
# WScript.Shell's CreateShortcut doesn't expose this property, so we
# call the IShellLink-as-IPropertyStore COM path directly.
function Set-ShortcutAppUserModelId {
    param([Parameter(Mandatory=$true)][string]$LnkPath,
          [Parameter(Mandatory=$true)][string]$AppUserModelId)
    $code = @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct AumiPkey { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Explicit)]
public struct AumiPV { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pwszVal; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAumiPropertyStore {
    int GetCount(out uint c);
    int GetAt(uint i, out AumiPkey p);
    int GetValue(ref AumiPkey k, out AumiPV pv);
    int SetValue(ref AumiPkey k, ref AumiPV pv);
    int Commit();
}
[ComImport, Guid("0000010c-0000-0000-c000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAumiPersist { int GetClassID(out Guid g); }
[ComImport, Guid("0000010B-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAumiPersistFile : IAumiPersist {
    new int GetClassID(out Guid g);
    int IsDirty();
    [PreserveSig] int Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint dwMode);
    [PreserveSig] int Save([MarshalAs(UnmanagedType.LPWStr)] string f, [MarshalAs(UnmanagedType.Bool)] bool fRemember);
    [PreserveSig] int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f);
    [PreserveSig] int GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f);
}
public static class AumiSetter {
    [DllImport("ole32.dll")]
    public static extern int CoCreateInstance(ref Guid rclsid, IntPtr u, uint ctx, ref Guid riid, out IntPtr ppv);
    [DllImport("ole32.dll")] public static extern void CoTaskMemFree(IntPtr p);
    public static int Apply(string lnk, string aumi) {
        Guid clsid = new Guid("00021401-0000-0000-C000-000000000046");
        Guid iidpf = new Guid("0000010B-0000-0000-C000-000000000046");
        IntPtr pUnk;
        int hr = CoCreateInstance(ref clsid, IntPtr.Zero, 1, ref iidpf, out pUnk);
        if (hr != 0) return hr;
        IAumiPersistFile pf = (IAumiPersistFile)Marshal.GetObjectForIUnknown(pUnk);
        Marshal.Release(pUnk);
        hr = pf.Load(lnk, 2);  // STGM_READWRITE
        if (hr != 0) return hr;
        IAumiPropertyStore ps = (IAumiPropertyStore)pf;
        AumiPkey k; k.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); k.pid = 5;
        AumiPV v; v.vt = 31; v.pwszVal = Marshal.StringToCoTaskMemUni(aumi);
        hr = ps.SetValue(ref k, ref v);
        if (hr == 0) ps.Commit();
        CoTaskMemFree(v.pwszVal);
        if (hr != 0) return hr;
        return pf.Save(lnk, true);
    }
}
'@
    if (-not ('AumiSetter' -as [type])) {
        Add-Type -TypeDefinition $code -Language CSharp | Out-Null
    }
    $hr = [AumiSetter]::Apply($LnkPath, $AppUserModelId)
    if ($hr -ne 0) {
        Write-Warning ("    System.AppUserModel.ID not set on {0} (hr=0x{1:X8}); taskbar grouping may fall back to the process AUMI." -f $LnkPath, $hr)
    } else {
        Write-Host ("    -> tagged System.AppUserModel.ID = {0}" -f $AppUserModelId)
    }
}

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
    Set-ShortcutAppUserModelId -LnkPath $desktopLink -AppUserModelId $AppUserModelId
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
    Set-ShortcutAppUserModelId -LnkPath $startLink -AppUserModelId $AppUserModelId
} else {
    Write-Host "`n[4/4] Skipping Start Menu entry (--NoStartMenu)"
}

Write-Host "`nInstalled. Launch from:"
Write-Host "  - Desktop:    'Open 2D Viewer'"
Write-Host "  - Start Menu: 'Open 2D Viewer'"
Write-Host "  - CLI:        $InstalledBin"
Write-Host "`nThe existing Open 2D Studio install (if any) is unchanged."
