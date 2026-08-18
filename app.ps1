Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$libPath = Join-Path $PSScriptRoot "lib"
$dataPath = Join-Path $PSScriptRoot "data"
$configFile = Join-Path $dataPath "config.json"
$userDataPath = Join-Path $dataPath "WebView2Data"

[System.IO.Directory]::CreateDirectory($dataPath) | Out-Null
[System.IO.Directory]::CreateDirectory($userDataPath) | Out-Null

# Make the native WebView2 loader visible to the WinForms control.
$env:PATH = $libPath + [System.IO.Path]::PathSeparator + $env:PATH

Add-Type -Path (Join-Path $libPath "Microsoft.Web.WebView2.Core.dll")
Add-Type -Path (Join-Path $libPath "Microsoft.Web.WebView2.WinForms.dll")

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
            $batPath = Join-Path $PSScriptRoot "start.bat"
            if (Test-Path $batPath) {
                $batPath = (Resolve-Path $batPath).Path
            }
            $cmd = "`"$batPath`""
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

# ----------------- Network Functions (Base) -----------------
function Get-LocalPortList {
    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $procMap = @{}
        Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $procMap[$_.Id] = $_.ProcessName }

        $tcpConns = Get-NetTCPConnection -ErrorAction SilentlyContinue
        if ($tcpConns) {
            foreach ($c in $tcpConns) {
                $pName = if ($procMap.ContainsKey($c.OwningProcess)) { $procMap[$c.OwningProcess] } else { "System/Unknown" }
                $results.Add([PSCustomObject]@{
                    protocol = "TCP"
                    localAddress = $c.LocalAddress
                    localPort = $c.LocalPort
                    remoteAddress = $c.RemoteAddress
                    remotePort = $c.RemotePort
                    state = $c.State.ToString()
                    pid = $c.OwningProcess
                    processName = $pName
                })
            }
        }
        $udpConns = Get-NetUDPEndpoint -ErrorAction SilentlyContinue
        if ($udpConns) {
            foreach ($u in $udpConns) {
                $pName = if ($procMap.ContainsKey($u.OwningProcess)) { $procMap[$u.OwningProcess] } else { "System/Unknown" }
                $results.Add([PSCustomObject]@{
                    protocol = "UDP"
                    localAddress = $u.LocalAddress
                    localPort = $u.LocalPort
                    remoteAddress = "*"
                    remotePort = "*"
                    state = "Listening"
                    pid = $u.OwningProcess
                    processName = $pName
                })
            }
        }
    }
    catch { }
    return $results
}

function Test-RemotePorts($hostName, $ports, [int]$timeoutMs = 1200) {
    $portList = [System.Collections.Generic.List[int]]::new()
    foreach ($p in $ports) {
        if ($p -is [int]) {
            if ($p -gt 0 -and $p -le 65535) { $portList.Add($p) }
        }
        elseif ($p -is [string]) {
            $pStr = [string]$p
            if ($pStr -match '^(\d+)[-~](\d+)$') {
                $start = [int]$matches[1]
                $end = [int]$matches[2]
                $minP = [math]::Min($start, $end)
                $maxP = [math]::Max($start, $end)
                for ($k = $minP; $k -le $maxP; $k++) {
                    if ($k -gt 0 -and $k -le 65535) { $portList.Add($k) }
                }
            }
            else {
                $pNum = 0
                if ([int]::TryParse($pStr, [ref]$pNum)) {
                    if ($pNum -gt 0 -and $pNum -le 65535) { $portList.Add($pNum) }
                }
            }
        }
    }

    $uniquePorts = ($portList | Select-Object -Unique | Sort-Object)
    if ($uniquePorts.Count -gt 5000) {
        $uniquePorts = $uniquePorts[0..4999]
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    $batchSize = 250

    for ($b = 0; $b -lt $uniquePorts.Count; $b += $batchSize) {
        $batchCount = [math]::Min($batchSize, $uniquePorts.Count - $b)
        $batch = $uniquePorts[$b..($b + $batchCount - 1)]

        $tasks = [System.Collections.Generic.List[hashtable]]::new()
        foreach ($portNum in $batch) {
            $client = New-Object System.Net.Sockets.TcpClient
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            try {
                $iar = $client.BeginConnect($hostName, $portNum, $null, $null)
                $tasks.Add(@{
                    port = $portNum
                    client = $client
                    iar = $iar
                    sw = $sw
                    initError = $null
                })
            }
            catch {
                $sw.Stop()
                $tasks.Add(@{
                    port = $portNum
                    client = $client
                    iar = $null
                    sw = $sw
                    initError = $_.Exception.Message
                })
            }
        }

        $deadline = [System.DateTime]::UtcNow.AddMilliseconds($timeoutMs)
        while ([System.DateTime]::UtcNow -lt $deadline) {
            $allDone = $true
            foreach ($t in $tasks) {
                if ($t.iar -and -not $t.iar.IsCompleted) {
                    $allDone = $false
                    break
                }
            }
            if ($allDone) { break }
            Start-Sleep -Milliseconds 15
        }

        foreach ($t in $tasks) {
            $isOpen = $false
            $err = $t.initError
            $client = $t.client
            $iar = $t.iar
            $sw = $t.sw
            $sw.Stop()

            if ($iar) {
                try {
                    if ($iar.IsCompleted -and $client.Connected) {
                        $client.EndConnect($iar)
                        $isOpen = $true
                    } else {
                        $err = "Connection timed out"
                    }
                }
                catch {
                    $err = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
                }
                finally {
                    $client.Close()
                }
            }

            $results.Add([PSCustomObject]@{
                port = $t.port
                isOpen = $isOpen
                latencyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
                error = $err
            })
        }
    }

    return $results
}

function Test-PingAndDns($targetHost, [int]$count = 4, [int]$timeoutMs = 2000) {
    $dnsIps = @()
    try {
        $entry = [System.Net.Dns]::GetHostAddresses($targetHost)
        foreach ($ip in $entry) {
            $dnsIps += $ip.IPAddressToString
        }
    }
    catch { }

    $ping = New-Object System.Net.NetworkInformation.Ping
    $records = [System.Collections.Generic.List[PSCustomObject]]::new()
    $times = [System.Collections.Generic.List[long]]::new()
    $received = 0

    for ($i = 1; $i -le $count; $i++) {
        try {
            $reply = $ping.Send($targetHost, $timeoutMs)
            if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                $received++
                $times.Add($reply.RoundtripTime)
                $records.Add([PSCustomObject]@{
                    seq = $i
                    ip = $reply.Address.ToString()
                    timeMs = $reply.RoundtripTime
                    ttl = if ($reply.Options) { $reply.Options.Ttl } else { 0 }
                    status = "Success"
                })
            } else {
                $records.Add([PSCustomObject]@{
                    seq = $i
                    ip = "-"
                    timeMs = 0
                    ttl = 0
                    status = $reply.Status.ToString()
                })
            }
        }
        catch {
            $records.Add([PSCustomObject]@{
                seq = $i
                ip = "-"
                timeMs = 0
                ttl = 0
                status = $_.Exception.Message
            })
        }
        if ($i -lt $count) { Start-Sleep -Milliseconds 150 }
    }

    $lossRate = if ($count -gt 0) { [math]::Round((($count - $received) / $count) * 100, 1) } else { 0 }
    $minTime = if ($times.Count -gt 0) { ($times | Measure-Object -Minimum).Minimum } else { 0 }
    $maxTime = if ($times.Count -gt 0) { ($times | Measure-Object -Maximum).Maximum } else { 0 }
    $avgTime = if ($times.Count -gt 0) { [math]::Round(($times | Measure-Object -Average).Average, 1) } else { 0 }

    return [PSCustomObject]@{
        target = $targetHost
        dnsIps = $dnsIps
        sent = $count
        received = $received
        lossRate = $lossRate
        minTime = $minTime
        maxTime = $maxTime
        avgTime = $avgTime
        records = $records
    }
}

function Invoke-CustomHttpRequest($method, $url, $headers, $body, [int]$timeoutSec = 15) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls11 -bor [System.Net.SecurityProtocolType]::Tls

        $headerDict = @{}
        $contentType = $null
        $userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        if ($headers) {
            foreach ($k in $headers.psobject.properties.name) {
                if ($k -ieq 'content-type') {
                    $contentType = [string]$headers.$k
                } elseif ($k -ieq 'user-agent') {
                    $userAgent = [string]$headers.$k
                } else {
                    $headerDict[$k] = [string]$headers.$k
                }
            }
        }

        $params = @{
            Method = $method
            Uri = $url
            UseBasicParsing = $true
            TimeoutSec = $timeoutSec
            UserAgent = $userAgent
            ErrorAction = 'Stop'
        }
        if ($headerDict.Count -gt 0) { $params['Headers'] = $headerDict }
        if ($contentType) { $params['ContentType'] = $contentType }
        if ($body -and ($method -eq 'POST' -or $method -eq 'PUT' -or $method -eq 'PATCH' -or $method -eq 'DELETE')) {
            $params['Body'] = $body
        }

        $resp = Invoke-WebRequest @params
        $sw.Stop()

        $respHeaders = @{}
        if ($resp.Headers) {
            foreach ($h in $resp.Headers.Keys) {
                $respHeaders[$h] = ($resp.Headers[$h] -join ", ")
            }
        }

        return @{
            success = $true
            statusCode = [int]$resp.StatusCode
            statusText = [string]$resp.StatusDescription
            headers = $respHeaders
            body = [string]$resp.Content
            timeMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
            sizeBytes = if ($resp.RawContentLength -ge 0) { $resp.RawContentLength } else { $resp.Content.Length }
        }
    }
    catch {
        $sw.Stop()
        $statusCode = 0
        $statusText = "Request Failed"
        $body = ""
        $respHeaders = @{}

        if ($_.Exception.Response) {
            $resp = $_.Exception.Response
            $statusCode = [int]$resp.StatusCode
            $statusText = [string]$resp.StatusDescription
            if ($resp.Headers) {
                foreach ($h in $resp.Headers.Keys) {
                    $respHeaders[$h] = ($resp.Headers[$h] -join ", ")
                }
            }
            try {
                $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                $reader.Close()
            } catch { }
        } else {
            $body = $_.Exception.Message
        }

        return @{
            success = ($statusCode -gt 0)
            statusCode = $statusCode
            statusText = if ($statusCode -gt 0) { $statusText } else { $_.Exception.Message }
            headers = $respHeaders
            body = $body
            timeMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
            sizeBytes = $body.Length
            error = $_.Exception.Message
        }
    }
}

# ----------------- 1. NetAdapter & DNS Functions -----------------
function Get-NetAdapterAndDns {
    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $adapters = Get-NetAdapter -ErrorAction SilentlyContinue
        $ipAddrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue
        $dnsServers = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue
        $routes = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue

        foreach ($a in $adapters) {
            $alias = $a.InterfaceAlias
            $idx = $a.InterfaceIndex
            
            $ips = @()
            $prefixLens = @()
            foreach ($ip in ($ipAddrs | Where-Object { $_.InterfaceIndex -eq $idx })) {
                $ips += $ip.IPAddress
                $prefixLens += $ip.PrefixLength
            }

            $dns = @()
            foreach ($d in ($dnsServers | Where-Object { $_.InterfaceIndex -eq $idx })) {
                if ($d.ServerAddresses) {
                    $dns += $d.ServerAddresses
                }
            }

            $gw = ""
            $defaultRoute = $routes | Where-Object { $_.InterfaceIndex -eq $idx } | Select-Object -First 1
            if ($defaultRoute) { $gw = $defaultRoute.NextHop }

            $dhcp = $false
            try {
                $ipIf = Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue
                if ($ipIf) { $dhcp = ($ipIf.Dhcp -eq 'Enabled') }
            } catch { }

            $results.Add([PSCustomObject]@{
                name = $a.Name
                interfaceAlias = $alias
                interfaceIndex = $idx
                status = $a.Status.ToString()
                macAddress = $a.MacAddress
                linkSpeed = $a.LinkSpeed
                ipAddresses = $ips
                prefixLengths = $prefixLens
                dnsServers = $dns
                gateway = $gw
                dhcpEnabled = $dhcp
                isPhysical = ($a.HardwareInterface -eq $true)
            })
        }
    }
    catch { }
    return $results
}

function Set-NetAdapterDnsConfig([string]$interfaceAlias, [string[]]$dnsServers, [bool]$isDhcp = $false) {
    try {
        if ($isDhcp -or -not $dnsServers -or $dnsServers.Count -eq 0) {
            Set-DnsClientServerAddress -InterfaceAlias $interfaceAlias -ResetServerAddresses -ErrorAction Stop
            return @{ success = $true; message = "已将 DNS 恢复为 DHCP 自动获取" }
        } else {
            Set-DnsClientServerAddress -InterfaceAlias $interfaceAlias -ServerAddresses $dnsServers -ErrorAction Stop
            return @{ success = $true; message = "已成功设置 DNS" }
        }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $cmd = if ($isDhcp) {
                "Set-DnsClientServerAddress -InterfaceAlias '$interfaceAlias' -ResetServerAddresses -ErrorAction Stop"
            } else {
                $dnsStr = ($dnsServers | ForEach-Object { "'$_'" }) -join ","
                "Set-DnsClientServerAddress -InterfaceAlias '$interfaceAlias' -ServerAddresses @($dnsStr) -ErrorAction Stop"
            }
            $elevated = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevated.success) {
                return @{ success = $true; message = "已通过管理员权限成功设置 DNS" }
            } else {
                return @{ success = $false; error = $elevated.error }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Set-NetAdapterIpConfig([string]$interfaceAlias, [bool]$isDhcp, [string]$ip = "", [int]$prefixLength = 24, [string]$gateway = "") {
    try {
        if ($isDhcp) {
            Set-NetIPInterface -InterfaceAlias $interfaceAlias -Dhcp Enabled -ErrorAction Stop
            Get-NetIPAddress -InterfaceAlias $interfaceAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.PrefixOrigin -eq 'Manual' } | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
            return @{ success = $true; message = "已设置为 DHCP 自动获取 IP" }
        } else {
            Set-NetIPInterface -InterfaceAlias $interfaceAlias -Dhcp Disabled -ErrorAction Stop
            Get-NetIPAddress -InterfaceAlias $interfaceAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
            if ($gateway) {
                New-NetIPAddress -InterfaceAlias $interfaceAlias -IPAddress $ip -PrefixLength $prefixLength -DefaultGateway $gateway -ErrorAction Stop | Out-Null
            } else {
                New-NetIPAddress -InterfaceAlias $interfaceAlias -IPAddress $ip -PrefixLength $prefixLength -ErrorAction Stop | Out-Null
            }
            return @{ success = $true; message = "已成功设置静态 IP" }
        }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $cmd = if ($isDhcp) {
                "Set-NetIPInterface -InterfaceAlias '$interfaceAlias' -Dhcp Enabled -ErrorAction Stop; Get-NetIPAddress -InterfaceAlias '$interfaceAlias' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { `$_.PrefixOrigin -eq 'Manual' } | Remove-NetIPAddress -Confirm:`$false -ErrorAction SilentlyContinue"
            } else {
                "Set-NetIPInterface -InterfaceAlias '$interfaceAlias' -Dhcp Disabled -ErrorAction Stop; Get-NetIPAddress -InterfaceAlias '$interfaceAlias' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:`$false -ErrorAction SilentlyContinue; New-NetIPAddress -InterfaceAlias '$interfaceAlias' -IPAddress '$ip' -PrefixLength $prefixLength -DefaultGateway '$gateway' -ErrorAction Stop"
            }
            $elevated = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevated.success) {
                return @{ success = $true; message = "已通过管理员权限成功更新 IP 设置" }
            } else {
                return @{ success = $false; error = $elevated.error }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Invoke-FlushDnsAndWinsock {
    try {
        Clear-DnsClientCache -ErrorAction SilentlyContinue
        Start-Process "ipconfig.exe" -ArgumentList "/flushdns" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue
        return @{ success = $true; message = "DNS 解析缓存已成功刷新并重置。" }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 2. LAN Scanner Functions -----------------
function Invoke-LanScanner([string]$subnetBase = "") {
    try {
        if (-not $subnetBase) {
            $localIpObj = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254*" -and $_.InterfaceAlias -notlike "*vEthernet*" -and $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*tun*" } | Select-Object -First 1
            if (-not $localIpObj) {
                $localIpObj = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1
            }
            if ($localIpObj) {
                $parts = $localIpObj.IPAddress.Split('.')
                $subnetBase = "$($parts[0]).$($parts[1]).$($parts[2])"
            } else {
                $subnetBase = "192.168.1"
            }
        }

        $localIps = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress

        # 1. High-speed Ping sweep to warm up ARP neighbor cache
        $pingTasks = [System.Collections.Generic.List[hashtable]]::new()
        for ($i = 1; $i -le 254; $i++) {
            $targetIp = "$subnetBase.$i"
            $p = New-Object System.Net.NetworkInformation.Ping
            try {
                $iar = $p.SendPingAsync($targetIp, 250)
                $pingTasks.Add(@{ ip = $targetIp; task = $iar; pinger = $p })
            } catch { }
        }

        $deadline = [DateTime]::UtcNow.AddMilliseconds(1200)
        while ([DateTime]::UtcNow -lt $deadline) {
            $allDone = $true
            foreach ($t in $pingTasks) {
                if (-not $t.task.IsCompleted) { $allDone = $false; break }
            }
            if ($allDone) { break }
            Start-Sleep -Milliseconds 20
        }

        # 2. Extract valid ARP entries from Neighbor Cache (Filter out Unreachable and 00-00-00 MACs)
        $arpMap = @{}
        try {
            Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
                $_.IPAddress -like "$subnetBase.*" -and
                $_.State -in @('Reachable', 'Stale', 'Delay', 'Probe', 'Permanent') -and
                $_.LinkLayerAddress -and
                $_.LinkLayerAddress -ne '00-00-00-00-00-00' -and
                $_.LinkLayerAddress -ne '00:00:00:00:00:00' -and
                $_.LinkLayerAddress -notlike 'FF-FF*' -and
                $_.LinkLayerAddress -notlike '01-00-5E*'
            } | ForEach-Object {
                $arpMap[$_.IPAddress] = $_.LinkLayerAddress.ToUpper().Replace(':', '-')
            }
        } catch { }

        try {
            $arpOut = arp -a
            foreach ($line in ($arpOut -split "`r?`n")) {
                if ($line -match '([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\s+([0-9a-fA-F\-]{17})') {
                    $foundIp = $matches[1]
                    $foundMac = $matches[2].ToUpper()
                    if ($foundIp -like "$subnetBase.*" -and $foundMac -ne '00-00-00-00-00-00' -and $foundMac -notlike 'FF-FF*' -and $foundMac -notlike '01-00-5E*') {
                        if (-not $arpMap.ContainsKey($foundIp)) {
                            $arpMap[$foundIp] = $foundMac
                        }
                    }
                }
            }
        } catch { }

        # 3. Identify truly active devices
        $discoveredIps = [System.Collections.Generic.List[string]]::new()
        for ($i = 1; $i -le 254; $i++) {
            $targetIp = "$subnetBase.$i"
            $isLocal = ($localIps -contains $targetIp)
            $hasMac = $arpMap.ContainsKey($targetIp)
            if ($hasMac -or $isLocal) {
                $discoveredIps.Add($targetIp)
            }
        }

        # 4. Async Hostname Resolution (non-blocking, max 250ms)
        $hostTasks = @{}
        foreach ($ip in $discoveredIps) {
            try {
                $hostTasks[$ip] = [System.Net.Dns]::GetHostEntryAsync($ip)
            } catch { }
        }
        $dnsDeadline = [DateTime]::UtcNow.AddMilliseconds(250)
        while ([DateTime]::UtcNow -lt $dnsDeadline) {
            $allDone = $true
            foreach ($t in $hostTasks.Values) {
                if (-not $t.IsCompleted) { $allDone = $false; break }
            }
            if ($allDone) { break }
            Start-Sleep -Milliseconds 20
        }

        $ouiMap = @{
            "00-0C-29" = "VMware"; "00-50-56" = "VMware"; "00-1C-42" = "Parallels"; "08-00-27" = "VirtualBox"
            "00-15-5D" = "Microsoft Hyper-V"; "B8-27-EB" = "Raspberry Pi"; "DC-A6-32" = "Raspberry Pi"
            "E4-5F-01" = "Raspberry Pi"; "24-4B-FE" = "Espressif (ESP32)"; "84-F3-EB" = "Espressif"
            "F0-18-98" = "Apple"; "AC-DE-48" = "Apple"; "3C-22-FB" = "Apple"; "40-6C-8F" = "Apple"
            "9C-30-5B" = "Apple"; "8E-E0-89" = "Apple (Private MAC)"
            "70-85-C2" = "Huawei"; "48-46-FB" = "Huawei"; "28-6E-D4" = "Huawei"; "34-CD-6D" = "Huawei"; "E4-C7-67" = "Huawei"
            "50-D2-F5" = "Xiaomi"; "64-CC-2E" = "Xiaomi"; "7C-49-EB" = "Xiaomi"; "8C-BE-BE" = "Xiaomi"; "60-7E-A4" = "Xiaomi"
            "00-E0-4C" = "Realtek"; "B4-2E-99" = "Intel"; "54-EE-75" = "Intel"; "F4-4D-30" = "Intel"; "9C-8E-99" = "Intel"
            "50-3E-AA" = "TP-Link"; "E8-48-B8" = "TP-Link"; "98-48-27" = "TP-Link"; "70-4F-57" = "TP-Link"; "1C-67-4A" = "TP-Link"
            "D8-0D-17" = "TP-Link"; "00-1D-0F" = "TP-Link"; "30-B5-C2" = "TP-Link"; "EC-17-2F" = "ASUS"
            "20-79-18" = "ASUS"; "00-1A-2B" = "Cisco"; "00-24-14" = "Cisco"; "18-66-DA" = "Dell"
            "54-48-10" = "Lenovo"; "B0-25-AA" = "H3C"; "00-0F-E2" = "H3C"
        }

        $devices = [System.Collections.Generic.List[PSCustomObject]]::new()
        foreach ($targetIp in $discoveredIps) {
            $isLocal = ($localIps -contains $targetIp)
            $hasMac = $arpMap.ContainsKey($targetIp)

            $mac = if ($hasMac) { $arpMap[$targetIp] } else { "Localhost" }
            $vendor = "未知厂商"
            if ($mac -and $mac.Length -ge 8) {
                $prefix = $mac.Substring(0, 8)
                if ($ouiMap.ContainsKey($prefix)) { $vendor = $ouiMap[$prefix] }
            }
            if ($isLocal) { $vendor = "本机设备" }

            $hostName = ""
            if ($hostTasks.ContainsKey($targetIp) -and $hostTasks[$targetIp].IsCompleted -and $hostTasks[$targetIp].Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {
                try { $hostName = $hostTasks[$targetIp].Result.HostName } catch { }
            }

            $devices.Add([PSCustomObject]@{
                ip = $targetIp
                mac = $mac
                hostName = $hostName
                vendor = $vendor
                latencyMs = 1
                isLocal = $isLocal
                status = "Online"
            })
        }

        return @{
            success = $true
            subnet = $subnetBase
            totalScanned = 254
            foundCount = $devices.Count
            devices = $devices
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 3. SSL/TLS Inspector Functions -----------------
function Get-SslCertificateDetails([string]$hostName, [int]$port = 443, [int]$timeoutMs = 5000) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($hostName, $port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs, $false)) {
            $client.Close()
            return @{ success = $false; error = "连接目标主机超时" }
        }
        $client.EndConnect($iar)

        $sslStream = New-Object System.Net.Security.SslStream(
            $client.GetStream(),
            $false,
            ({ param($sender, $cert, $chain, $errors) return $true }),
            $null
        )
        $sslStream.ReadTimeout = $timeoutMs
        $sslStream.WriteTimeout = $timeoutMs

        $sslStream.AuthenticateAsClient($hostName)

        $remoteCert = $sslStream.RemoteCertificate
        if (-not $remoteCert) {
            $sslStream.Close()
            $client.Close()
            return @{ success = $false; error = "未获取到远程服务器证书" }
        }

        $x509 = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($remoteCert)
        $chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
        $chain.Build($x509) | Out-Null

        $sans = @()
        foreach ($ext in $x509.Extensions) {
            if ($ext.Oid.FriendlyName -eq "Subject Alternative Name" -or $ext.Oid.Value -eq "2.5.29.17") {
                $sans = ($ext.Format($false) -split ',\s*' | ForEach-Object { $_.Trim().Replace("DNS Name=", "") })
            }
        }

        $chainList = @()
        foreach ($el in $chain.ChainElements) {
            $chainList += @{
                subject = $el.Certificate.Subject
                issuer = $el.Certificate.Issuer
                thumbprint = $el.Certificate.Thumbprint
                validTo = $el.Certificate.NotAfter.ToString("yyyy-MM-dd HH:mm:ss")
            }
        }

        $now = [DateTime]::Now
        $notAfter = $x509.NotAfter
        $notBefore = $x509.NotBefore
        $daysRemaining = [math]::Round(($notAfter - $now).TotalDays, 1)
        $totalDays = [math]::Round(($notAfter - $notBefore).TotalDays, 1)
        $usedDays = [math]::Round(($now - $notBefore).TotalDays, 1)
        $percentElapsed = if ($totalDays -gt 0) { [math]::Min(100, [math]::Max(0, [math]::Round(($usedDays / $totalDays) * 100, 1))) } else { 100 }

        $res = @{
            success = $true
            host = $hostName
            port = $port
            subject = $x509.Subject
            issuer = $x509.Issuer
            validFrom = $notBefore.ToString("yyyy-MM-dd HH:mm:ss")
            validTo = $notAfter.ToString("yyyy-MM-dd HH:mm:ss")
            daysRemaining = $daysRemaining
            totalDays = $totalDays
            percentElapsed = $percentElapsed
            isExpired = ($daysRemaining -le 0)
            isExpiringSoon = ($daysRemaining -gt 0 -and $daysRemaining -le 30)
            serialNumber = $x509.SerialNumber
            thumbprint = $x509.Thumbprint
            signatureAlgorithm = $x509.SignatureAlgorithm.FriendlyName
            keyAlgorithm = $x509.PublicKey.Oid.FriendlyName
            keySize = $x509.PublicKey.Key.KeySize
            protocol = $sslStream.SslProtocol.ToString()
            cipherAlgorithm = $sslStream.CipherAlgorithm.ToString()
            cipherStrength = $sslStream.CipherStrength
            sans = $sans
            chain = $chainList
        }

        $sslStream.Close()
        $client.Close()
        return $res
    }
    catch {
        try { $client.Close() } catch { }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 4. Proxy Manager Functions -----------------
function Get-SystemProxySettings {
    $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
    try {
        $props = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
        $enabled = ($props.ProxyEnable -eq 1)
        $server = if ($props.ProxyServer) { [string]$props.ProxyServer } else { "" }
        $override = if ($props.ProxyOverride) { [string]$props.ProxyOverride } else { "" }
        $pacUrl = if ($props.AutoConfigURL) { [string]$props.AutoConfigURL } else { "" }

        return @{
            success = $true
            enabled = $enabled
            server = $server
            override = $override
            pacUrl = $pacUrl
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Set-SystemProxySettings([bool]$enabled, [string]$server = "", [string]$override = "", [string]$pacUrl = "") {
    $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
    try {
        Set-ItemProperty -Path $regPath -Name "ProxyEnable" -Value ([int]$enabled) -Type DWord -Force
        if ($server) {
            Set-ItemProperty -Path $regPath -Name "ProxyServer" -Value $server -Type String -Force
        }
        if ($override) {
            Set-ItemProperty -Path $regPath -Name "ProxyOverride" -Value $override -Type String -Force
        }
        if ($pacUrl -ne "") {
            Set-ItemProperty -Path $regPath -Name "AutoConfigURL" -Value $pacUrl -Type String -Force
        } else {
            Remove-ItemProperty -Path $regPath -Name "AutoConfigURL" -ErrorAction SilentlyContinue | Out-Null
        }

        return @{
            success = $true
            enabled = $enabled
            server = $server
            override = $override
            pacUrl = $pacUrl
            message = if ($enabled) { "系统代理已开启" } else { "系统代理已关闭" }
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 5. Mini HTTP File Server Functions -----------------
$global:HttpServerInstance = $null
$global:HttpServerThread = $null
$global:HttpServerState = @{
    Running = $false
    Port = 8000
    Path = ""
    Urls = @()
}

function Start-HttpFileServer([string]$folderPath, [int]$port = 8000) {
    Stop-HttpFileServer | Out-Null
    if (-not (Test-Path $folderPath)) {
        return @{ success = $false; error = "指定路径不存在" }
    }
    $resolvedPath = (Resolve-Path $folderPath).Path
    $global:HttpServerState.Path = $resolvedPath
    $global:HttpServerState.Port = $port

    try {
        $listener = New-Object System.Net.HttpListener
        $prefix = "http://*:$port/"
        try {
            $listener.Prefixes.Add($prefix)
            $listener.Start()
        } catch {
            $listener = New-Object System.Net.HttpListener
            $prefix = "http://+:$port/"
            try {
                $listener.Prefixes.Add($prefix)
                $listener.Start()
            } catch {
                $listener = New-Object System.Net.HttpListener
                $listener.Prefixes.Add("http://localhost:$port/")
                $listener.Prefixes.Add("http://127.0.0.1:$port/")
                $listener.Start()
            }
        }

        $global:HttpServerInstance = $listener
        $global:HttpServerState.Running = $true

        $ips = @()
        try {
            Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254*" } | ForEach-Object {
                $ips += $_.IPAddress
            }
        } catch { }
        if ($ips.Count -eq 0) { $ips = @("127.0.0.1") }

        $urls = @()
        foreach ($ip in $ips) {
            $urls += "http://$($ip):$port/"
        }
        $urls += "http://127.0.0.1:$port/"
        $global:HttpServerState.Urls = ($urls | Select-Object -Unique)

        $rs = [RunspaceFactory]::CreateRunspace()
        $rs.Open()
        $rs.SessionStateProxy.SetVariable("listener", $listener)
        $rs.SessionStateProxy.SetVariable("basePath", $resolvedPath)

        $ps = [PowerShell]::Create()
        $ps.Runspace = $rs
        $null = $ps.AddScript({
            param($listener, $basePath)
            
            $mimeTypes = @{
                ".html" = "text/html; charset=utf-8"
                ".htm"  = "text/html; charset=utf-8"
                ".css"  = "text/css; charset=utf-8"
                ".js"   = "application/javascript; charset=utf-8"
                ".json" = "application/json; charset=utf-8"
                ".png"  = "image/png"
                ".jpg"  = "image/jpeg"
                ".jpeg" = "image/jpeg"
                ".gif"  = "image/gif"
                ".svg"  = "image/svg+xml"
                ".ico"  = "image/x-icon"
                ".mp4"  = "video/mp4"
                ".mp3"  = "audio/mpeg"
                ".pdf"  = "application/pdf"
                ".zip"  = "application/zip"
                ".7z"   = "application/x-7z-compressed"
                ".tar"  = "application/x-tar"
                ".gz"   = "application/gzip"
                ".txt"  = "text/plain; charset=utf-8"
                ".log"  = "text/plain; charset=utf-8"
                ".md"   = "text/plain; charset=utf-8"
                ".apk"  = "application/vnd.android.package-archive"
                ".exe"  = "application/octet-stream"
            }

            while ($listener.IsListening) {
                try {
                    $context = $listener.GetContext()
                    $req = $context.Request
                    $resp = $context.Response

                    $rawUrl = [System.Uri]::UnescapeDataString($req.RawUrl)
                    $subPath = $rawUrl.TrimStart('/').Replace('/', '\')
                    
                    $targetPath = if ([System.IO.File]::Exists($basePath)) {
                        $basePath
                    } else {
                        [System.IO.Path]::Combine($basePath, $subPath)
                    }

                    if ([System.IO.File]::Exists($targetPath)) {
                        $ext = [System.IO.Path]::GetExtension($targetPath).ToLower()
                        $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
                        $bytes = [System.IO.File]::ReadAllBytes($targetPath)
                        $fileName = [System.IO.Path]::GetFileName($targetPath)

                        $resp.ContentType = $contentType
                        $resp.ContentLength64 = $bytes.Length
                        $resp.AddHeader("Content-Disposition", "inline; filename=`"$fileName`"")
                        $resp.AddHeader("Access-Control-Allow-Origin", "*")
                        $resp.OutputStream.Write($bytes, 0, $bytes.Length)
                        $resp.Close()
                    }
                    elseif ([System.IO.Directory]::Exists($targetPath)) {
                        $files = [System.IO.Directory]::GetFileSystemEntries($targetPath)
                        $sb = [System.Text.StringBuilder]::new()
                        $sb.AppendLine("<!DOCTYPE html><html><head><meta charset='utf-8'><title>LAN File Share</title>")
                        $sb.AppendLine("<meta name='viewport' content='width=device-width, initial-scale=1'>")
                        $sb.AppendLine("<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;background:#f8fafc;color:#1e293b;}h1{font-size:20px;margin-bottom:8px;}ul{list-style:none;padding:0;}li{padding:12px 16px;background:#fff;margin-bottom:8px;border-radius:10px;border:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;}a{color:#4f46e5;text-decoration:none;font-weight:500;word-break:break-all;}a:hover{text-decoration:underline;}.size{color:#64748b;font-size:13px;white-space:nowrap;margin-left:12px;}</style></head><body>")
                        $sb.AppendLine("<h1>📁 局域网文件共享</h1><p style='color:#64748b;margin-bottom:16px;font-size:14px;'>共享路径: $([System.Web.HttpUtility]::HtmlEncode($subPath))</p><ul>")
                        
                        if ($subPath -ne "") {
                            $parent = [System.IO.Path]::GetDirectoryName($subPath.TrimEnd('\'))
                            $parentUrl = if ($parent) { "/" + $parent.Replace('\', '/') } else { "/" }
                            $sb.AppendLine("<li><a href='$parentUrl'>⬅️ 返回上级目录</a><span class='size'>-</span></li>")
                        }

                        foreach ($item in $files) {
                            $itemName = [System.IO.Path]::GetFileName($item)
                            $itemRel = if ($subPath) { "$subPath/$itemName" } else { $itemName }
                            $itemUrl = "/" + $itemRel.Replace('\', '/')
                            if ([System.IO.Directory]::Exists($item)) {
                                $sb.AppendLine("<li><a href='$itemUrl'>📁 $itemName/</a><span class='size'>目录</span></li>")
                            } else {
                                $fi = New-Object System.IO.FileInfo($item)
                                $sz = if ($fi.Length -gt 1GB) { "{0:N2} GB" -f ($fi.Length / 1GB) } elseif ($fi.Length -gt 1MB) { "{0:N2} MB" -f ($fi.Length / 1MB) } else { "{0:N2} KB" -f ($fi.Length / 1KB) }
                                $sb.AppendLine("<li><a href='$itemUrl' download>📄 $itemName</a><span class='size'>$sz</span></li>")
                            }
                        }
                        $sb.AppendLine("</ul></body></html>")

                        $htmlBytes = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
                        $resp.ContentType = "text/html; charset=utf-8"
                        $resp.ContentLength64 = $htmlBytes.Length
                        $resp.OutputStream.Write($htmlBytes, 0, $htmlBytes.Length)
                        $resp.Close()
                    }
                    else {
                        $resp.StatusCode = 404
                        $resp.Close()
                    }
                }
                catch { }
            }
        })
        $null = $ps.AddArgument($listener)
        $null = $ps.AddArgument($resolvedPath)
        $global:HttpServerThread = $ps.BeginInvoke()

        return @{
            success = $true
            running = $true
            port = $port
            path = $resolvedPath
            urls = $global:HttpServerState.Urls
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Stop-HttpFileServer {
    try {
        if ($global:HttpServerInstance) {
            $global:HttpServerInstance.Stop()
            $global:HttpServerInstance.Close()
            $global:HttpServerInstance = $null
        }
        $global:HttpServerState.Running = $false
        return @{ success = $true; running = $false }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-HttpFileServerStatus {
    return @{
        success = $true
        running = ($global:HttpServerInstance -ne $null -and $global:HttpServerState.Running)
        port = $global:HttpServerState.Port
        path = $global:HttpServerState.Path
        urls = $global:HttpServerState.Urls
    }
}

# ----------------- 6. Route & Traceroute Functions -----------------
function Get-SystemRouteList {
    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $routes = Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue
        foreach ($r in $routes) {
            $results.Add([PSCustomObject]@{
                destination = $r.DestinationPrefix
                nextHop = $r.NextHop
                interfaceAlias = $r.InterfaceAlias
                interfaceIndex = $r.InterfaceIndex
                metric = $r.RouteMetric
                ifMetric = $r.InterfaceMetric
                protocol = $r.Protocol.ToString()
            })
        }
    }
    catch { }
    return $results
}

function Invoke-TraceRouteAction([string]$targetHost, [int]$maxHops = 20, [int]$timeoutMs = 800) {
    $hops = [System.Collections.Generic.List[PSCustomObject]]::new()
    $ping = New-Object System.Net.NetworkInformation.Ping
    $buffer = [System.Text.Encoding]::ASCII.GetBytes("0123456789abcdef0123456789abcdef")

    for ($ttl = 1; $ttl -le $maxHops; $ttl++) {
        $options = New-Object System.Net.NetworkInformation.PingOptions($ttl, $true)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $reply = $ping.Send($targetHost, $timeoutMs, $buffer, $options)
            $sw.Stop()
            $ip = if ($reply.Address) { $reply.Address.ToString() } else { "*" }
            $status = $reply.Status.ToString()
            $latency = if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success -or $reply.Status -eq [System.Net.NetworkInformation.IPStatus]::TtlExpired) {
                [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
            } else {
                -1
            }

            $hops.Add([PSCustomObject]@{
                hop = $ttl
                ip = $ip
                hostname = ""
                latencyMs = $latency
                status = $status
            })

            if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                break
            }
        }
        catch {
            $sw.Stop()
            $hops.Add([PSCustomObject]@{
                hop = $ttl
                ip = "*"
                hostname = ""
                latencyMs = -1
                status = "TimedOut"
            })
        }
    }

    # Async non-blocking hostname resolution (max 250ms total)
    $hostTasks = @{}
    foreach ($h in $hops) {
        if ($h.ip -and $h.ip -ne "*") {
            try {
                $hostTasks[$h.ip] = [System.Net.Dns]::GetHostEntryAsync($h.ip)
            } catch { }
        }
    }
    $dnsDeadline = [DateTime]::UtcNow.AddMilliseconds(250)
    while ([DateTime]::UtcNow -lt $dnsDeadline) {
        $allDone = $true
        foreach ($t in $hostTasks.Values) {
            if (-not $t.IsCompleted) { $allDone = $false; break }
        }
        if ($allDone) { break }
        Start-Sleep -Milliseconds 15
    }

    foreach ($h in $hops) {
        if ($hostTasks.ContainsKey($h.ip) -and $hostTasks[$h.ip].IsCompleted -and $hostTasks[$h.ip].Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {
            try {
                $h.hostname = $hostTasks[$h.ip].Result.HostName
            } catch { }
        }
    }

    return @{
        target = $targetHost
        hops = $hops
    }
}

# ----------------- System & Privilege Functions -----------------
function Test-IsAdmin {
    try {
        $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Invoke-ElevatedCommand([string]$scriptBlockText) {
    try {
        $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($scriptBlockText))
        $proc = Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded" -Verb RunAs -Wait -PassThru -WindowStyle Hidden
        if ($proc.ExitCode -eq 0) {
            return @{ success = $true }
        } else {
            return @{ success = $false; error = "Elevated execution failed with exit code $($proc.ExitCode)" }
        }
    }
    catch {
        $msg = if ($_.Exception.Message -match "cancel|canceled") { "User canceled UAC elevation prompt." } else { $_.Exception.Message }
        return @{ success = $false; error = $msg }
    }
}

function Get-EnvVarList {
    $userDict = [System.Environment]::GetEnvironmentVariables([System.EnvironmentVariableTarget]::User)
    $machineDict = [System.Environment]::GetEnvironmentVariables([System.EnvironmentVariableTarget]::Machine)

    $userVars = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($k in $userDict.Keys) {
        $userVars.Add([PSCustomObject]@{ name = $k; value = [string]$userDict[$k]; scope = "User" })
    }

    $machineVars = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($k in $machineDict.Keys) {
        $machineVars.Add([PSCustomObject]@{ name = $k; value = [string]$machineDict[$k]; scope = "Machine" })
    }

    $userPath = if ($userDict.ContainsKey("Path")) { [string]$userDict["Path"] } else { "" }
    $machinePath = if ($machineDict.ContainsKey("Path")) { [string]$machineDict["Path"] } else { "" }

    $pathAnalysis = [System.Collections.Generic.List[PSCustomObject]]::new()
    $rawPaths = ($userPath + ";" + $machinePath).Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
    foreach ($p in $rawPaths) {
        $trimmed = $p.Trim()
        if ($trimmed) {
            $exists = Test-Path -Path $trimmed
            $pathAnalysis.Add([PSCustomObject]@{
                path = $trimmed
                exists = $exists
            })
        }
    }

    return [PSCustomObject]@{
        userVars = $userVars
        machineVars = $machineVars
        pathAnalysis = $pathAnalysis
        isAdmin = (Test-IsAdmin)
    }
}

function Set-EnvVar([string]$name, [string]$value, [string]$scope = "User") {
    $target = if ($scope -eq "Machine") { [System.EnvironmentVariableTarget]::Machine } else { [System.EnvironmentVariableTarget]::User }
    try {
        [System.Environment]::SetEnvironmentVariable($name, $value, $target)
        return @{ success = $true; message = "Environment variable saved successfully." }
    }
    catch {
        if ($scope -eq "Machine" -and -not (Test-IsAdmin)) {
            $escapedValue = $value.Replace("`"", "```"").Replace("'", "''")
            $cmd = "[System.Environment]::SetEnvironmentVariable('$name', '$escapedValue', [System.EnvironmentVariableTarget]::Machine)"
            $elevatedRes = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevatedRes.success) {
                return @{ success = $true; message = "Environment variable saved via elevated UAC administrator." }
            } else {
                return @{ success = $false; error = "Save failed: $($elevatedRes.error)" }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Delete-EnvVar([string]$name, [string]$scope = "User") {
    $target = if ($scope -eq "Machine") { [System.EnvironmentVariableTarget]::Machine } else { [System.EnvironmentVariableTarget]::User }
    try {
        [System.Environment]::SetEnvironmentVariable($name, $null, $target)
        return @{ success = $true; message = "Environment variable deleted successfully." }
    }
    catch {
        if ($scope -eq "Machine" -and -not (Test-IsAdmin)) {
            $cmd = "[System.Environment]::SetEnvironmentVariable('$name', `$null, [System.EnvironmentVariableTarget]::Machine)"
            $elevatedRes = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevatedRes.success) {
                return @{ success = $true; message = "Environment variable deleted via elevated UAC administrator." }
            } else {
                return @{ success = $false; error = "Delete failed: $($elevatedRes.error)" }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-ProcessList {
    $list = [System.Collections.Generic.List[PSCustomObject]]::new()
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
        $mem = [math]::Round($_.WorkingSet64 / 1MB, 1)
        $cpu = if ($_.CPU) { [math]::Round($_.CPU, 1) } else { 0 }
        $path = try { $_.Path } catch { "" }
        $desc = try { $_.Description } catch { "" }
        $list.Add([PSCustomObject]@{
            pid = $_.Id
            name = $_.ProcessName
            memoryMB = $mem
            cpu = $cpu
            responding = $_.Responding
            path = $path
            description = $desc
        })
    }
    return $list
}

function Kill-ProcessById([int]$pid) {
    try {
        Stop-Process -Id $pid -Force -ErrorAction Stop
        return @{ success = $true; message = "进程已终止" }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $cmd = "Stop-Process -Id $pid -Force -ErrorAction Stop"
            $elevatedRes = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevatedRes.success) {
                return @{ success = $true; message = "进程已通过管理员权限终止" }
            } else {
                return @{ success = $false; error = "终止进程失败: $($elevatedRes.error)" }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-HostsInfo {
    try {
        $content = [System.IO.File]::ReadAllText($hostsPath, [System.Text.Encoding]::UTF8)
        return @{
            success = $true
            path = $hostsPath
            content = $content
            isAdmin = (Test-IsAdmin)
        }
    }
    catch {
        return @{
            success = $false
            path = $hostsPath
            error = $_.Exception.Message
            isAdmin = (Test-IsAdmin)
        }
    }
}

function Save-HostsInfo([string]$content) {
    try {
        [System.IO.File]::WriteAllText($hostsPath, $content, [System.Text.Encoding]::UTF8)
        return @{ success = $true; message = "Hosts saved successfully." }
    }
    catch {
        $tmpFile = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($tmpFile, $content, [System.Text.Encoding]::UTF8)
            $cmd = "Copy-Item -Path '$tmpFile' -Destination '$hostsPath' -Force; Remove-Item -Path '$tmpFile' -Force -ErrorAction SilentlyContinue"
            $elevatedRes = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevatedRes.success) {
                return @{ success = $true; message = "Hosts saved successfully via elevated UAC administrator." }
            } else {
                return @{ success = $false; error = "Save failed: $($elevatedRes.error)" }
            }
        }
        finally {
            if (Test-Path $tmpFile) {
                Remove-Item -Path $tmpFile -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# ----------------- 7. Windows Services Functions -----------------
function Get-WinServiceList {
    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $services = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue
        foreach ($s in $services) {
            $results.Add([PSCustomObject]@{
                name = $s.Name
                displayName = $s.DisplayName
                status = $s.State
                startMode = $s.StartMode
                pid = $s.ProcessId
                pathName = $s.PathName
                description = $s.Description
            })
        }
    }
    catch {
        Get-Service -ErrorAction SilentlyContinue | ForEach-Object {
            $results.Add([PSCustomObject]@{
                name = $_.Name
                displayName = $_.DisplayName
                status = $_.Status.ToString()
                startMode = $_.StartType.ToString()
                pid = 0
                pathName = ""
                description = ""
            })
        }
    }
    return $results
}

function Set-WinServiceStatus([string]$serviceName, [string]$action) {
    try {
        if ($action -eq "start") {
            Start-Service -Name $serviceName -ErrorAction Stop
        } elseif ($action -eq "stop") {
            Stop-Service -Name $serviceName -Force -ErrorAction Stop
        } elseif ($action -eq "restart") {
            Restart-Service -Name $serviceName -Force -ErrorAction Stop
        }
        return @{ success = $true; message = "服务操作成功" }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $psCmd = switch ($action) {
                "start" { "Start-Service -Name '$serviceName' -ErrorAction Stop" }
                "stop" { "Stop-Service -Name '$serviceName' -Force -ErrorAction Stop" }
                "restart" { "Restart-Service -Name '$serviceName' -Force -ErrorAction Stop" }
            }
            $elevated = Invoke-ElevatedCommand -scriptBlockText $psCmd
            if ($elevated.success) {
                return @{ success = $true; message = "已通过管理员权限成功执行服务操作" }
            } else {
                return @{ success = $false; error = $elevated.error }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Set-WinServiceStartMode([string]$serviceName, [string]$startType) {
    try {
        Set-Service -Name $serviceName -StartupType $startType -ErrorAction Stop
        return @{ success = $true; message = "服务启动类型已更新" }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $cmd = "Set-Service -Name '$serviceName' -StartupType '$startType' -ErrorAction Stop"
            $elevated = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevated.success) {
                return @{ success = $true; message = "已通过管理员权限成功更新服务启动类型" }
            } else {
                return @{ success = $false; error = $elevated.error }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 8. Startup Items Auditor Functions -----------------
function Get-AllStartupItems {
    $items = [System.Collections.Generic.List[PSCustomObject]]::new()

    # HKCU Run
    $hkcuRun = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    if (Test-Path $hkcuRun) {
        $props = Get-ItemProperty -Path $hkcuRun -ErrorAction SilentlyContinue
        foreach ($p in $props.psobject.properties) {
            if ($p.Name -notmatch "^PS|^_") {
                $val = [string]$p.Value
                $cleanPath = $val.Trim('"').Split('"')[0].Trim()
                $items.Add([PSCustomObject]@{
                    id = "hkcu_" + $p.Name
                    name = $p.Name
                    command = $val
                    targetPath = $cleanPath
                    locationType = "注册表 (当前用户)"
                    locationPath = $hkcuRun
                    enabled = $true
                    fileExists = (Test-Path $cleanPath -PathType Leaf)
                })
            }
        }
    }

    # HKLM Run
    $hklmRun = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
    if (Test-Path $hklmRun) {
        $props = Get-ItemProperty -Path $hklmRun -ErrorAction SilentlyContinue
        foreach ($p in $props.psobject.properties) {
            if ($p.Name -notmatch "^PS|^_") {
                $val = [string]$p.Value
                $cleanPath = $val.Trim('"').Split('"')[0].Trim()
                $items.Add([PSCustomObject]@{
                    id = "hklm_" + $p.Name
                    name = $p.Name
                    command = $val
                    targetPath = $cleanPath
                    locationType = "注册表 (系统所有用户)"
                    locationPath = $hklmRun
                    enabled = $true
                    fileExists = (Test-Path $cleanPath -PathType Leaf)
                })
            }
        }
    }

    # WOW6432Node Run
    $wowRun = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"
    if (Test-Path $wowRun) {
        $props = Get-ItemProperty -Path $wowRun -ErrorAction SilentlyContinue
        foreach ($p in $props.psobject.properties) {
            if ($p.Name -notmatch "^PS|^_") {
                $val = [string]$p.Value
                $cleanPath = $val.Trim('"').Split('"')[0].Trim()
                $items.Add([PSCustomObject]@{
                    id = "wow_" + $p.Name
                    name = $p.Name
                    command = $val
                    targetPath = $cleanPath
                    locationType = "注册表 (32位兼容)"
                    locationPath = $wowRun
                    enabled = $true
                    fileExists = (Test-Path $cleanPath -PathType Leaf)
                })
            }
        }
    }

    # User Startup Folder
    $userStartup = [Environment]::GetFolderPath('Startup')
    if (Test-Path $userStartup) {
        Get-ChildItem -Path $userStartup -ErrorAction SilentlyContinue | ForEach-Object {
            $items.Add([PSCustomObject]@{
                id = "folder_user_" + $_.Name
                name = $_.Name
                command = $_.FullName
                targetPath = $_.FullName
                locationType = "启动文件夹 (用户)"
                locationPath = $userStartup
                enabled = $true
                fileExists = $true
            })
        }
    }

    # Common Startup Folder
    $commonStartup = [Environment]::GetFolderPath('CommonStartup')
    if (Test-Path $commonStartup) {
        Get-ChildItem -Path $commonStartup -ErrorAction SilentlyContinue | ForEach-Object {
            $items.Add([PSCustomObject]@{
                id = "folder_common_" + $_.Name
                name = $_.Name
                command = $_.FullName
                targetPath = $_.FullName
                locationType = "启动文件夹 (公共)"
                locationPath = $commonStartup
                enabled = $true
                fileExists = $true
            })
        }
    }

    return $items
}

function Remove-StartupItemEntry([string]$id, [string]$locationType, [string]$locationPath, [string]$name) {
    try {
        if ($locationType -match "注册表") {
            Remove-ItemProperty -Path $locationPath -Name $name -Force -ErrorAction Stop
            return @{ success = $true; message = "已成功从注册表中移除自启动项" }
        } elseif ($locationType -match "启动文件夹") {
            $target = Join-Path $locationPath $name
            Remove-Item -Path $target -Force -ErrorAction Stop
            return @{ success = $true; message = "已从启动文件夹中删除" }
        }
        return @{ success = $false; error = "未知的自启动项来源类型" }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $cmd = if ($locationType -match "注册表") { "Remove-ItemProperty -Path '$locationPath' -Name '$name' -Force" } else { "Remove-Item -Path '$(Join-Path $locationPath $name)' -Force" }
            $elevated = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevated.success) {
                return @{ success = $true; message = "已通过管理员权限成功删除自启动项" }
            } else {
                return @{ success = $false; error = $elevated.error }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 9. File Lock Hunter Functions -----------------
function Get-FileLockingDetails([string]$path) {
    if (-not (Test-Path $path)) {
        return @{ success = $false; error = "指定文件或路径不存在" }
    }
    $resolved = (Resolve-Path $path).Path

    $processes = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $pids = [RestartManagerWrapper]::FindLockingProcesses($resolved)
        foreach ($pidNum in $pids) {
            try {
                $p = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
                if ($p) {
                    $mem = [math]::Round($p.WorkingSet64 / 1MB, 1)
                    $procPath = try { $p.Path } catch { "" }
                    $desc = try { $p.Description } catch { "" }
                    $wTitle = try { $p.MainWindowTitle } catch { "" }

                    $processes.Add([PSCustomObject]@{
                        pid = $p.Id
                        name = $p.ProcessName
                        title = $wTitle
                        path = $procPath
                        description = $desc
                        memoryMB = $mem
                    })
                }
            } catch { }
        }
    } catch { }

    return @{
        success = $true
        path = $resolved
        locked = ($processes.Count -gt 0)
        lockCount = $processes.Count
        processes = $processes
    }
}

# ----------------- 10. Hardware & System Specs Functions -----------------
function Get-ComprehensiveSpecs {
    try {
        $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
        $cpuInfo = @{
            name = if ($cpu) { $cpu.Name.Trim() } else { "Unknown Processor" }
            manufacturer = if ($cpu) { $cpu.Manufacturer } else { "Unknown" }
            cores = if ($cpu) { $cpu.NumberOfCores } else { 0 }
            threads = if ($cpu) { $cpu.NumberOfLogicalProcessors } else { 0 }
            maxClockSpeedMHz = if ($cpu) { $cpu.MaxClockSpeed } else { 0 }
            socket = if ($cpu) { $cpu.SocketDesignation } else { "" }
            loadPercent = if ($cpu -and $cpu.LoadPercentage) { $cpu.LoadPercentage } else { 0 }
        }

        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        $totalMemKB = if ($os) { $os.TotalVisibleMemorySize } else { 0 }
        $freeMemKB = if ($os) { $os.FreePhysicalMemory } else { 0 }
        $totalGB = [math]::Round($totalMemKB / 1MB, 1)
        $freeGB = [math]::Round($freeMemKB / 1MB, 1)
        $usedGB = [math]::Round($totalGB - $freeGB, 1)
        $memPercent = if ($totalGB -gt 0) { [math]::Round(($usedGB / $totalGB) * 100, 1) } else { 0 }

        $memSlots = [System.Collections.Generic.List[PSCustomObject]]::new()
        Get-CimInstance Win32_PhysicalMemory -ErrorAction SilentlyContinue | ForEach-Object {
            $memSlots.Add([PSCustomObject]@{
                slot = $_.DeviceLocator
                capacityGB = [math]::Round($_.Capacity / 1GB, 1)
                speedMHz = $_.Speed
                manufacturer = $_.Manufacturer
                partNumber = if ($_.PartNumber) { $_.PartNumber.Trim() } else { "" }
            })
        }

        $disks = [System.Collections.Generic.List[PSCustomObject]]::new()
        Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | ForEach-Object {
            $total = [math]::Round($_.Size / 1GB, 1)
            $free = [math]::Round($_.FreeSpace / 1GB, 1)
            $used = [math]::Round($total - $free, 1)
            $pct = if ($total -gt 0) { [math]::Round(($used / $total) * 100, 1) } else { 0 }
            $disks.Add([PSCustomObject]@{
                drive = $_.DeviceID
                volumeName = $_.VolumeName
                fileSystem = $_.FileSystem
                totalGB = $total
                freeGB = $free
                usedGB = $used
                percentUsed = $pct
            })
        }

        $physicalDisks = [System.Collections.Generic.List[PSCustomObject]]::new()
        Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object {
            $physicalDisks.Add([PSCustomObject]@{
                model = $_.Model
                sizeGB = [math]::Round($_.Size / 1GB, 1)
                interfaceType = $_.InterfaceType
                mediaType = $_.MediaType
            })
        }

        $gpus = [System.Collections.Generic.List[PSCustomObject]]::new()
        Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
            $ramMB = if ($_.AdapterRAM) { [math]::Round($_.AdapterRAM / 1MB, 0) } else { 0 }
            $gpus.Add([PSCustomObject]@{
                name = $_.Name
                driverVersion = $_.DriverVersion
                memoryMB = $ramMB
                status = $_.Status
            })
        }

        $bootTime = if ($os) { $os.LastBootUpTime } else { [DateTime]::MinValue }
        $uptimeStr = "0 分钟"
        if ($bootTime -ne [DateTime]::MinValue) {
            $diff = [DateTime]::Now - $bootTime
            $uptimeStr = "$($diff.Days) 天 $($diff.Hours) 小时 $($diff.Minutes) 分钟"
        }

        $osInfo = @{
            caption = if ($os) { $os.Caption } else { "Windows" }
            version = if ($os) { $os.Version } else { "" }
            buildNumber = if ($os) { $os.BuildNumber } else { "" }
            architecture = if ($os) { $os.OSArchitecture } else { "64-bit" }
            installDate = if ($os -and $os.InstallDate) { $os.InstallDate.ToString("yyyy-MM-dd HH:mm:ss") } else { "-" }
            lastBootTime = if ($bootTime -ne [DateTime]::MinValue) { $bootTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "-" }
            uptime = $uptimeStr
            computerName = $env:COMPUTERNAME
            userName = $env:USERNAME
            isAdmin = (Test-IsAdmin)
        }

        return @{
            success = $true
            cpu = $cpuInfo
            memory = @{
                totalGB = $totalGB
                freeGB = $freeGB
                usedGB = $usedGB
                percentUsed = $memPercent
                slots = $memSlots
            }
            disks = $disks
            physicalDisks = $physicalDisks
            gpus = $gpus
            os = $osInfo
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 11. System Shortcuts Launcher Functions -----------------
function Launch-SysUtility([string]$toolKey) {
    try {
        switch ($toolKey) {
            "gpedit"    { Start-Process "gpedit.msc" }
            "regedit"   { Start-Process "regedit.exe" }
            "devmgmt"   { Start-Process "devmgmt.msc" }
            "eventvwr"  { Start-Process "eventvwr.msc" }
            "taskschd"  { Start-Process "taskschd.msc" }
            "diskmgmt"  { Start-Process "diskmgmt.msc" }
            "compmgmt"  { Start-Process "compmgmt.msc" }
            "perfmon"   { Start-Process "perfmon.msc" }
            "firewall"  { Start-Process "wf.msc" }
            "services"  { Start-Process "services.msc" }
            "ncpa"      { Start-Process "ncpa.cpl" }
            "appwiz"    { Start-Process "appwiz.cpl" }
            "sysdm"     { Start-Process "sysdm.cpl" }
            "powercfg"  { Start-Process "powercfg.cpl" }
            "mmsys"     { Start-Process "mmsys.cpl" }
            "dxdiag"    { Start-Process "dxdiag.exe" }
            "resmon"    { Start-Process "resmon.exe" }
            "msinfo32"  { Start-Process "msinfo32.exe" }
            "certmgr"   { Start-Process "certmgr.msc" }
            "cleanmgr"  { Start-Process "cleanmgr.exe" }
            "cmd"       { Start-Process "cmd.exe" }
            "powershell"{ Start-Process "powershell.exe" }
            "godmode"   { Start-Process "explorer.exe" -ArgumentList "shell:::{ED7BA470-8E54-465E-825C-99712043E01C}" }
            default     { return @{ success = $false; error = "未知的快捷工具标识" } }
        }
        return @{ success = $true; message = "已启动工具" }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- Main Window -----------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "DevTools Box - Toolbox"
$form.Width = 1180
$form.Height = 780
$form.MinimumSize = New-Object System.Drawing.Size(900, 600)
$form.StartPosition = "CenterScreen"

$htmlPath = Join-Path $PSScriptRoot "ui\index.html"
$htmlUri = [System.Uri]::new((Resolve-Path $htmlPath).Path)

$webView = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$creationProperties = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$creationProperties.UserDataFolder = $userDataPath
$webView.CreationProperties = $creationProperties
$webView.Tag = $htmlUri
$webView.Dock = [System.Windows.Forms.DockStyle]::Fill

$webView.add_CoreWebView2InitializationCompleted({
    param($sender, $eventArgs)

    if (-not $eventArgs.IsSuccess) {
        $message = if ($eventArgs.InitializationException) {
            $exception = $eventArgs.InitializationException
            "Type: $($exception.GetType().FullName)`r`nHResult: 0x$('{0:X8}' -f ($exception.HResult -band 0xffffffff))`r`n$($exception.ToString())"
        } else {
            "WebView2 initialization failed. User data folder: $userDataPath"
        }

        [System.Windows.Forms.MessageBox]::Show(
            $message,
            "WebView2 Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
        return
    }

    # Register IPC message receiver
    $sender.CoreWebView2.add_WebMessageReceived({
        param($s, $e)
        try {
            $rawJson = $e.WebMessageAsJson
            $request = ConvertFrom-Json $rawJson
            $reqId = $request.id
            $action = $request.action
            $payload = $request.payload

            $response = [ordered]@{
                id = $reqId
                action = $action
                success = $true
                data = $null
                error = $null
            }

            switch ($action) {
                # Settings & General
                "get_autostart" {
                    $response.data = @{ enabled = (Get-AutoStartStatus) }
                }
                "set_autostart" {
                    $enabled = [bool]($payload.enabled)
                    $res = Set-AutoStartStatus -enable $enabled
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "get_config" {
                    $response.data = Get-AppConfig
                }
                "save_config" {
                    $res = Save-AppConfig -configObj $payload.config
                    if (-not $res.success) { $response.success = $false; $response.error = $res.error }
                }
                "open_external" {
                    $url = $payload.url
                    if ($url -and ($url.StartsWith("http://") -or $url.StartsWith("https://"))) {
                        Start-Process $url
                    }
                }
                "get_system_info" {
                    $response.data = @{
                        os = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
                        psVersion = $PSVersionTable.PSVersion.ToString()
                        appVersion = "1.0.0"
                        isAdmin = (Test-IsAdmin)
                    }
                }
                "get_privilege_info" {
                    $response.data = @{
                        isAdmin = (Test-IsAdmin)
                        userName = [System.Environment]::UserName
                        userDomain = [System.Environment]::UserDomainName
                    }
                }
                "sys_elevate_app" {
                    try {
                        $appScript = Join-Path $PSScriptRoot "app.ps1"
                        Start-Process powershell.exe -ArgumentList "-STA -NoProfile -ExecutionPolicy Bypass -File `"$appScript`"" -Verb RunAs
                        $response.data = @{ success = $true; message = "Launching new elevated administrator instance..." }
                        $t = New-Object System.Windows.Forms.Timer
                        $t.Interval = 600
                        $t.Add_Tick({
                            $t.Stop()
                            $form.Close()
                        })
                        $t.Start()
                    }
                    catch {
                        $response.success = $false
                        $response.error = if ($_.Exception.Message -match "cancel|canceled") { "User canceled administrator elevation prompt." } else { $_.Exception.Message }
                    }
                }

                # Network Tools (Base)
                "net_get_local_ports" {
                    $response.data = Get-LocalPortList
                }
                "net_check_remote_port" {
                    $hostName = [string]($payload.host)
                    $ports = $payload.ports
                    $timeout = if ($payload.timeoutMs) { [int]($payload.timeoutMs) } else { 1500 }
                    $response.data = Test-RemotePorts -hostName $hostName -ports $ports -timeoutMs $timeout
                }
                "net_ping" {
                    $targetHost = [string]($payload.host)
                    $count = if ($payload.count) { [int]($payload.count) } else { 4 }
                    $timeout = if ($payload.timeoutMs) { [int]($payload.timeoutMs) } else { 2000 }
                    $response.data = Test-PingAndDns -targetHost $targetHost -count $count -timeoutMs $timeout
                }
                "net_http_request" {
                    $method = [string]($payload.method)
                    $url = [string]($payload.url)
                    $headers = $payload.headers
                    $body = [string]($payload.body)
                    $timeoutSec = if ($payload.timeoutSec) { [int]($payload.timeoutSec) } else { 30 }
                    $res = Invoke-CustomHttpRequest -method $method -url $url -headers $headers -body $body -timeoutSec $timeoutSec
                    if ($res.success) {
                        $response.data = $res
                    } else {
                        $response.success = $false
                        $response.data = $res
                        $response.error = $res.error
                    }
                }

                # 1. NetAdapter & DNS
                "net_get_adapters" {
                    $response.data = Get-NetAdapterAndDns
                }
                "net_set_adapter_dns" {
                    $ifAlias = [string]($payload.interfaceAlias)
                    $dnsArr = @($payload.dnsServers)
                    $isDhcp = [bool]($payload.isDhcp)
                    $res = Set-NetAdapterDnsConfig -interfaceAlias $ifAlias -dnsServers $dnsArr -isDhcp $isDhcp
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "net_set_adapter_ip" {
                    $ifAlias = [string]($payload.interfaceAlias)
                    $isDhcp = [bool]($payload.isDhcp)
                    $ip = [string]($payload.ip)
                    $prefixLen = if ($payload.prefixLength) { [int]($payload.prefixLength) } else { 24 }
                    $gw = [string]($payload.gateway)
                    $res = Set-NetAdapterIpConfig -interfaceAlias $ifAlias -isDhcp $isDhcp -ip $ip -prefixLength $prefixLen -gateway $gw
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "net_flush_dns_winsock" {
                    $response.data = Invoke-FlushDnsAndWinsock
                }

                # 2. LAN Scanner
                "net_scan_lan" {
                    $subnet = [string]($payload.subnet)
                    $res = Invoke-LanScanner -subnetBase $subnet
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                # 3. SSL/TLS Inspector
                "net_check_ssl" {
                    $hostName = [string]($payload.host)
                    $port = if ($payload.port) { [int]($payload.port) } else { 443 }
                    $timeout = if ($payload.timeoutMs) { [int]($payload.timeoutMs) } else { 5000 }
                    $res = Get-SslCertificateDetails -hostName $hostName -port $port -timeoutMs $timeout
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                # 4. Proxy Manager
                "net_get_proxy" {
                    $res = Get-SystemProxySettings
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "net_set_proxy" {
                    $enable = [bool]($payload.enabled)
                    $srv = [string]($payload.server)
                    $override = [string]($payload.override)
                    $pac = [string]($payload.pacUrl)
                    $res = Set-SystemProxySettings -enabled $enable -server $srv -override $override -pacUrl $pac
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                # 5. Mini HTTP File Server
                "net_start_file_server" {
                    $folderPath = [string]($payload.path)
                    $port = if ($payload.port) { [int]($payload.port) } else { 8000 }
                    $res = Start-HttpFileServer -folderPath $folderPath -port $port
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "net_stop_file_server" {
                    $res = Stop-HttpFileServer
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "net_get_file_server_status" {
                    $response.data = Get-HttpFileServerStatus
                }

                # 6. Route & Traceroute
                "net_get_route_table" {
                    $response.data = Get-SystemRouteList
                }
                "net_trace_route" {
                    $targetHost = [string]($payload.host)
                    $maxHops = if ($payload.maxHops) { [int]($payload.maxHops) } else { 20 }
                    $timeout = if ($payload.timeoutMs) { [int]($payload.timeoutMs) } else { 1500 }
                    $response.data = Invoke-TraceRouteAction -targetHost $targetHost -maxHops $maxHops -timeoutMs $timeout
                }

                # Base System Tools
                "sys_get_env_vars" {
                    $response.data = Get-EnvVarList
                }
                "sys_set_env_var" {
                    $name = [string]($payload.name)
                    $value = [string]($payload.value)
                    $scope = [string]($payload.scope)
                    $res = Set-EnvVar -name $name -value $value -scope $scope
                    if (-not $res.success) { $response.success = $false; $response.error = $res.error }
                }
                "sys_delete_env_var" {
                    $name = [string]($payload.name)
                    $scope = [string]($payload.scope)
                    $res = Delete-EnvVar -name $name -scope $scope
                    if (-not $res.success) { $response.success = $false; $response.error = $res.error }
                }
                "sys_get_processes" {
                    $response.data = Get-ProcessList
                }
                "sys_kill_process" {
                    $pidToKill = [int]($payload.pid)
                    $res = Kill-ProcessById -pid $pidToKill
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "sys_get_hosts" {
                    $res = Get-HostsInfo
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "sys_save_hosts" {
                    $content = [string]($payload.content)
                    $res = Save-HostsInfo -content $content
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                # 7. Windows Services
                "sys_get_services" {
                    $response.data = Get-WinServiceList
                }
                "sys_set_service_state" {
                    $name = [string]($payload.name)
                    $svcAction = [string]($payload.action)
                    $res = Set-WinServiceStatus -serviceName $name -action $svcAction
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }
                "sys_set_service_start_type" {
                    $name = [string]($payload.name)
                    $startType = [string]($payload.startType)
                    $res = Set-WinServiceStartMode -serviceName $name -startType $startType
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                # 8. Startup Items Auditor
                "sys_get_startup_items" {
                    $response.data = Get-AllStartupItems
                }
                "sys_remove_startup_item" {
                    $id = [string]($payload.id)
                    $locType = [string]($payload.locationType)
                    $locPath = [string]($payload.locationPath)
                    $name = [string]($payload.name)
                    $res = Remove-StartupItemEntry -id $id -locationType $locType -locationPath $locPath -name $name
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                # 9. File Lock Hunter
                "sys_get_file_locks" {
                    $path = [string]($payload.path)
                    $res = Get-FileLockingDetails -path $path
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                # 10. Hardware Specs & Health
                "sys_get_hardware_specs" {
                    $res = Get-ComprehensiveSpecs
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                # 11. System Shortcuts Launcher
                "sys_launch_shortcut" {
                    $key = [string]($payload.toolKey)
                    $res = Launch-SysUtility -toolKey $key
                    if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                }

                default {
                    $response.success = $false
                    $response.error = "Unknown action: $action"
                }
            }

            $resJson = ConvertTo-Json -InputObject $response -Compress -Depth 10
            $s.PostWebMessageAsJson($resJson)
        }
        catch {
            $errResponse = @{
                id = if ($request) { $request.id } else { $null }
                action = if ($request) { $request.action } else { "unknown" }
                success = $false
                error = $_.Exception.Message
            }
            $errJson = ConvertTo-Json -InputObject $errResponse -Compress -Depth 10
            $s.PostWebMessageAsJson($errJson)
        }
    })

    $sender.CoreWebView2.Navigate($sender.Tag.AbsoluteUri)
})

$form.Controls.Add($webView)

$form.Add_Shown({
    try {
        if ($null -eq $webView.CoreWebView2) {
            $null = $webView.EnsureCoreWebView2Async()
        }
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.ToString(),
            "WebView2 Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
    }
})

[void]$form.ShowDialog()
