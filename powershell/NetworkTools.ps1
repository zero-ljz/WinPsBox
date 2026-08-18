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

# ----------------- TCP Socket Debugger -----------------
$script:TcpDebugSessions = @{}

function Connect-DebugTcpSocket([string]$hostName, [int]$port, [int]$timeoutMs = 5000) {
    if ([string]::IsNullOrWhiteSpace($hostName)) {
        return @{ success = $false; error = "Host is required." }
    }
    if ($port -lt 1 -or $port -gt 65535) {
        return @{ success = $false; error = "Port must be between 1 and 65535." }
    }

    $client = New-Object System.Net.Sockets.TcpClient
    $client.NoDelay = $true
    try {
        $connectResult = $client.BeginConnect($hostName.Trim(), $port, $null, $null)
        if (-not $connectResult.AsyncWaitHandle.WaitOne([math]::Max(250, $timeoutMs))) {
            $connectResult.AsyncWaitHandle.Close()
            $client.Close()
            return @{ success = $false; error = "Connection timed out." }
        }

        $client.EndConnect($connectResult)
        $connectResult.AsyncWaitHandle.Close()
        $sessionId = [guid]::NewGuid().ToString("N")
        $script:TcpDebugSessions[$sessionId] = @{
            client = $client
            stream = $client.GetStream()
            connectedAt = [DateTime]::UtcNow
        }

        return @{
            success = $true
            sessionId = $sessionId
            localEndpoint = $client.Client.LocalEndPoint.ToString()
            remoteEndpoint = $client.Client.RemoteEndPoint.ToString()
            connectedAt = [DateTime]::UtcNow.ToString("o")
        }
    }
    catch {
        try { $client.Close() } catch { }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Send-DebugTcpSocket([string]$sessionId, [string]$dataBase64) {
    if (-not $script:TcpDebugSessions.ContainsKey($sessionId)) {
        return @{ success = $false; error = "TCP session was not found." }
    }

    try {
        $bytes = [Convert]::FromBase64String($dataBase64)
        $session = $script:TcpDebugSessions[$sessionId]
        if (-not $session.client.Connected) { throw "TCP socket is disconnected." }
        $session.stream.Write($bytes, 0, $bytes.Length)
        $session.stream.Flush()
        return @{ success = $true; bytes = $bytes.Length }
    }
    catch {
        Disconnect-DebugTcpSocket -sessionId $sessionId | Out-Null
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Receive-DebugTcpSocket([string]$sessionId, [int]$maxBytes = 65536) {
    if (-not $script:TcpDebugSessions.ContainsKey($sessionId)) {
        return @{ success = $false; connected = $false; closed = $true; error = "TCP session was not found." }
    }

    $session = $script:TcpDebugSessions[$sessionId]
    $client = $session.client
    try {
        $available = $client.Available
        if ($available -le 0) {
            $isClosed = $client.Client.Poll(0, [System.Net.Sockets.SelectMode]::SelectRead)
            if ($isClosed) {
                Disconnect-DebugTcpSocket -sessionId $sessionId | Out-Null
                return @{ success = $true; connected = $false; closed = $true; bytes = 0; dataBase64 = "" }
            }
            return @{ success = $true; connected = $true; closed = $false; bytes = 0; dataBase64 = "" }
        }

        $readSize = [math]::Min([math]::Max(1, $maxBytes), $available)
        $buffer = New-Object byte[] $readSize
        $read = $session.stream.Read($buffer, 0, $readSize)
        if ($read -le 0) {
            Disconnect-DebugTcpSocket -sessionId $sessionId | Out-Null
            return @{ success = $true; connected = $false; closed = $true; bytes = 0; dataBase64 = "" }
        }

        if ($read -ne $buffer.Length) {
            $payload = New-Object byte[] $read
            [Array]::Copy($buffer, $payload, $read)
        } else {
            $payload = $buffer
        }

        return @{
            success = $true
            connected = $true
            closed = $false
            bytes = $read
            dataBase64 = [Convert]::ToBase64String($payload)
        }
    }
    catch {
        $errorMessage = $_.Exception.Message
        Disconnect-DebugTcpSocket -sessionId $sessionId | Out-Null
        return @{ success = $false; connected = $false; closed = $true; error = $errorMessage }
    }
}

function Disconnect-DebugTcpSocket([string]$sessionId) {
    if ($script:TcpDebugSessions.ContainsKey($sessionId)) {
        $session = $script:TcpDebugSessions[$sessionId]
        try { $session.stream.Dispose() } catch { }
        try { $session.client.Close() } catch { }
        $script:TcpDebugSessions.Remove($sessionId)
    }
    return @{ success = $true; connected = $false }
}
