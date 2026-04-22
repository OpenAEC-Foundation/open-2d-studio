$sig = @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h2, bool r);
'@
try {
    $type = Add-Type -MemberDefinition $sig -Namespace Win32Api -Name Native -PassThru -IgnoreWarnings -ErrorAction Stop
} catch {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($name in 'split_compare','dxf_mockup','mockup_2d','dwg_mockup','animated','dxf_viewer','viewer_2d') {
        $p = Get-Process $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($p) { $shell.AppActivate($p.Id) | Out-Null; return }
    }
    return
}
foreach ($name in 'split_compare','dxf_mockup','mockup_2d','dwg_mockup','animated','dxf_viewer','viewer_2d') {
    $p = Get-Process $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($p) {
        Write-Host "PID: $($p.Id), Title: $($p.MainWindowTitle)"
        [Win32Api.Native]::MoveWindow($p.MainWindowHandle, 100, 50, 1800, 950, $true) | Out-Null
        [Win32Api.Native]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
        [Win32Api.Native]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
        Write-Host "Window focused"
        return
    }
}
Write-Host "No viewer process found"
