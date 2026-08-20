# Diagnostic reports, OpenSSH management, and WSL management.

function New-DiagnosticCheck([string]$id, [string]$name, [string]$status, [string]$summary, [string]$detail = "") {
    return [PSCustomObject]@{
        id = $id
        name = $name
        status = $status
        summary = $summary
        detail = $detail
    }
}

function Invoke-OneClickDiagnostic([string]$target = "www.microsoft.com") {
    if ([string]::IsNullOrWhiteSpace($target)) { $target = "www.microsoft.com" }
    $target = $target.Trim()
    $checks = [System.Collections.Generic.List[PSCustomObject]]::new()
    $started = Get-Date

    Write-AppTaskProgress 5 "正在检查 Windows 系统"
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        $uptime = (Get-Date) - $os.LastBootUpTime
        $checks.Add((New-DiagnosticCheck "system" "Windows system" "pass" "$($os.Caption) build $($os.BuildNumber)" ("Uptime: {0}d {1}h; PowerShell: {2}; Admin: {3}" -f [int]$uptime.TotalDays, $uptime.Hours, $PSVersionTable.PSVersion, (Test-IsAdmin))))
    }
    catch {
        $checks.Add((New-DiagnosticCheck "system" "Windows system" "error" "Unable to read system information" $_.Exception.Message))
    }

    Write-AppTaskProgress 15 "正在检查系统磁盘"
    try {
        $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='{0}'" -f $env:SystemDrive) -ErrorAction Stop
        $freeGB = [math]::Round($disk.FreeSpace / 1GB, 1)
        $totalGB = [math]::Round($disk.Size / 1GB, 1)
        $freePercent = if ($disk.Size -gt 0) { [math]::Round(($disk.FreeSpace / $disk.Size) * 100, 1) } else { 0 }
        $status = if ($freePercent -lt 8) { "error" } elseif ($freePercent -lt 15) { "warn" } else { "pass" }
        $checks.Add((New-DiagnosticCheck "disk" "System drive" $status "$freeGB GB free of $totalGB GB" "$freePercent% available on $($disk.DeviceID)"))
    }
    catch {
        $checks.Add((New-DiagnosticCheck "disk" "System drive" "warn" "Unable to read disk capacity" $_.Exception.Message))
    }

    Write-AppTaskProgress 27 "正在检查网络适配器"
    try {
        $adapters = @(Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.IPv4Address })
        $connected = @($adapters | Where-Object { $_.NetAdapter.Status -eq "Up" })
        if ($connected.Count -gt 0) {
            $details = @($connected | ForEach-Object { "$($_.InterfaceAlias): $($_.IPv4Address.IPAddress)" }) -join "; "
            $checks.Add((New-DiagnosticCheck "adapter" "Network adapters" "pass" "$($connected.Count) connected adapter(s)" $details))
        }
        else {
            $checks.Add((New-DiagnosticCheck "adapter" "Network adapters" "error" "No connected IPv4 adapter" "Check cable, Wi-Fi, or adapter state."))
        }
    }
    catch {
        $checks.Add((New-DiagnosticCheck "adapter" "Network adapters" "error" "Unable to enumerate adapters" $_.Exception.Message))
    }

    Write-AppTaskProgress 40 "正在检查默认路由"
    try {
        $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
        if ($route) {
            $checks.Add((New-DiagnosticCheck "route" "Default route" "pass" "Gateway $($route.NextHop)" "Interface: $($route.InterfaceAlias); metric: $($route.RouteMetric)"))
        }
        else {
            $checks.Add((New-DiagnosticCheck "route" "Default route" "error" "No IPv4 default route" "A default gateway is required for Internet access."))
        }
    }
    catch {
        $checks.Add((New-DiagnosticCheck "route" "Default route" "error" "Unable to read the default route" $_.Exception.Message))
    }

    Write-AppTaskProgress 52 "正在测试 DNS 解析" $target
    try {
        $addresses = @([System.Net.Dns]::GetHostAddresses($target) | ForEach-Object { $_.IPAddressToString })
        if ($addresses.Count -gt 0) {
            $checks.Add((New-DiagnosticCheck "dns" "DNS resolution" "pass" "$target resolved" ($addresses -join ", ")))
        }
        else {
            $checks.Add((New-DiagnosticCheck "dns" "DNS resolution" "error" "$target returned no address" ""))
        }
    }
    catch {
        $checks.Add((New-DiagnosticCheck "dns" "DNS resolution" "error" "Unable to resolve $target" $_.Exception.Message))
    }

    Write-AppTaskProgress 64 "正在测试网络连通性" $target
    try {
        $ping = New-Object System.Net.NetworkInformation.Ping
        $reply = $ping.Send($target, 1800)
        $ping.Dispose()
        if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
            $checks.Add((New-DiagnosticCheck "ping" "Network reachability" "pass" "$($reply.RoundtripTime) ms to $target" "Address: $($reply.Address)"))
        }
        else {
            $checks.Add((New-DiagnosticCheck "ping" "Network reachability" "warn" "Ping status: $($reply.Status)" "ICMP may be blocked even when the target is reachable."))
        }
    }
    catch {
        $checks.Add((New-DiagnosticCheck "ping" "Network reachability" "warn" "Ping test failed" $_.Exception.Message))
    }

    Write-AppTaskProgress 76 "正在检查 Windows 代理"
    try {
        $proxy = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction Stop
        $enabled = [int]$proxy.ProxyEnable -eq 1
        $summary = if ($enabled) { "Proxy enabled: $($proxy.ProxyServer)" } elseif ($proxy.AutoConfigURL) { "PAC configured" } else { "Direct connection" }
        $detail = if ($proxy.AutoConfigURL) { "PAC: $($proxy.AutoConfigURL)" } else { "No PAC URL configured" }
        $checks.Add((New-DiagnosticCheck "proxy" "Windows proxy" "pass" $summary $detail))
    }
    catch {
        $checks.Add((New-DiagnosticCheck "proxy" "Windows proxy" "warn" "Unable to read proxy settings" $_.Exception.Message))
    }

    Write-AppTaskProgress 86 "正在检查核心服务"
    try {
        $serviceDetails = @()
        $serviceStatus = "pass"
        foreach ($serviceName in @("Dnscache", "Dhcp", "W32Time")) {
            $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
            if ($service) {
                $serviceDetails += "$serviceName=$($service.Status)"
                if ($serviceName -ne "W32Time" -and $service.Status -ne "Running") { $serviceStatus = "warn" }
            }
        }
        $checks.Add((New-DiagnosticCheck "services" "Core services" $serviceStatus "Windows network services checked" ($serviceDetails -join "; ")))
    }
    catch {
        $checks.Add((New-DiagnosticCheck "services" "Core services" "warn" "Unable to inspect services" $_.Exception.Message))
    }

    Write-AppTaskProgress 94 "正在检查待重启状态"
    $rebootKeys = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired"
    )
    $pendingReboot = @($rebootKeys | Where-Object { Test-Path $_ }).Count -gt 0
    $checks.Add((New-DiagnosticCheck "reboot" "Pending reboot" $(if ($pendingReboot) { "warn" } else { "pass" }) $(if ($pendingReboot) { "Windows restart is pending" } else { "No restart marker found" }) ""))

    $passCount = @($checks | Where-Object { $_.status -eq "pass" }).Count
    $warnCount = @($checks | Where-Object { $_.status -eq "warn" }).Count
    $errorCount = @($checks | Where-Object { $_.status -eq "error" }).Count
    return [PSCustomObject]@{
        generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        computerName = $env:COMPUTERNAME
        target = $target
        durationMs = [math]::Round(((Get-Date) - $started).TotalMilliseconds)
        summary = [PSCustomObject]@{ pass = $passCount; warn = $warnCount; error = $errorCount; total = $checks.Count }
        checks = $checks
    }
}

