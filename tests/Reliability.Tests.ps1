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

Describe "Backend input validation and safe persistence" {
    BeforeEach {
        $script:AppRoot = $TestDrive
        . (Join-Path $repoRoot "powershell\Common.ps1")
        $script:hostsPath = Join-Path $TestDrive "hosts"
        [System.IO.File]::WriteAllText($script:hostsPath, "127.0.0.1 localhost`n", (New-Object System.Text.UTF8Encoding($false)))
        . (Join-Path $repoRoot "powershell\SystemTools.ps1")
        . (Join-Path $repoRoot "powershell\NetworkTools.ps1")
        . (Join-Path $repoRoot "powershell\DeveloperAdminTools.ps1")
    }

    It "rejects an empty Hosts payload without changing the file" {
        $before = [System.IO.File]::ReadAllText($script:hostsPath)

        $result = Save-HostsInfo -content ""

        $result.success | Should Be $false
        [System.IO.File]::ReadAllText($script:hostsPath) | Should Be $before
        Test-Path "$($script:hostsPath).winpsbox.bak" | Should Be $false
    }

    It "backs up and verifies a valid Hosts write" {
        $before = [System.IO.File]::ReadAllText($script:hostsPath)
        $updated = "127.0.0.1 localhost`n127.0.0.1 winpsbox-e2e.local`n"

        $result = Save-HostsInfo -content $updated

        $result.success | Should Be $true
        [System.IO.File]::ReadAllText($script:hostsPath) | Should Be $updated
        [System.IO.File]::ReadAllText("$($script:hostsPath).winpsbox.bak") | Should Be $before
    }

    It "rejects unknown service actions before requesting elevation" {
        $result = Set-WinServiceStatus -serviceName "__WINPSBOX_E2E_MISSING__" -action "invalid"

        $result.success | Should Be $false
        [string]::IsNullOrWhiteSpace([string]$result.error) | Should Be $false
    }

    It "accepts JSON Int64 port values" {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $listener.Start()
        try {
            $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
            $payload = ConvertFrom-Json (ConvertTo-Json @{ ports = @($port) } -Compress)

            $results = @(Test-RemotePorts -hostName "127.0.0.1" -ports ($payload.ports) -timeoutMs 1000)

            $results.Count | Should Be 1
            $results[0].port | Should Be $port
            $results[0].isOpen | Should Be $true
        }
        finally {
            $listener.Stop()
        }
    }

    It "passes an empty passphrase to ssh-keygen correctly" {
        if (-not (Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue)) { return }
        $originalUserProfile = $env:USERPROFILE
        $env:USERPROFILE = $TestDrive
        try {
            $result = New-OpenSshKey -algorithm "ed25519" -keyName "winpsbox-e2e" -comment "WinPsBox E2E"

            $result.success | Should Be $true
            Test-Path (Join-Path $TestDrive ".ssh\winpsbox-e2e") | Should Be $true
            Test-Path (Join-Path $TestDrive ".ssh\winpsbox-e2e.pub") | Should Be $true
        }
        finally {
            $env:USERPROFILE = $originalUserProfile
        }
    }
}
