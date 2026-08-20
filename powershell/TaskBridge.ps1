# Runs long-lived IPC actions outside the WinForms UI thread and relays task events.
$script:pendingAppTasks = New-Object System.Collections.ArrayList
$script:appTaskWorkerPath = Join-Path $script:PowerShellRoot "AppTaskWorker.ps1"
$script:wingetWorkerPath = Join-Path $script:PowerShellRoot "WingetWorker.ps1"
$script:appTaskEventRoot = Join-Path $dataPath "TaskEvents"
$script:appTaskInstanceEventRoot = Join-Path $script:appTaskEventRoot ([string]$PID)
$script:appTaskPollTimer = New-Object System.Windows.Forms.Timer
$script:appTaskPollTimer.Interval = 100
[System.IO.Directory]::CreateDirectory($script:appTaskEventRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($script:appTaskInstanceEventRoot) | Out-Null
foreach ($staleDirectory in @(Get-ChildItem -LiteralPath $script:appTaskEventRoot -Directory -ErrorAction SilentlyContinue)) {
    $ownerPid = 0
    if (-not [int]::TryParse($staleDirectory.Name, [ref]$ownerPid) -or $ownerPid -eq $PID) { continue }
    if ($null -eq (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $staleDirectory.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$script:backgroundAppActions = @(
    "net_check_remote_port",
    "net_ping",
    "remote_test_profile",
    "net_dns_deep_diagnostic",
    "net_intel_lookup",
    "net_wifi_analyze",
    "net_http_redirect_trace",
    "diag_run",
    "ssh_get_status",
    "ssh_install_capability",
    "wsl_get_status",
    "wsl_get_online",
    "net_get_portproxy_targets",
    "net_scan_lan",
    "net_check_ssl",
    "net_trace_route"
)

function Test-AppBackgroundAction([string]$action) {
    return $action -like "winget_*" -or $script:backgroundAppActions -contains $action
}

function Send-AppTaskMessage($task, $message) {
    try {
        $message["id"] = $task.requestId
        $message["action"] = $task.action
        $message["taskId"] = $task.requestId
        $task.webViewCore.PostWebMessageAsJson((ConvertTo-Json -InputObject $message -Compress -Depth 12))
    }
    catch { }
}

function Complete-AppTask($task, [bool]$success, $data = $null, [string]$errorMessage = $null, [bool]$cancelled = $false) {
    if ($task.terminalSent) { return }
    $task.terminalSent = $true
    Send-AppTaskMessage $task ([ordered]@{
        event = "result"
        success = $success
        data = $data
        error = $errorMessage
        cancelled = $cancelled
    })
}

function Read-AppTaskEventLines($task) {
    if (-not (Test-Path -LiteralPath $task.eventPath -PathType Leaf)) { return @() }

    $stream = $null
    $reader = $null
    try {
        $stream = New-Object System.IO.FileStream(
            $task.eventPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        if ($task.eventOffset -gt $stream.Length) {
            $task.eventOffset = 0L
            $task.eventBuffer = ""
        }
        [void]$stream.Seek([int64]$task.eventOffset, [System.IO.SeekOrigin]::Begin)
        $reader = New-Object System.IO.StreamReader($stream, (New-Object System.Text.UTF8Encoding($false)), $false)
        $chunk = $reader.ReadToEnd()
        $task.eventOffset = $stream.Position
    }
    finally {
        if ($reader) { $reader.Dispose() }
        elseif ($stream) { $stream.Dispose() }
    }

    if ([string]::IsNullOrEmpty($chunk)) { return @() }
    $pending = [string]$task.eventBuffer + $chunk
    $lines = New-Object System.Collections.Generic.List[string]
    while (($newlineIndex = $pending.IndexOf("`n", [System.StringComparison]::Ordinal)) -ge 0) {
        $line = $pending.Substring(0, $newlineIndex).TrimEnd("`r")
        $pending = $pending.Substring($newlineIndex + 1)
        if (-not [string]::IsNullOrWhiteSpace($line)) { $lines.Add($line) }
    }
    $task.eventBuffer = $pending
    return @($lines)
}

function Receive-AppTaskEvent($task, [string]$line) {
    try {
        $workerEvent = ConvertFrom-Json $line -ErrorAction Stop
        if ($workerEvent.event -eq "progress" -and -not $task.terminalSent) {
            Send-AppTaskMessage $task ([ordered]@{ event = "progress"; progress = $workerEvent.progress })
        }
        elseif ($workerEvent.event -eq "result") {
            Complete-AppTask $task ([bool]$workerEvent.success) $workerEvent.data ([string]$workerEvent.error) ([bool]$workerEvent.cancelled)
        }
        return $true
    }
    catch {
        $task.transportError = "Failed to parse a background task event: $($_.Exception.Message)"
        return $false
    }
}

function Start-AppTaskRequest($webViewCore, [string]$requestId, [string]$action, $payload) {
    $process = $null
    $eventPath = $null
    try {
        $workerPath = if ($action -like "winget_*") { $script:wingetWorkerPath } else { $script:appTaskWorkerPath }
        if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) {
            throw "Task worker script was not found: $workerPath"
        }

        $requestJson = ConvertTo-Json -InputObject @{ action = $action; payload = $payload } -Compress -Depth 12
        $requestBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($requestJson))
        $eventPath = Join-Path $script:appTaskInstanceEventRoot (([Guid]::NewGuid().ToString("N")) + ".ndjson")
        [System.IO.File]::WriteAllText($eventPath, "", (New-Object System.Text.UTF8Encoding($false)))
        $eventPathBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($eventPath))
        $hostExecutable = (Get-Process -Id $PID).Path

        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $hostExecutable
        $startInfo.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$workerPath`" -RequestBase64 $requestBase64 -EventPathBase64 $eventPathBase64"
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        $startInfo.StandardOutputEncoding = $utf8
        $startInfo.StandardErrorEncoding = $utf8

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()

        $task = [PSCustomObject]@{
            process = $process
            stdoutTask = $process.StandardOutput.ReadToEndAsync()
            stderrTask = $process.StandardError.ReadToEndAsync()
            webViewCore = $webViewCore
            requestId = $requestId
            action = $action
            eventPath = $eventPath
            eventOffset = 0L
            eventBuffer = ""
            transportError = ""
            terminalSent = $false
            exitObservedAt = $null
        }
        [void]$script:pendingAppTasks.Add($task)
        Send-AppTaskMessage $task ([ordered]@{
            event = "started"
            progress = @{ percent = 0; message = "任务已启动"; detail = "" }
        })
        if (-not $script:appTaskPollTimer.Enabled) { $script:appTaskPollTimer.Start() }
        return @{ success = $true; taskId = $requestId }
    }
    catch {
        if ($process) { $process.Dispose() }
        if ($eventPath) { Remove-Item -LiteralPath $eventPath -Force -ErrorAction SilentlyContinue }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Stop-AppTaskProcess($task) {
    try {
        if (-not $task.process.HasExited) {
            $taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"
            & $taskkill /PID ([int]$task.process.Id) /T /F 2>$null | Out-Null
            if (-not $task.process.WaitForExit(1500)) { $task.process.Kill() }
        }
    }
    catch {
        try { if (-not $task.process.HasExited) { $task.process.Kill() } } catch { }
    }
}

function Stop-AppTaskRequest([string]$taskId) {
    $task = @($script:pendingAppTasks | Where-Object { $_.requestId -eq $taskId -and -not $_.terminalSent } | Select-Object -First 1)
    if (-not $task.Count) { return @{ success = $false; error = "Task is no longer running." } }

    $targetTask = $task[0]
    Stop-AppTaskProcess $targetTask
    Complete-AppTask $targetTask $false $null "任务已取消。" $true
    return @{ success = $true; taskId = $taskId }
}

function Remove-CompletedAppTask($task) {
    try { $task.process.Dispose() } catch { }
    try { Remove-Item -LiteralPath $task.eventPath -Force -ErrorAction SilentlyContinue } catch { }
    [void]$script:pendingAppTasks.Remove($task)
}

$script:appTaskPollTimer.Add_Tick({
    foreach ($task in @($script:pendingAppTasks)) {
        try {
            foreach ($line in @(Read-AppTaskEventLines $task)) {
                [void](Receive-AppTaskEvent $task $line)
            }
        }
        catch {
            $task.transportError = "Failed to read background task events: $($_.Exception.Message)"
        }

        $hasExited = $false
        try { $hasExited = $task.process.HasExited } catch { $hasExited = $true }
        if ($hasExited -and -not $task.exitObservedAt) { $task.exitObservedAt = [DateTime]::UtcNow }

        if ($hasExited -and -not $task.terminalSent -and -not [string]::IsNullOrWhiteSpace([string]$task.eventBuffer)) {
            [void](Receive-AppTaskEvent $task ([string]$task.eventBuffer))
            $task.eventBuffer = ""
        }

        if ($hasExited -and -not $task.terminalSent -and (([DateTime]::UtcNow - $task.exitObservedAt).TotalMilliseconds -ge 500)) {
            $stderr = ""
            try { $stderr = $task.stderrTask.GetAwaiter().GetResult().Trim() } catch { }
            $message = if ($stderr) { $stderr } elseif ($task.transportError) { $task.transportError } else { "后台任务进程未返回结果。" }
            Complete-AppTask $task $false $null $message $false
        }

        if ($hasExited -and $task.terminalSent) { Remove-CompletedAppTask $task }
    }

    if ($script:pendingAppTasks.Count -eq 0) { $script:appTaskPollTimer.Stop() }
})

function Stop-AllAppTasks {
    $script:appTaskPollTimer.Stop()
    foreach ($task in @($script:pendingAppTasks)) {
        Stop-AppTaskProcess $task
        Remove-CompletedAppTask $task
    }
    if (Test-Path -LiteralPath $script:appTaskInstanceEventRoot -PathType Container) {
        Remove-Item -LiteralPath $script:appTaskInstanceEventRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
