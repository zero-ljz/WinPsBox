param(
    [Parameter(Mandatory = $true)]
    [string]$RequestBase64,
    [Parameter(Mandatory = $true)]
    [string]$EventPathBase64
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$script:AppRoot = Split-Path $PSScriptRoot -Parent
$script:PowerShellRoot = $PSScriptRoot
$dataPath = Join-Path $script:AppRoot "data"
$configFile = Join-Path $dataPath "config.json"
$script:EventPath = $utf8.GetString([Convert]::FromBase64String($EventPathBase64))

function Write-TaskEvent($eventData) {
    $line = ConvertTo-Json -InputObject $eventData -Compress -Depth 12
    [System.IO.File]::AppendAllText($script:EventPath, $line + "`n", $utf8)
}

function New-TaskWorkerResponse([bool]$success, $data = $null, [string]$errorMessage = $null) {
    return [ordered]@{ event = "result"; success = $success; data = $data; error = $errorMessage }
}

. (Join-Path $script:PowerShellRoot "Common.ps1")
. (Join-Path $script:PowerShellRoot "NetworkTools.ps1")
. (Join-Path $script:PowerShellRoot "SystemTools.ps1")
. (Join-Path $script:PowerShellRoot "NetworkDeveloperTools.ps1")
. (Join-Path $script:PowerShellRoot "NetworkInspectionTools.ps1")
. (Join-Path $script:PowerShellRoot "DeveloperAdminTools.ps1")
. (Join-Path $script:PowerShellRoot "RemoteSharingTools.ps1")

$script:AppTaskProgressWriter = {
    param([int]$percent, [string]$message, [string]$detail)
    Write-TaskEvent ([ordered]@{
        event = "progress"
        progress = @{ percent = $percent; message = $message; detail = $detail }
    })
}

try {
    $requestJson = $utf8.GetString([Convert]::FromBase64String($RequestBase64))
    $request = ConvertFrom-Json $requestJson
    $payload = $request.payload
    $action = [string]$request.action
    Write-AppTaskProgress 3 "正在准备任务"

    switch ($action) {
        "net_check_remote_port" {
            $timeout = if ($payload.timeoutMs) { [int]$payload.timeoutMs } else { 1500 }
            $data = @(Test-RemotePorts -hostName ([string]$payload.host) -ports ($payload.ports) -timeoutMs $timeout)
            $response = New-TaskWorkerResponse $true $data
        }
        "net_ping" {
            $count = if ($payload.count) { [int]$payload.count } else { 4 }
            $timeout = if ($payload.timeoutMs) { [int]$payload.timeoutMs } else { 2000 }
            $data = Test-PingAndDns -targetHost ([string]$payload.host) -count $count -timeoutMs $timeout
            $response = New-TaskWorkerResponse $true $data
        }
        "remote_test_profile" {
            Write-AppTaskProgress 25 "正在测试远程端点"
            $result = Test-RemoteConnectionEndpoint -profile $payload.profile
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "net_dns_deep_diagnostic" {
            $result = Invoke-DeepDnsDiagnostic -name ([string]$payload.name) -recordType ([string]$payload.recordType)
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "net_intel_lookup" {
            $result = Get-NetworkIntelligence -target ([string]$payload.target)
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "net_wifi_analyze" {
            $result = Get-WifiAnalysis
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "net_http_redirect_trace" {
            $maxRedirects = if ($payload.maxRedirects) { [int]$payload.maxRedirects } else { 10 }
            $timeout = if ($payload.timeoutMs) { [int]$payload.timeoutMs } else { 10000 }
            $result = Invoke-HttpRedirectTrace -url ([string]$payload.url) -method ([string]$payload.method) -maxRedirects $maxRedirects -timeoutMs $timeout
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "diag_run" {
            $data = Invoke-OneClickDiagnostic -target ([string]$payload.target)
            $response = New-TaskWorkerResponse $true $data
        }
        "ssh_get_status" {
            Write-AppTaskProgress 25 "正在检查 OpenSSH 组件"
            $data = Get-OpenSshManagerState
            $response = New-TaskWorkerResponse $true $data
        }
        "ssh_install_capability" {
            Write-AppTaskProgress 15 "正在安装 Windows 组件" ([string]$payload.component)
            $result = Install-OpenSshCapability -component ([string]$payload.component)
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $result $result.error }
        }
        "wsl_get_status" {
            Write-AppTaskProgress 25 "正在检查 WSL 发行版"
            $data = Get-WslManagerState
            $response = New-TaskWorkerResponse $true $data
        }
        "wsl_get_online" {
            Write-AppTaskProgress 25 "正在加载在线发行版"
            $result = Get-WslOnlineDistributions
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "net_get_portproxy_targets" {
            Write-AppTaskProgress 20 "正在发现转发目标"
            $result = Get-PortProxyTargetCandidates
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "net_scan_lan" {
            $result = Invoke-LanScanner -subnetBase ([string]$payload.subnet)
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "net_check_ssl" {
            $port = if ($payload.port) { [int]$payload.port } else { 443 }
            $timeout = if ($payload.timeoutMs) { [int]$payload.timeoutMs } else { 5000 }
            Write-AppTaskProgress 20 "正在连接 TLS 端点"
            $result = Get-SslCertificateDetails -hostName ([string]$payload.host) -port $port -timeoutMs $timeout
            $response = if ($result.success) { New-TaskWorkerResponse $true $result } else { New-TaskWorkerResponse $false $null $result.error }
        }
        "net_trace_route" {
            $maxHops = if ($payload.maxHops) { [int]$payload.maxHops } else { 20 }
            $timeout = if ($payload.timeoutMs) { [int]$payload.timeoutMs } else { 1500 }
            $data = Invoke-TraceRouteAction -targetHost ([string]$payload.host) -maxHops $maxHops -timeoutMs $timeout
            $response = New-TaskWorkerResponse $true $data
        }
        default {
            $response = New-TaskWorkerResponse $false $null "Unsupported background action."
        }
    }
}
catch {
    $response = New-TaskWorkerResponse $false $null $_.Exception.Message
}

Write-AppTaskProgress 100 "任务已完成"
Write-TaskEvent $response
