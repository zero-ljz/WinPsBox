# Winget requests run in a separate PowerShell process so WebView messages never block the UI thread.
$script:pendingWingetRequests = New-Object System.Collections.ArrayList
$script:wingetWorkerPath = Join-Path $script:PowerShellRoot "WingetWorker.ps1"
$script:wingetPollTimer = New-Object System.Windows.Forms.Timer
$script:wingetPollTimer.Interval = 100

function Start-WingetWorkerRequest($webViewCore, [string]$requestId, [string]$action, $payload) {
    $process = $null
    try {
        if (-not (Test-Path $script:wingetWorkerPath)) {
            throw "WinGet worker script was not found."
        }

        $requestJson = ConvertTo-Json -InputObject @{ action = $action; payload = $payload } -Compress -Depth 10
        $requestBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($requestJson))
        $hostExecutable = (Get-Process -Id $PID).Path

        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $hostExecutable
        $startInfo.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$script:wingetWorkerPath`" -RequestBase64 $requestBase64"
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

        [void]$script:pendingWingetRequests.Add([PSCustomObject]@{
            process = $process
            stdoutTask = $process.StandardOutput.ReadToEndAsync()
            stderrTask = $process.StandardError.ReadToEndAsync()
            webViewCore = $webViewCore
            requestId = $requestId
            action = $action
        })
        if (-not $script:wingetPollTimer.Enabled) { $script:wingetPollTimer.Start() }
        return @{ success = $true }
    }
    catch {
        if ($process) { $process.Dispose() }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

$script:wingetPollTimer.Add_Tick({
    foreach ($pending in @($script:pendingWingetRequests)) {
        if (-not $pending.process.HasExited) { continue }

        try {
            $stdout = $pending.stdoutTask.GetAwaiter().GetResult()
            $stderr = $pending.stderrTask.GetAwaiter().GetResult()
            if ([string]::IsNullOrWhiteSpace($stdout)) {
                throw $(if ([string]::IsNullOrWhiteSpace($stderr)) { "WinGet worker returned no response." } else { $stderr.Trim() })
            }

            $workerResponse = ConvertFrom-Json $stdout
            $response = [ordered]@{
                id = $pending.requestId
                action = $pending.action
                success = [bool]$workerResponse.success
                data = $workerResponse.data
                error = $workerResponse.error
            }
        }
        catch {
            $response = [ordered]@{
                id = $pending.requestId
                action = $pending.action
                success = $false
                data = $null
                error = $_.Exception.Message
            }
        }

        try {
            $responseJson = ConvertTo-Json -InputObject $response -Compress -Depth 10
            $pending.webViewCore.PostWebMessageAsJson($responseJson)
        }
        catch { }
        finally {
            $pending.process.Dispose()
            [void]$script:pendingWingetRequests.Remove($pending)
        }
    }

    if ($script:pendingWingetRequests.Count -eq 0) { $script:wingetPollTimer.Stop() }
})
