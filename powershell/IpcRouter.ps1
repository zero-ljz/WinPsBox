# WebView2 IPC registration and request routing.
function Register-AppWebViewHandlers($webView) {
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
    
                if ($action -like "winget_*") {
                    $queueResult = Start-WingetWorkerRequest -webViewCore $s -requestId $reqId -action $action -payload $payload
                    if (-not $queueResult.success) {
                        $queueError = @{
                            id = $reqId
                            action = $action
                            success = $false
                            data = $null
                            error = $queueResult.error
                        }
                        $s.PostWebMessageAsJson((ConvertTo-Json -InputObject $queueError -Compress -Depth 10))
                    }
                    return
                }
    
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
                    "set_tray_behavior" {
                        $res = Set-AppTrayBehavior -enabled ([bool]$payload.enabled)
                        if ($res.success) { $response.data = @{ enabled = $script:MinimizeToTray } } else { $response.success = $false; $response.error = $res.error }
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
                            $appScript = Join-Path $script:AppRoot "app.ps1"
                            Start-Process powershell.exe -ArgumentList "-STA -NoProfile -ExecutionPolicy Bypass -File `"$appScript`"" -Verb RunAs
                            $response.data = @{ success = $true; message = "Launching new elevated administrator instance..." }
                            $t = New-Object System.Windows.Forms.Timer
                            $t.Interval = 600
                            $t.Add_Tick({
                                $t.Stop()
                                $script:AllowAppExit = $true
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
                    # Local development certificates
                    "cert_get_defaults" {
                        $response.data = Get-LocalDevCertificateDefaults
                    }
                    "cert_get_ca_status" {
                        $response.data = Get-LocalDevCaStatus
                    }
                    "cert_create_root_ca" {
                        $res = New-LocalDevRootCa -trustScope ([string]$payload.trustScope)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "cert_generate_server" {
                        $res = New-LocalDevServerCertificate `
                            -commonName ([string]$payload.commonName) `
                            -sanEntries @($payload.sans) `
                            -validDays ([int]$payload.validDays) `
                            -pfxPassword ([string]$payload.pfxPassword)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "cert_open_folder" {
                        $res = Open-LocalCertificateFolder -path ([string]$payload.path)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "net_tcp_connect" {
                        $timeout = if ($payload.timeoutMs) { [int]($payload.timeoutMs) } else { 5000 }
                        $res = Connect-DebugTcpSocket -hostName ([string]$payload.host) -port ([int]$payload.port) -timeoutMs $timeout
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "net_tcp_send" {
                        $res = Send-DebugTcpSocket -sessionId ([string]$payload.sessionId) -dataBase64 ([string]$payload.dataBase64)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "net_tcp_receive" {
                        $maxBytes = if ($payload.maxBytes) { [int]$payload.maxBytes } else { 65536 }
                        $res = Receive-DebugTcpSocket -sessionId ([string]$payload.sessionId) -maxBytes $maxBytes
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.data = $res; $response.error = $res.error }
                    }
                    "net_tcp_disconnect" {
                        $response.data = Disconnect-DebugTcpSocket -sessionId ([string]$payload.sessionId)
                    }
                    "net_dns_deep_diagnostic" {
                        $res = Invoke-DeepDnsDiagnostic -name ([string]$payload.name) -recordType ([string]$payload.recordType)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "net_intel_lookup" {
                        $res = Get-NetworkIntelligence -target ([string]$payload.target)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }

                    # Diagnostic reports
                    "diag_run" {
                        $response.data = Invoke-OneClickDiagnostic -target ([string]$payload.target)
                    }
                    "diag_export" {
                        $res = Save-OneClickDiagnosticReport -report $payload.report -format ([string]$payload.format)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }

                    # OpenSSH manager
                    "ssh_get_status" {
                        $response.data = Get-OpenSshManagerState
                    }
                    "ssh_install_capability" {
                        $res = Install-OpenSshCapability -component ([string]$payload.component)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "ssh_service_action" {
                        $res = Set-OpenSshService -action ([string]$payload.serviceAction)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "ssh_generate_key" {
                        $res = New-OpenSshKey -algorithm ([string]$payload.algorithm) -keyName ([string]$payload.keyName) -comment ([string]$payload.comment)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "ssh_read_public_key" {
                        $res = Get-OpenSshPublicKey -keyName ([string]$payload.keyName)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "ssh_test_endpoint" {
                        $res = Test-OpenSshEndpoint -hostName ([string]$payload.host) -port ([int]$payload.port) -userName ([string]$payload.user)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "ssh_open_folder" {
                        $res = Open-OpenSshFolder
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }

                    # WSL manager
                    "wsl_get_status" {
                        $response.data = Get-WslManagerState
                    }
                    "wsl_action" {
                        $res = Invoke-WslManagerAction -action ([string]$payload.wslAction) -distro ([string]$payload.distro) -version ([int]$payload.version)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "wsl_get_online" {
                        $res = Get-WslOnlineDistributions
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
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

                    # PortProxy (v4tov4) Manager
                    "net_get_portproxy_rules" {
                        $res = Get-PortProxyV4ToV4Rules
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "net_get_portproxy_targets" {
                        $res = Get-PortProxyTargetCandidates
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "net_add_portproxy_rule" {
                        $res = Add-PortProxyV4ToV4Rule `
                            -listenAddress ([string]$payload.listenAddress) `
                            -listenPort ([int]$payload.listenPort) `
                            -connectAddress ([string]$payload.connectAddress) `
                            -connectPort ([int]$payload.connectPort)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "net_remove_portproxy_rule" {
                        $res = Remove-PortProxyV4ToV4Rule `
                            -listenAddress ([string]$payload.listenAddress) `
                            -listenPort ([int]$payload.listenPort)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "net_start_portproxy_service" {
                        $res = Start-PortProxyIpHelperService
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
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
    
                    # 9. File Lock Hunter
                    "sys_get_file_locks" {
                        $path = [string]($payload.path)
                        $res = Get-FileLockingDetails -path $path
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
    
                    # 12. Scheduled Tasks Center
                    "sys_get_scheduled_tasks" {
                        $response.data = Get-ToolboxScheduledTasks
                    }
                    "sys_create_scheduled_task" {
                        $res = New-ToolboxScheduledTask `
                            -name ([string]$payload.name) `
                            -actionKey ([string]$payload.taskAction) `
                            -scheduleType ([string]$payload.scheduleType) `
                            -runAt ([string]$payload.runAt) `
                            -programPath ([string]$payload.programPath) `
                            -arguments ([string]$payload.arguments) `
                            -workingDirectory ([string]$payload.workingDirectory)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "sys_set_scheduled_task_state" {
                        $res = Set-ToolboxScheduledTaskState -taskName ([string]$payload.id) -enabled ([bool]$payload.enabled)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "sys_remove_scheduled_task" {
                        $res = Remove-ToolboxScheduledTask -taskName ([string]$payload.id)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }

                    # 13. Context Menu Manager
                    "sys_get_context_menu_items" {
                        $response.data = Get-ContextMenuItems
                    }
                    "sys_set_context_menu_item_state" {
                        $res = Set-ContextMenuItemState `
                            -type ([string]$payload.type) `
                            -registryPath ([string]$payload.registryPath) `
                            -clsid ([string]$payload.clsid) `
                            -enabled ([bool]$payload.enabled)
                        if ($res.success) { $response.data = $res } else { $response.success = $false; $response.error = $res.error }
                    }
                    "sys_open_context_menu_registry" {
                        $res = Open-ContextMenuRegistryPath -registryPath ([string]$payload.registryPath)
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
}