function Save-OneClickDiagnosticReport($report, [string]$format = "markdown") {
    try {
        $reportsPath = Join-Path $script:AppRoot "data\reports"
        [System.IO.Directory]::CreateDirectory($reportsPath) | Out-Null
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        if ($format -eq "json") {
            $filePath = Join-Path $reportsPath "WinPsBox-Diagnostic-$stamp.json"
            $content = ConvertTo-Json -InputObject $report -Depth 12
        }
        else {
            $filePath = Join-Path $reportsPath "WinPsBox-Diagnostic-$stamp.md"
            $builder = New-Object System.Text.StringBuilder
            [void]$builder.AppendLine("# WinPsBox Diagnostic Report")
            [void]$builder.AppendLine("")
            [void]$builder.AppendLine("- Generated: $($report.generatedAt)")
            [void]$builder.AppendLine("- Computer: $($report.computerName)")
            [void]$builder.AppendLine("- Target: $($report.target)")
            [void]$builder.AppendLine("- Duration: $($report.durationMs) ms")
            [void]$builder.AppendLine("")
            [void]$builder.AppendLine("| Status | Check | Summary | Detail |")
            [void]$builder.AppendLine("| --- | --- | --- | --- |")
            foreach ($check in @($report.checks)) {
                $summary = ([string]$check.summary).Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
                $detail = ([string]$check.detail).Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
                [void]$builder.AppendLine("| $(([string]$check.status).ToUpperInvariant()) | $($check.name) | $summary | $detail |")
            }
            $content = $builder.ToString()
        }
        [System.IO.File]::WriteAllText($filePath, $content, (New-Object System.Text.UTF8Encoding($false)))
        return @{ success = $true; filePath = $filePath; folder = $reportsPath }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-OpenSshManagerState {
    $sshCommand = Get-Command ssh.exe -ErrorAction SilentlyContinue
    $keygenCommand = Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue
    $clientState = "NotPresent"
    $serverState = "NotPresent"
    try {
        $clientCapability = Get-WindowsCapability -Online -Name "OpenSSH.Client*" -ErrorAction Stop | Select-Object -First 1
        if ($clientCapability) { $clientState = [string]$clientCapability.State }
        $serverCapability = Get-WindowsCapability -Online -Name "OpenSSH.Server*" -ErrorAction Stop | Select-Object -First 1
        if ($serverCapability) { $serverState = [string]$serverCapability.State }
    }
    catch {
        if ($sshCommand) { $clientState = "Installed" }
    }

    $service = Get-Service sshd -ErrorAction SilentlyContinue
    if ($service -and $serverState -eq "NotPresent") { $serverState = "Installed" }
    $sshFolder = Join-Path $env:USERPROFILE ".ssh"
    $keys = @()
    if (Test-Path $sshFolder) {
        foreach ($publicFile in @(Get-ChildItem -LiteralPath $sshFolder -Filter "*.pub" -File -ErrorAction SilentlyContinue)) {
            $fingerprint = ""
            if ($keygenCommand) {
                try { $fingerprint = ((& $keygenCommand.Source -lf $publicFile.FullName 2>$null) -join " ").Trim() } catch { }
            }
            $keys += [PSCustomObject]@{
                name = [System.IO.Path]::GetFileNameWithoutExtension($publicFile.Name)
                publicPath = $publicFile.FullName
                privateExists = (Test-Path ([System.IO.Path]::ChangeExtension($publicFile.FullName, $null)))
                fingerprint = $fingerprint
                modifiedAt = $publicFile.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
            }
        }
    }

    return [PSCustomObject]@{
        clientState = $clientState
        serverState = $serverState
        sshAvailable = ($null -ne $sshCommand)
        keygenAvailable = ($null -ne $keygenCommand)
        sshPath = if ($sshCommand) { $sshCommand.Source } else { "" }
        serviceInstalled = ($null -ne $service)
        serviceStatus = if ($service) { [string]$service.Status } else { "NotInstalled" }
        serviceStartType = if ($service) { [string]$service.StartType } else { "" }
        sshFolder = $sshFolder
        keys = $keys
        isAdmin = (Test-IsAdmin)
    }
}

function Install-OpenSshCapability([string]$component) {
    if (-not (Test-IsAdmin)) { return @{ success = $false; needsAdmin = $true; error = "Administrator permission is required." } }
    $name = if ($component -eq "server") { "OpenSSH.Server~~~~0.0.1.0" } else { "OpenSSH.Client~~~~0.0.1.0" }
    try {
        $result = Add-WindowsCapability -Online -Name $name -ErrorAction Stop
        return @{ success = $true; state = [string]$result.State; restartNeeded = [bool]$result.RestartNeeded }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

function Set-OpenSshService([string]$action) {
    if (-not (Test-IsAdmin)) { return @{ success = $false; needsAdmin = $true; error = "Administrator permission is required." } }
    if ($action -notin @("start", "stop", "restart", "enable", "disable")) { return @{ success = $false; error = "Unsupported service action." } }
    try {
        $service = Get-Service sshd -ErrorAction Stop
        switch ($action) {
            "start" { Start-Service sshd -ErrorAction Stop }
            "stop" { Stop-Service sshd -Force -ErrorAction Stop }
            "restart" { Restart-Service sshd -Force -ErrorAction Stop }
            "enable" { Set-Service sshd -StartupType Automatic -ErrorAction Stop; if ($service.Status -ne "Running") { Start-Service sshd -ErrorAction Stop } }
            "disable" { Set-Service sshd -StartupType Disabled -ErrorAction Stop; if ($service.Status -eq "Running") { Stop-Service sshd -Force -ErrorAction Stop } }
        }
        $updated = Get-Service sshd
        return @{ success = $true; status = [string]$updated.Status; startType = [string]$updated.StartType }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

function ConvertTo-NativeProcessArgument([string]$value) {
    if ($null -eq $value -or $value.Length -eq 0) { return '""' }
    if ($value -notmatch '[\s"]') { return $value }

    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashCount = 0
    foreach ($character in $value.ToCharArray()) {
        if ($character -eq '\') { $backslashCount++; continue }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashCount * 2) + 1)))
            [void]$builder.Append('"')
        }
        else {
            if ($backslashCount -gt 0) { [void]$builder.Append(('\' * $backslashCount)) }
            [void]$builder.Append($character)
        }
        $backslashCount = 0
    }
    if ($backslashCount -gt 0) { [void]$builder.Append(('\' * ($backslashCount * 2))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function New-OpenSshKey([string]$algorithm, [string]$keyName, [string]$comment) {
    if ($algorithm -notin @("ed25519", "rsa")) { return @{ success = $false; error = "Unsupported key algorithm." } }
    if ($keyName -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" -or $keyName.Contains("..")) { return @{ success = $false; error = "Invalid key name." } }
    $keygen = Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue
    if (-not $keygen) { return @{ success = $false; error = "ssh-keygen.exe is not installed." } }
    try {
        $sshFolder = Join-Path $env:USERPROFILE ".ssh"
        [System.IO.Directory]::CreateDirectory($sshFolder) | Out-Null
        $path = Join-Path $sshFolder $keyName
        if ((Test-Path $path) -or (Test-Path "$path.pub")) { return @{ success = $false; error = "A key with this name already exists." } }
        $arguments = @("-t", $algorithm)
        if ($algorithm -eq "rsa") { $arguments += @("-b", "4096") }
        $arguments += @("-f", $path, "-N", "", "-C", $(if ($comment) { $comment } else { "$env:USERNAME@$env:COMPUTERNAME" }))

        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $keygen.Source
        $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeProcessArgument ([string]$_) }) -join " ")
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $exitCode = $process.ExitCode
        $process.Dispose()
        if ($exitCode -ne 0) { return @{ success = $false; error = ($stdout + $stderr).Trim() } }
        return @{ success = $true; publicPath = "$path.pub"; fingerprint = ((& $keygen.Source -lf "$path.pub" 2>$null) -join " ").Trim() }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

function Get-OpenSshPublicKey([string]$keyName) {
    if ($keyName -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" -or $keyName.Contains("..")) { return @{ success = $false; error = "Invalid key name." } }
    try {
        $path = Join-Path (Join-Path $env:USERPROFILE ".ssh") "$keyName.pub"
        if (-not (Test-Path -LiteralPath $path)) { return @{ success = $false; error = "Public key not found." } }
        return @{ success = $true; content = [System.IO.File]::ReadAllText($path); path = $path }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

function Test-OpenSshEndpoint([string]$hostName, [int]$port = 22, [string]$userName = "") {
    $hostName = $hostName.Trim()
    if ([string]::IsNullOrWhiteSpace($hostName) -or [System.Uri]::CheckHostName($hostName) -eq [System.UriHostNameType]::Unknown -or $port -lt 1 -or $port -gt 65535) { return @{ success = $false; error = "Host or port is invalid." } }
    if ($userName -and $userName -notmatch "^[A-Za-z0-9._-]{1,64}$") { return @{ success = $false; error = "SSH user name is invalid." } }
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($hostName.Trim(), $port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(2500, $false)) { throw "Connection timed out." }
        $client.EndConnect($async)
        $timer.Stop()
        $effective = @{}
        $ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
        if ($ssh) {
            $destination = if ($userName) { "$userName@$hostName" } else { $hostName }
            foreach ($line in @(& $ssh.Source -G -p $port $destination 2>$null)) {
                if ($line -match "^(hostname|user|port|identityfile)\s+(.+)$") {
                    if (-not $effective.ContainsKey($matches[1])) { $effective[$matches[1]] = $matches[2] }
                }
            }
        }
        return @{ success = $true; reachable = $true; latencyMs = [math]::Round($timer.Elapsed.TotalMilliseconds, 1); effective = $effective }
    }
    catch { return @{ success = $true; reachable = $false; latencyMs = [math]::Round($timer.Elapsed.TotalMilliseconds, 1); error = $_.Exception.Message } }
    finally { $client.Close() }
}

function Open-OpenSshFolder {
    try {
        $path = Join-Path $env:USERPROFILE ".ssh"
        [System.IO.Directory]::CreateDirectory($path) | Out-Null
        Start-Process explorer.exe -ArgumentList $path
        return @{ success = $true; path = $path }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

function Get-WslManagerState {
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    $distros = @()
    $defaultId = ""
    $defaultVersion = 2
    $lxssPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
    if (Test-Path $lxssPath) {
        try {
            $root = Get-ItemProperty $lxssPath -ErrorAction SilentlyContinue
            $defaultId = [string]$root.DefaultDistribution
            if ($root.DefaultVersion) { $defaultVersion = [int]$root.DefaultVersion }
            $runningNames = @()
            if ($wsl) { $runningNames = @(& $wsl.Source --list --running --quiet 2>$null | ForEach-Object { ([string]$_).Replace([char]0, "").Trim() } | Where-Object { $_ }) }
            foreach ($key in @(Get-ChildItem $lxssPath -ErrorAction SilentlyContinue)) {
                $item = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
                if (-not $item.DistributionName) { continue }
                $distros += [PSCustomObject]@{
                    id = $key.PSChildName
                    name = [string]$item.DistributionName
                    version = if ($item.Version) { [int]$item.Version } else { 1 }
                    state = if ($runningNames -contains [string]$item.DistributionName) { "Running" } else { "Stopped" }
                    isDefault = ($key.PSChildName -eq $defaultId)
                    basePath = [string]$item.BasePath
                }
            }
        }
        catch { }
    }

    $virtualization = $false
    try { $virtualization = [bool](Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).HypervisorPresent } catch { }
    return [PSCustomObject]@{
        installed = ($null -ne $wsl)
        executable = if ($wsl) { $wsl.Source } else { "" }
        defaultVersion = $defaultVersion
        distros = @($distros | Sort-Object @{ Expression = "isDefault"; Descending = $true }, name)
        virtualization = $virtualization
        isAdmin = (Test-IsAdmin)
    }
}

function Invoke-WslManagerAction([string]$action, [string]$distro = "", [int]$version = 2) {
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $wsl) { return @{ success = $false; error = "wsl.exe is not installed." } }
    if ($distro -and $distro -notmatch "^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$") { return @{ success = $false; error = "Invalid distribution name." } }
    try {
        switch ($action) {
            "setDefault" { & $wsl.Source --set-default $distro | Out-Null }
            "terminate" { & $wsl.Source --terminate $distro | Out-Null }
            "shutdown" { & $wsl.Source --shutdown | Out-Null }
            "setDefaultVersion" { if ($version -notin @(1, 2)) { throw "Invalid WSL version." }; & $wsl.Source --set-default-version $version | Out-Null }
            "open" { Start-Process $wsl.Source -ArgumentList @("-d", $distro); return @{ success = $true; launched = $true } }
            "update" { Start-Process $wsl.Source -ArgumentList "--update"; return @{ success = $true; launched = $true } }
            "install" { Start-Process $wsl.Source -ArgumentList @("--install", "-d", $distro); return @{ success = $true; launched = $true } }
            default { return @{ success = $false; error = "Unsupported WSL action." } }
        }
        if ($LASTEXITCODE -ne 0) { return @{ success = $false; error = "wsl.exe exited with code $LASTEXITCODE." } }
        return @{ success = $true }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

function Get-WslOnlineDistributions {
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $wsl) { return @{ success = $false; error = "wsl.exe is not installed."; items = @() } }
    try {
        $raw = @(& $wsl.Source --list --online 2>&1 | ForEach-Object { ([string]$_).Replace([string][char]0, "") })
        $items = @()
        foreach ($line in $raw) {
            if ($line -match "^\s*([A-Za-z0-9][A-Za-z0-9._-]+)\s{2,}(.+?)\s*$" -and $matches[1] -notin @("NAME", "The")) {
                $items += [PSCustomObject]@{ name = $matches[1]; friendlyName = $matches[2].Trim() }
            }
        }
        return @{ success = $true; items = $items; raw = ($raw -join "`n") }
    }
    catch { return @{ success = $false; error = $_.Exception.Message; items = @() } }
}
