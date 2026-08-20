# Remote connection profiles and Windows SMB share management.
$script:remoteSharingModulePath = $MyInvocation.MyCommand.Path
$script:remoteConnectionsFile = if ($dataPath) { Join-Path $dataPath "remote-connections.json" } else { "" }

function Test-RemoteConnectionHost([string]$hostName) {
    if ([string]::IsNullOrWhiteSpace($hostName) -or $hostName.Length -gt 255) { return $false }
    $candidate = $hostName.Trim()
    if ($candidate.StartsWith("[") -and $candidate.EndsWith("]")) {
        $candidate = $candidate.Substring(1, $candidate.Length - 2)
    }
    return [System.Uri]::CheckHostName($candidate) -ne [System.UriHostNameType]::Unknown
}

function ConvertTo-NormalizedRemoteHost([string]$hostName) {
    $candidate = $hostName.Trim()
    if ($candidate.StartsWith("[") -and $candidate.EndsWith("]")) {
        return $candidate.Substring(1, $candidate.Length - 2)
    }
    return $candidate
}

function Test-RemoteConnectionUser([string]$userName) {
    if ([string]::IsNullOrWhiteSpace($userName)) { return $true }
    return $userName.Length -le 128 -and $userName -match '^[A-Za-z0-9._@\\-]+$'
}

function Test-SmbShareName([string]$shareName) {
    if ([string]::IsNullOrWhiteSpace($shareName) -or $shareName.Length -gt 80) { return $false }
    if ($shareName.EndsWith(".") -or $shareName.Contains([char]0)) { return $false }
    return $shareName -notmatch '[\\/\[\]:|<>+=;,?*\"]'
}

