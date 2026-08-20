param(
    [Parameter(Mandatory = $true)]
    [string]$RequestBase64
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

function ConvertTo-NativeCommandLineArgument([string]$value) {
    if ($null -eq $value -or $value.Length -eq 0) { return '""' }
    if ($value -notmatch '[\s"]') { return $value }

    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashCount = 0

    foreach ($character in $value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashCount++
            continue
        }

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

function Invoke-WingetCommand([string[]]$arguments) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        return @{
            success = $false
            exitCode = -1
            lines = @()
            error = "WinGet is not installed. Install App Installer from Microsoft Store first."
        }
    }

    $process = $null
    try {
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $winget.Source
        $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeCommandLineArgument -value ([string]$_) }) -join ' ')
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.StandardOutputEncoding = $utf8
        $startInfo.StandardErrorEncoding = $utf8

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()

        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        $exitCode = $process.ExitCode
        $combinedOutput = @($stdout, $stderr) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        $outputLines = @(($combinedOutput -join "`n") -split "\r?\n" | Where-Object { $_ -ne "" })

        return @{
            success = ($exitCode -eq 0)
            exitCode = $exitCode
            lines = $outputLines
            error = if ($exitCode -eq 0) { $null } else { ($outputLines -join "`n").Trim() }
        }
    }
    catch {
        return @{ success = $false; exitCode = -1; lines = @(); error = $_.Exception.Message }
    }
    finally {
        if ($process) { $process.Dispose() }
    }
}

