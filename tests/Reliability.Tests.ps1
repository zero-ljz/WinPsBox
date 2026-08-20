$repoRoot = Split-Path $PSScriptRoot -Parent

Describe "Application configuration persistence" {
    BeforeEach {
        $script:AppRoot = $TestDrive
        $script:configFile = Join-Path $TestDrive "config.json"
        . (Join-Path $repoRoot "powershell\Common.ps1")
    }

    It "restores the last valid configuration after a partial write" {
        $first = [PSCustomObject]@{
            theme = "dark"
            autoStart = $false
            minimizeToTray = $true
            favorites = @("first")
        }
        $second = [PSCustomObject]@{
            theme = "light"
            autoStart = $false
            minimizeToTray = $false
            favorites = @("second")
        }

        $firstSave = Save-AppConfig $first
        if (-not $firstSave.success) { throw $firstSave.error }
        $secondSave = Save-AppConfig $second
        if (-not $secondSave.success) { throw $secondSave.error }
        [System.IO.File]::WriteAllText($script:configFile, "{broken", [System.Text.Encoding]::UTF8)

        $restored = Get-AppConfig

        $restored.theme | Should Be "dark"
        {
            $restoredJson = [System.IO.File]::ReadAllText($script:configFile, [System.Text.Encoding]::UTF8)
            ConvertFrom-Json -InputObject $restoredJson -ErrorAction Stop | Out-Null
        } | Should Not Throw
    }
}

Describe "Background task event transport" {
    It "reads only newly appended complete event lines" {
        Add-Type -AssemblyName System.Windows.Forms
        $script:dataPath = Join-Path $TestDrive "data"
        $script:PowerShellRoot = Join-Path $repoRoot "powershell"
        . (Join-Path $repoRoot "powershell\TaskBridge.ps1")

        try {
            $eventFile = Join-Path $script:appTaskInstanceEventRoot "probe.ndjson"
            $utf8 = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($eventFile, '{"event":"progress"', $utf8)
            $task = [PSCustomObject]@{
                eventPath = $eventFile
                eventOffset = 0L
                eventBuffer = ""
                transportError = ""
                terminalSent = $false
            }

            @(Read-AppTaskEventLines $task).Count | Should Be 0
            [System.IO.File]::AppendAllText($eventFile, ',"progress":{"percent":25}}' + "`n", $utf8)
            $progressLines = @(Read-AppTaskEventLines $task)
            [System.IO.File]::AppendAllText($eventFile, '{"event":"result","success":true}' + "`n", $utf8)
            $resultLines = @(Read-AppTaskEventLines $task)

            $progressLines.Count | Should Be 1
            (ConvertFrom-Json $progressLines[0]).progress.percent | Should Be 25
            $resultLines.Count | Should Be 1
            (ConvertFrom-Json $resultLines[0]).event | Should Be "result"
            $task.eventBuffer | Should Be ""
        }
        finally {
            $script:appTaskPollTimer.Dispose()
        }
    }
}