function Write-RemoteConnectionProfiles($profiles) {
    $tempFile = $null
    try {
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $script:remoteConnectionsFile)) | Out-Null
        $json = ConvertTo-Json -InputObject @($profiles) -Depth 8
        [void](ConvertFrom-Json $json -ErrorAction Stop)
        $tempFile = "$($script:remoteConnectionsFile).$([Guid]::NewGuid().ToString('N')).tmp"
        [System.IO.File]::WriteAllText($tempFile, $json, (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $script:remoteConnectionsFile -PathType Leaf) {
            [System.IO.File]::Replace($tempFile, $script:remoteConnectionsFile, "$($script:remoteConnectionsFile).bak", $true)
        }
        else {
            [System.IO.File]::Move($tempFile, $script:remoteConnectionsFile)
        }
        $tempFile = $null
        return @{ success = $true }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
    finally {
        if ($tempFile -and (Test-Path -LiteralPath $tempFile)) {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-RemoteConnectionProfiles {
    foreach ($candidate in @($script:remoteConnectionsFile, "$($script:remoteConnectionsFile).bak")) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $raw = [System.IO.File]::ReadAllText($candidate, [System.Text.Encoding]::UTF8)
            if ($raw -match '^\s*\[\s*\]\s*$') { return }
            $parsed = ConvertFrom-Json $raw -ErrorAction Stop
            $items = New-Object System.Collections.ArrayList
            if ($parsed -is [System.Array]) {
                for ($index = 0; $index -lt $parsed.Count; $index++) { [void]$items.Add($parsed[$index]) }
            }
            elseif ($null -ne $parsed) {
                [void]$items.Add($parsed)
            }
            if ($candidate.EndsWith(".bak")) { [void](Write-RemoteConnectionProfiles $items.ToArray()) }
            foreach ($item in @($items | Sort-Object @{ Expression = { if ($_.lastUsedAt) { [datetime]$_.lastUsedAt } else { [datetime]::MinValue } }; Descending = $true }, name)) {
                Write-Output $item
            }
            return
        }
        catch { }
    }
    return @()
}

function Save-RemoteConnectionProfile($profile) {
    $type = ([string]$profile.type).ToLowerInvariant()
    $name = ([string]$profile.name).Trim()
    $hostName = ConvertTo-NormalizedRemoteHost ([string]$profile.host)
    $userName = ([string]$profile.userName).Trim()
    $shareName = ([string]$profile.shareName).Trim().TrimStart('\')
    if ($type -notin @("rdp", "ssh", "smb")) { return @{ success = $false; error = "Unsupported connection type." } }
    if ([string]::IsNullOrWhiteSpace($name) -or $name.Length -gt 80) { return @{ success = $false; error = "Connection name is required and must not exceed 80 characters." } }
    if (-not (Test-RemoteConnectionHost $hostName)) { return @{ success = $false; error = "Invalid host name or IP address." } }
    if (-not (Test-RemoteConnectionUser $userName)) { return @{ success = $false; error = "The user name contains unsupported characters." } }
    if ($type -eq "smb" -and -not (Test-SmbShareName $shareName)) { return @{ success = $false; error = "Invalid share name." } }

    $defaultPort = if ($type -eq "rdp") { 3389 } elseif ($type -eq "ssh") { 22 } else { 445 }
    $port = $defaultPort
    if ($null -ne $profile.port -and -not [string]::IsNullOrWhiteSpace([string]$profile.port)) {
        try { $port = [int]$profile.port } catch { return @{ success = $false; error = "Port must be a number." } }
    }
    if ($port -lt 1 -or $port -gt 65535) { return @{ success = $false; error = "Port must be between 1 and 65535." } }

    $profiles = @(Get-RemoteConnectionProfiles)
    $id = ([string]$profile.id).Trim()
    if ($id -and $id -notmatch '^[a-fA-F0-9-]{36}$') { return @{ success = $false; error = "Invalid connection ID." } }
    if (-not $id) { $id = [Guid]::NewGuid().ToString() }
    $existing = $profiles | Where-Object { $_.id -eq $id } | Select-Object -First 1
    $now = [datetime]::UtcNow.ToString("o")
    $saved = [PSCustomObject][ordered]@{
        id = $id
        name = $name
        type = $type
        host = $hostName
        port = $port
        userName = if ($type -eq "smb") { "" } else { $userName }
        shareName = if ($type -eq "smb") { $shareName } else { "" }
        notes = ([string]$profile.notes).Trim().Substring(0, [Math]::Min(([string]$profile.notes).Trim().Length, 300))
        createdAt = if ($existing -and $existing.createdAt) { [string]$existing.createdAt } else { $now }
        updatedAt = $now
        lastUsedAt = if ($existing) { [string]$existing.lastUsedAt } else { "" }
    }
    $updated = @($profiles | Where-Object { $_.id -ne $id }) + @($saved)
    $write = Write-RemoteConnectionProfiles $updated
    if (-not $write.success) { return $write }
    return @{ success = $true; profile = $saved }
}

function Remove-RemoteConnectionProfile([string]$profileId) {
    if ($profileId -notmatch '^[a-fA-F0-9-]{36}$') { return @{ success = $false; error = "Invalid connection ID." } }
    $profiles = @(Get-RemoteConnectionProfiles)
    if (-not ($profiles | Where-Object { $_.id -eq $profileId })) { return @{ success = $false; error = "Connection profile was not found." } }
    $write = Write-RemoteConnectionProfiles @($profiles | Where-Object { $_.id -ne $profileId })
    if (-not $write.success) { return $write }
    return @{ success = $true; id = $profileId }
}

function Test-RemoteConnectionEndpoint($profile) {
    $hostName = ConvertTo-NormalizedRemoteHost ([string]$profile.host)
    if (-not (Test-RemoteConnectionHost $hostName)) { return @{ success = $false; error = "Invalid host name or IP address." } }
    $port = 0
    if (-not [int]::TryParse([string]$profile.port, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        return @{ success = $false; error = "Port must be between 1 and 65535." }
    }
    $addresses = @()
    try { $addresses = @([System.Net.Dns]::GetHostAddresses($hostName) | ForEach-Object { $_.IPAddressToString }) } catch { }
    $client = New-Object System.Net.Sockets.TcpClient
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $reachable = $false
    try {
        $pending = $client.BeginConnect($hostName, $port, $null, $null)
        if ($pending.AsyncWaitHandle.WaitOne(2500, $false)) {
            $client.EndConnect($pending)
            $reachable = $client.Connected
        }
    }
    catch { }
    finally {
        $watch.Stop()
        $client.Close()
    }
    return @{ success = $true; reachable = $reachable; host = $hostName; port = $port; addresses = $addresses; latencyMs = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1) }
}

function Open-RemoteConnectionProfile($profile) {
    $type = ([string]$profile.type).ToLowerInvariant()
    $hostName = ConvertTo-NormalizedRemoteHost ([string]$profile.host)
    $userName = ([string]$profile.userName).Trim()
    if ($type -notin @("rdp", "ssh", "smb") -or -not (Test-RemoteConnectionHost $hostName)) {
        return @{ success = $false; error = "Invalid connection parameters." }
    }
    if (-not (Test-RemoteConnectionUser $userName)) { return @{ success = $false; error = "The user name contains unsupported characters." } }
    $defaultPort = if ($type -eq "rdp") { 3389 } elseif ($type -eq "ssh") { 22 } else { 445 }
    $port = $defaultPort
    if ($null -ne $profile.port -and -not [string]::IsNullOrWhiteSpace([string]$profile.port) -and -not [int]::TryParse([string]$profile.port, [ref]$port)) { return @{ success = $false; error = "Invalid port." } }
    if ($port -lt 1 -or $port -gt 65535) { return @{ success = $false; error = "Invalid port." } }
    try {
        if ($type -eq "rdp") {
            $rdpHost = if ($hostName.Contains(":")) { "[$hostName]" } else { $hostName }
            if ($userName) {
                $rdpDirectory = Join-Path $dataPath "RemoteSessions"
                [System.IO.Directory]::CreateDirectory($rdpDirectory) | Out-Null
                foreach ($staleFile in @(Get-ChildItem -LiteralPath $rdpDirectory -Filter "*.rdp" -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -lt [datetime]::UtcNow.AddDays(-7) })) {
                    Remove-Item -LiteralPath $staleFile.FullName -Force -ErrorAction SilentlyContinue
                }
                $sessionName = if ([string]$profile.id -match '^[a-fA-F0-9-]{36}$') { [string]$profile.id } else { [Guid]::NewGuid().ToString() }
                $rdpFile = Join-Path $rdpDirectory "$sessionName.rdp"
                $rdpSettings = @(
                    "full address:s:$rdpHost`:$port",
                    "username:s:$userName",
                    "prompt for credentials:i:1",
                    "screen mode id:i:2"
                )
                [System.IO.File]::WriteAllLines($rdpFile, $rdpSettings, [System.Text.Encoding]::Unicode)
                Start-Process "$env:SystemRoot\System32\mstsc.exe" -ArgumentList "`"$rdpFile`"" | Out-Null
            }
            else {
                Start-Process "$env:SystemRoot\System32\mstsc.exe" -ArgumentList "/v:$rdpHost`:$port" | Out-Null
            }
            $target = "$rdpHost`:$port"
        }
        elseif ($type -eq "ssh") {
            $ssh = Get-Command ssh.exe -ErrorAction SilentlyContinue
            if (-not $ssh) { return @{ success = $false; error = "The OpenSSH client is not installed." } }
            $endpoint = if ($userName) { "$userName@$hostName" } else { $hostName }
            Start-Process $ssh.Source -ArgumentList @("-p", [string]$port, $endpoint) | Out-Null
            $target = $endpoint
        }
        else {
            $shareName = ([string]$profile.shareName).Trim().TrimStart('\')
            if (-not (Test-SmbShareName $shareName)) { return @{ success = $false; error = "Invalid share name." } }
            $target = "\\$hostName\$shareName"
            Start-Process explorer.exe -ArgumentList $target | Out-Null
        }

        $profileId = [string]$profile.id
        if ($profileId -match '^[a-fA-F0-9-]{36}$') {
            $profiles = @(Get-RemoteConnectionProfiles)
            $stored = $profiles | Where-Object { $_.id -eq $profileId } | Select-Object -First 1
            if ($stored) {
                $stored.lastUsedAt = [datetime]::UtcNow.ToString("o")
                [void](Write-RemoteConnectionProfiles $profiles)
            }
        }
        return @{ success = $true; launched = $true; type = $type; target = $target }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-SmbShareManagerState {
    $getShare = Get-Command Get-SmbShare -ErrorAction SilentlyContinue
    if (-not $getShare) {
        return @{ available = $false; isAdmin = (Test-IsAdmin); computerName = $env:COMPUTERNAME; currentUser = "$env:USERDOMAIN\$env:USERNAME"; shares = @(); sessions = @(); openFiles = @(); error = "SMB management commands are unavailable on this Windows version." }
    }
    $shares = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($share in @(Get-SmbShare -ErrorAction SilentlyContinue)) {
        $access = @()
        try {
            $access = @(Get-SmbShareAccess -Name $share.Name -ErrorAction Stop | ForEach-Object {
                [PSCustomObject]@{ accountName = $_.AccountName; accessControlType = [string]$_.AccessControlType; accessRight = [string]$_.AccessRight }
            })
        }
        catch { }
        $shares.Add([PSCustomObject]@{
            name = [string]$share.Name
            path = [string]$share.Path
            description = [string]$share.Description
            currentUsers = [int]$share.CurrentUsers
            concurrentUserLimit = [int64]$share.ConcurrentUserLimit
            encryptData = [bool]$share.EncryptData
            folderEnumerationMode = [string]$share.FolderEnumerationMode
            cachingMode = [string]$share.CachingMode
            special = [bool]$share.Special
            uncPath = "\\$env:COMPUTERNAME\$($share.Name)"
            access = $access
        })
    }

    $sessions = @()
    $sessionError = ""
    try {
        $sessions = @(Get-SmbSession -ErrorAction Stop | ForEach-Object {
            [PSCustomObject]@{ sessionId = [string]$_.SessionId; clientComputerName = [string]$_.ClientComputerName; clientUserName = [string]$_.ClientUserName; numOpens = [int]$_.NumOpens; secondsIdle = [int64]$_.SecondsIdle; secondsExists = [int64]$_.SecondsExists }
        })
    }
    catch { $sessionError = $_.Exception.Message }

    $openFiles = @()
    $openFileError = ""
    try {
        $openFiles = @(Get-SmbOpenFile -ErrorAction Stop | ForEach-Object {
            [PSCustomObject]@{ fileId = [string]$_.FileId; sessionId = [string]$_.SessionId; clientComputerName = [string]$_.ClientComputerName; clientUserName = [string]$_.ClientUserName; path = [string]$_.Path; shareRelativePath = [string]$_.ShareRelativePath; locks = [int]$_.Locks }
        })
    }
    catch { $openFileError = $_.Exception.Message }

    return @{
        available = $true
        isAdmin = (Test-IsAdmin)
        computerName = $env:COMPUTERNAME
        currentUser = "$env:USERDOMAIN\$env:USERNAME"
        shares = @($shares)
        sessions = $sessions
        openFiles = $openFiles
        sessionError = $sessionError
        openFileError = $openFileError
    }
}

function Invoke-SmbAdminOperation([string]$operation, $payload) {
    try {
        switch ($operation) {
            "create" {
                $name = ([string]$payload.name).Trim()
                $path = ([string]$payload.path).Trim()
                $description = ([string]$payload.description).Trim()
                $accessRight = ([string]$payload.accessRight)
                $accounts = @($payload.accounts | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
                if (-not (Test-SmbShareName $name)) { throw "Invalid share name." }
                if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "The shared folder does not exist." }
                if ($accounts.Count -eq 0) { throw "At least one access account is required." }
                if ($accessRight -notin @("Read", "Change", "Full")) { throw "Invalid access right." }
                if (Get-SmbShare -Name $name -ErrorAction SilentlyContinue) { throw "A share with this name already exists." }
                $params = @{ Name = $name; Path = (Resolve-Path -LiteralPath $path).Path; Description = $description; CachingMode = "None"; ErrorAction = "Stop" }
                if ($accessRight -eq "Full") { $params.FullAccess = $accounts }
                elseif ($accessRight -eq "Change") { $params.ChangeAccess = $accounts }
                else { $params.ReadAccess = $accounts }
                New-SmbShare @params | Out-Null
                return @{ success = $true; message = "Share created." }
            }
            "remove" {
                $name = ([string]$payload.name).Trim()
                if (-not (Test-SmbShareName $name)) { throw "Invalid share name." }
                $share = Get-SmbShare -Name $name -ErrorAction Stop
                if ($share.Special) { throw "Windows system shares cannot be removed." }
                Remove-SmbShare -Name $name -Force -ErrorAction Stop
                return @{ success = $true; message = "Share removed." }
            }
            "grant" {
                $name = ([string]$payload.name).Trim()
                $account = ([string]$payload.account).Trim()
                $accessRight = [string]$payload.accessRight
                if (-not (Test-SmbShareName $name) -or [string]::IsNullOrWhiteSpace($account)) { throw "Invalid share or account." }
                if ($accessRight -notin @("Read", "Change", "Full")) { throw "Invalid access right." }
                Grant-SmbShareAccess -Name $name -AccountName $account -AccessRight $accessRight -Force -ErrorAction Stop | Out-Null
                return @{ success = $true; message = "Share access granted." }
            }
            "revoke" {
                $name = ([string]$payload.name).Trim()
                $account = ([string]$payload.account).Trim()
                if (-not (Test-SmbShareName $name) -or [string]::IsNullOrWhiteSpace($account)) { throw "Invalid share or account." }
                Revoke-SmbShareAccess -Name $name -AccountName $account -Force -ErrorAction Stop | Out-Null
                return @{ success = $true; message = "Share access revoked." }
            }
            "closeSession" {
                $sessionId = [string]$payload.sessionId
                if ($sessionId -notmatch '^\d+$') { throw "Invalid session ID." }
                Close-SmbSession -SessionId ([uint64]$sessionId) -Force -ErrorAction Stop
                return @{ success = $true; message = "SMB session closed." }
            }
            "closeFile" {
                $fileId = [string]$payload.fileId
                if ($fileId -notmatch '^\d+$') { throw "Invalid file ID." }
                Close-SmbOpenFile -FileId ([uint64]$fileId) -Force -ErrorAction Stop
                return @{ success = $true; message = "Remote file closed." }
            }
            default { throw "Unsupported SMB operation." }
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Invoke-SmbManagerOperation([string]$operation, $payload) {
    if ($operation -notin @("create", "remove", "grant", "revoke", "closeSession", "closeFile")) {
        return @{ success = $false; error = "Unsupported SMB operation." }
    }
    if (Test-IsAdmin) { return Invoke-SmbAdminOperation -operation $operation -payload $payload }

    $resultFile = Join-Path ([System.IO.Path]::GetTempPath()) ("WinPsBox-SmbResult-" + [Guid]::NewGuid().ToString("N") + ".json")
    try {
        $payloadJson = ConvertTo-Json -InputObject $payload -Compress -Depth 8
        $payloadBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($payloadJson))
        $modulePath = $script:remoteSharingModulePath
        $safeModulePath = $modulePath.Replace("'", "''")
        $safeResultFile = $resultFile.Replace("'", "''")
        $command = @"
`$ErrorActionPreference = 'Stop'
. '$safeModulePath'
`$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$payloadBase64'))
`$operationPayload = ConvertFrom-Json `$json
`$operationResult = Invoke-SmbAdminOperation -operation '$operation' -payload `$operationPayload
[System.IO.File]::WriteAllText('$safeResultFile', (ConvertTo-Json `$operationResult -Compress -Depth 8), (New-Object System.Text.UTF8Encoding(`$false)))
if (-not `$operationResult.success) { exit 1 }
"@
        $elevated = Invoke-ElevatedCommand -scriptBlockText $command
        if (Test-Path -LiteralPath $resultFile -PathType Leaf) {
            return ConvertFrom-Json ([System.IO.File]::ReadAllText($resultFile, [System.Text.Encoding]::UTF8))
        }
        if (-not $elevated.success) { return @{ success = $false; error = $elevated.error } }
        return @{ success = $false; error = "The elevated operation returned no result." }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
    finally {
        Remove-Item -LiteralPath $resultFile -Force -ErrorAction SilentlyContinue
    }
}

function Select-SmbShareFolder {
    try {
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = "Select the folder to share"
        $dialog.ShowNewFolderButton = $true
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
            return @{ success = $true; cancelled = $true; path = "" }
        }
        return @{ success = $true; cancelled = $false; path = $dialog.SelectedPath }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
    finally { if ($dialog) { $dialog.Dispose() } }
}

function Open-SmbShareLocation([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return @{ success = $false; error = "Path is required." } }
    if (-not ($path.StartsWith("\\") -or (Test-Path -LiteralPath $path -PathType Container))) {
        return @{ success = $false; error = "The share path does not exist." }
    }
    try {
        Start-Process explorer.exe -ArgumentList $path | Out-Null
        return @{ success = $true; path = $path }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}