function ConvertFrom-WingetTable([string[]]$lines, [string]$mode) {
    $items = [System.Collections.Generic.List[PSCustomObject]]::new()
    $inTable = $false

    foreach ($rawLine in $lines) {
        $line = ([string]$rawLine).TrimEnd()
        if (-not $inTable) {
            if ($line -match '^-{5,}\s*$') { $inTable = $true }
            continue
        }

        if ([string]::IsNullOrWhiteSpace($line) -or $line -match '^[-\s]+$' -or $line.StartsWith('<')) { continue }
        $parts = @([regex]::Split($line.Trim(), '\s{2,}') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($parts.Count -lt 3) { continue }

        if ($mode -eq "search") {
            $items.Add([PSCustomObject]@{
                name = $parts[0]
                id = $parts[1]
                version = $parts[2]
                availableVersion = ""
                source = "winget"
                match = if ($parts.Count -gt 3) { ($parts[3..($parts.Count - 1)] -join " ") } else { "" }
            })
            continue
        }

        $availableVersion = ""
        $source = ""
        if ($parts.Count -ge 5) {
            $availableVersion = $parts[$parts.Count - 2]
            $source = $parts[$parts.Count - 1]
        }
        elseif ($parts.Count -eq 4) {
            $source = $parts[3]
        }

        $items.Add([PSCustomObject]@{
            name = $parts[0]
            id = $parts[1]
            version = $parts[2]
            availableVersion = $availableVersion
            source = $source
            match = ""
        })
    }

    return $items
}

function Get-WingetStatus {
    $versionResult = Invoke-WingetCommand -arguments @("--version")
    if (-not $versionResult.success) {
        return @{ available = $false; version = ""; error = $versionResult.error }
    }

    $version = ($versionResult.lines | Select-Object -First 1)
    return @{ available = $true; version = [string]$version; error = $null }
}

function Get-WingetPackages([string]$mode = "installed") {
    $arguments = @("list", "--accept-source-agreements", "--disable-interactivity")
    if ($mode -eq "updates") { $arguments += "--upgrade-available" }

    $result = Invoke-WingetCommand -arguments $arguments
    if ($result.exitCode -eq -1978335212) {
        return @{ success = $true; items = @(); count = 0; mode = $mode }
    }
    if (-not $result.success) {
        return @{ success = $false; items = @(); error = $result.error }
    }

    $items = @(ConvertFrom-WingetTable -lines $result.lines -mode "list")
    return @{ success = $true; items = $items; count = $items.Count; mode = $mode }
}

function Search-WingetPackages([string]$query) {
    $query = $query.Trim()
    if ($query.Length -lt 2 -or $query.Length -gt 120 -or $query -match '[\x00-\x1f]') {
        return @{ success = $false; items = @(); error = "Search text must contain 2 to 120 valid characters." }
    }

    $arguments = @("search", "--query", $query, "--source", "winget", "--count", "100", "--accept-source-agreements", "--disable-interactivity")
    $result = Invoke-WingetCommand -arguments $arguments
    if ($result.exitCode -eq -1978335212) {
        return @{ success = $true; items = @(); count = 0; query = $query }
    }
    if (-not $result.success) {
        return @{ success = $false; items = @(); error = $result.error }
    }

    $items = @(ConvertFrom-WingetTable -lines $result.lines -mode "search")
    return @{ success = $true; items = $items; count = $items.Count; query = $query }
}

function Invoke-WingetPackageOperation([string]$operation, [string]$packageId = "") {
    $allowedOperations = @("install", "upgrade", "uninstall", "upgrade-all")
    if ($allowedOperations -notcontains $operation) {
        return @{ success = $false; error = "Unsupported package operation." }
    }

    if ($operation -ne "upgrade-all") {
        $packageId = $packageId.Trim()
        if ([string]::IsNullOrWhiteSpace($packageId) -or $packageId.Length -gt 512 -or $packageId -match '[\x00-\x1f]') {
            return @{ success = $false; error = "Invalid package ID." }
        }
    }

    $commonArguments = @("--accept-source-agreements", "--disable-interactivity")
    switch ($operation) {
        "install" { $arguments = @("install", "--id", $packageId, "--exact", "--source", "winget", "--accept-package-agreements", "--silent") + $commonArguments }
        "upgrade" { $arguments = @("upgrade", "--id", $packageId, "--exact", "--accept-package-agreements", "--silent") + $commonArguments }
        "uninstall" { $arguments = @("uninstall", "--id", $packageId, "--exact", "--silent") + $commonArguments }
        "upgrade-all" { $arguments = @("upgrade", "--all", "--accept-package-agreements", "--silent") + $commonArguments }
    }

    $result = Invoke-WingetCommand -arguments $arguments
    $output = ($result.lines -join "`n").Trim()
    if (-not $result.success) {
        return @{ success = $false; exitCode = $result.exitCode; output = $output; error = $result.error }
    }

    return @{ success = $true; exitCode = $result.exitCode; output = $output; operation = $operation; packageId = $packageId }
}

function Invoke-WingetBatchOperation([string]$operation, [object[]]$packageIds) {
    if ($operation -notin @("upgrade", "uninstall")) {
        return @{ success = $false; error = "Unsupported batch operation." }
    }

    $uniqueIds = [System.Collections.Generic.List[string]]::new()
    $seenIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($value in @($packageIds)) {
        $packageId = ([string]$value).Trim()
        if ([string]::IsNullOrWhiteSpace($packageId) -or $packageId.Length -gt 512 -or $packageId -match '[\x00-\x1f]') {
            return @{ success = $false; error = "Invalid package ID in batch request." }
        }
        if ($seenIds.Add($packageId)) { $uniqueIds.Add($packageId) }
    }

    if ($uniqueIds.Count -eq 0 -or $uniqueIds.Count -gt 100) {
        return @{ success = $false; error = "Batch request must contain 1 to 100 packages." }
    }

    $results = [System.Collections.Generic.List[object]]::new()
    foreach ($packageId in $uniqueIds) {
        $itemResult = Invoke-WingetPackageOperation -operation $operation -packageId $packageId
        $results.Add([PSCustomObject]@{
            success = [bool]$itemResult.success
            packageId = $packageId
            exitCode = $itemResult.exitCode
            error = if ($itemResult.success) { $null } else { $itemResult.error }
        })
    }

    $succeeded = @($results | Where-Object { $_.success }).Count
    return @{
        success = $true
        operation = $operation
        total = $results.Count
        succeeded = $succeeded
        failed = $results.Count - $succeeded
        results = $results
    }
}

function New-WorkerResponse([bool]$success, $data = $null, [string]$errorMessage = $null) {
    return [ordered]@{ success = $success; data = $data; error = $errorMessage }
}

try {
    $requestJson = $utf8.GetString([Convert]::FromBase64String($RequestBase64))
    $request = ConvertFrom-Json $requestJson
    $payload = $request.payload

    switch ([string]$request.action) {
        "winget_get_status" {
            $response = New-WorkerResponse -success $true -data (Get-WingetStatus)
        }
        "winget_get_packages" {
            $mode = [string]$payload.mode
            if ($mode -notin @("installed", "updates")) { $mode = "installed" }
            $result = Get-WingetPackages -mode $mode
            if ($result.success) { $response = New-WorkerResponse -success $true -data $result }
            else { $response = New-WorkerResponse -success $false -errorMessage $result.error }
        }
        "winget_search" {
            $result = Search-WingetPackages -query ([string]$payload.query)
            if ($result.success) { $response = New-WorkerResponse -success $true -data $result }
            else { $response = New-WorkerResponse -success $false -errorMessage $result.error }
        }
        "winget_package_action" {
            $result = Invoke-WingetPackageOperation -operation ([string]$payload.operation) -packageId ([string]$payload.packageId)
            if ($result.success) { $response = New-WorkerResponse -success $true -data $result }
            else { $response = New-WorkerResponse -success $false -errorMessage $result.error }
        }
        "winget_batch_action" {
            $result = Invoke-WingetBatchOperation -operation ([string]$payload.operation) -packageIds @($payload.packageIds)
            if ($result.success) { $response = New-WorkerResponse -success $true -data $result }
            else { $response = New-WorkerResponse -success $false -errorMessage $result.error }
        }
        default {
            $response = New-WorkerResponse -success $false -errorMessage "Unsupported worker action."
        }
    }
}
catch {
    $response = New-WorkerResponse -success $false -errorMessage $_.Exception.Message
}

$responseJson = ConvertTo-Json -InputObject $response -Compress -Depth 10
[Console]::Out.Write($responseJson)
