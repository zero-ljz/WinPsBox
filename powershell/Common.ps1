# ----------------- Native Restart Manager for File Lock Finder -----------------
try {
    $rmSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class RestartManagerWrapper
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RM_UNIQUE_PROCESS
    {
        public int dwProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct RM_PROCESS_INFO
    {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string strServiceShortName;
        public int ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

    [DllImport("rstrtmgr.dll")]
    public static extern int RmEndSession(uint pSessionHandle);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames,
                                                uint nApplications, RM_UNIQUE_PROCESS[] rgApplications,
                                                uint nServices, string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll")]
    public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded,
                                      ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps,
                                      ref uint lpdwRebootReasons);

    public static int[] FindLockingProcesses(string path)
    {
        uint handle;
        string key = Guid.NewGuid().ToString();
        List<int> processes = new List<int>();

        if (RmStartSession(out handle, 0, key) != 0) return processes.ToArray();

        try
        {
            string[] resources = new string[] { path };
            if (RmRegisterResources(handle, (uint)resources.Length, resources, 0, null, 0, null) != 0) return processes.ToArray();

            uint pnProcInfoNeeded = 0;
            uint pnProcInfo = 0;
            uint lpdwRebootReasons = 0;

            int res = RmGetList(handle, out pnProcInfoNeeded, ref pnProcInfo, null, ref lpdwRebootReasons);
            if (res == 234 && pnProcInfoNeeded > 0)
            {
                RM_PROCESS_INFO[] processInfo = new RM_PROCESS_INFO[pnProcInfoNeeded];
                pnProcInfo = pnProcInfoNeeded;
                res = RmGetList(handle, out pnProcInfoNeeded, ref pnProcInfo, processInfo, ref lpdwRebootReasons);
                if (res == 0)
                {
                    for (int i = 0; i < pnProcInfo; i++)
                    {
                        processes.Add(processInfo[i].Process.dwProcessId);
                    }
                }
            }
        }
        finally
        {
            RmEndSession(handle);
        }

        return processes.ToArray();
    }
}
'@
    Add-Type -TypeDefinition $rmSource -ErrorAction SilentlyContinue
} catch { }

# ----------------- Helper Functions -----------------
$AppName = "PwshToolboxApp"
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$script:hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"

function Write-AppTaskProgress([int]$percent, [string]$message, [string]$detail = "") {
    if ($script:AppTaskProgressWriter) {
        & $script:AppTaskProgressWriter ([math]::Min(100, [math]::Max(0, $percent))) $message $detail
    }
}

function Get-AutoStartCommand {
    $batPath = Join-Path $script:AppRoot "WinPsBox.bat"
    if (-not (Test-Path -LiteralPath $batPath -PathType Leaf)) {
        throw "WinPsBox.bat was not found at the application root."
    }
    $batPath = (Resolve-Path -LiteralPath $batPath).Path
    return "`"$batPath`" --StartMinimized"
}

function Get-AutoStartStatus {
    try {
        $val = Get-ItemProperty -Path $RunKey -Name $AppName -ErrorAction SilentlyContinue
        if ($null -eq $val -or [string]::IsNullOrWhiteSpace([string]$val.$AppName)) { return $false }

        # Repair entries created before start.bat was renamed to WinPsBox.bat.
        $expectedCommand = Get-AutoStartCommand
        if ([string]$val.$AppName -ne $expectedCommand) {
            Set-ItemProperty -Path $RunKey -Name $AppName -Value $expectedCommand -Force | Out-Null
        }
        return $true
    }
    catch {
        return $false
    }
}

function Set-AutoStartStatus([bool]$enable) {
    try {
        if ($enable) {
            $cmd = Get-AutoStartCommand
            Set-ItemProperty -Path $RunKey -Name $AppName -Value $cmd -Force | Out-Null
            return @{ success = $true; enabled = $true; message = "Auto-start enabled" }
        }
        else {
            Remove-ItemProperty -Path $RunKey -Name $AppName -ErrorAction SilentlyContinue | Out-Null
            return @{ success = $true; enabled = $false; message = "Auto-start disabled" }
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-AppConfig {
    $backupFile = "$configFile.bak"
    foreach ($candidate in @($configFile, $backupFile)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $raw = [System.IO.File]::ReadAllText($candidate, [System.Text.Encoding]::UTF8)
            $config = ConvertFrom-Json $raw -ErrorAction Stop
            if ($candidate -eq $backupFile) {
                [void](Save-AppConfig -configObj $config)
            }
            return $config
        }
        catch { }
    }
    return [PSCustomObject]@{
        theme = "system"
        autoStart = (Get-AutoStartStatus)
        minimizeToTray = $true
        favorites = @()
    }
}

function Save-AppConfig($configObj) {
    $tempFile = $null
    $replaceBackupFile = $null
    try {
        $configDirectory = Split-Path -Parent $configFile
        [System.IO.Directory]::CreateDirectory($configDirectory) | Out-Null
        $json = ConvertTo-Json -InputObject $configObj -Depth 10
        [void](ConvertFrom-Json $json -ErrorAction Stop)

        $tempFile = Join-Path $configDirectory (([System.IO.Path]::GetFileName($configFile)) + "." + [Guid]::NewGuid().ToString("N") + ".tmp")
        [System.IO.File]::WriteAllText($tempFile, $json, (New-Object System.Text.UTF8Encoding($true)))

        $backupFile = "$configFile.bak"
        if (Test-Path -LiteralPath $configFile -PathType Leaf) {
            $currentIsValid = $false
            try {
                $currentJson = [System.IO.File]::ReadAllText($configFile, [System.Text.Encoding]::UTF8)
                [void](ConvertFrom-Json $currentJson -ErrorAction Stop)
                $currentIsValid = $true
            }
            catch { }
            $replaceBackupFile = if ($currentIsValid) { $backupFile } else { "$tempFile.replaced" }
            [System.IO.File]::Replace($tempFile, $configFile, $replaceBackupFile, $true)
            if (-not $currentIsValid -and (Test-Path -LiteralPath $replaceBackupFile)) {
                Remove-Item -LiteralPath $replaceBackupFile -Force -ErrorAction SilentlyContinue
            }
            $replaceBackupFile = $null
        }
        else {
            [System.IO.File]::Move($tempFile, $configFile)
        }
        $tempFile = $null
        return @{ success = $true }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
    finally {
        if ($tempFile -and (Test-Path -LiteralPath $tempFile)) {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        }
        if ($replaceBackupFile -and $replaceBackupFile -ne "$configFile.bak" -and (Test-Path -LiteralPath $replaceBackupFile)) {
            Remove-Item -LiteralPath $replaceBackupFile -Force -ErrorAction SilentlyContinue
        }
    }
}
