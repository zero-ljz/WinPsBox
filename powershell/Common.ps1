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
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"

function Get-AutoStartStatus {
    try {
        $val = Get-ItemProperty -Path $RunKey -Name $AppName -ErrorAction SilentlyContinue
        return ($null -ne $val -and $null -ne $val.$AppName)
    }
    catch {
        return $false
    }
}

function Set-AutoStartStatus([bool]$enable) {
    try {
        if ($enable) {
            $batPath = Join-Path $script:AppRoot "start.bat"
            if (Test-Path $batPath) {
                $batPath = (Resolve-Path $batPath).Path
            }
            $cmd = "`"$batPath`" --StartMinimized"
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
    if (Test-Path $configFile) {
        try {
            $raw = Get-Content -Path $configFile -Raw -Encoding UTF8
            return (ConvertFrom-Json $raw)
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
    try {
        $json = ConvertTo-Json -InputObject $configObj -Depth 10
        [System.IO.File]::WriteAllText($configFile, $json, [System.Text.Encoding]::UTF8)
        return @{ success = $true }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}
