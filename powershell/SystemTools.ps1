# ----------------- System & Privilege Functions -----------------
function Test-IsAdmin {
    try {
        $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Invoke-ElevatedCommand([string]$scriptBlockText) {
    try {
        $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($scriptBlockText))
        $proc = Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded" -Verb RunAs -Wait -PassThru -WindowStyle Hidden
        if ($proc.ExitCode -eq 0) {
            return @{ success = $true }
        } else {
            return @{ success = $false; error = "Elevated execution failed with exit code $($proc.ExitCode)" }
        }
    }
    catch {
        $msg = if ($_.Exception.Message -match "cancel|canceled") { "User canceled UAC elevation prompt." } else { $_.Exception.Message }
        return @{ success = $false; error = $msg }
    }
}

function Get-EnvVarList {
    $userDict = [System.Environment]::GetEnvironmentVariables([System.EnvironmentVariableTarget]::User)
    $machineDict = [System.Environment]::GetEnvironmentVariables([System.EnvironmentVariableTarget]::Machine)

    $userVars = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($k in $userDict.Keys) {
        $userVars.Add([PSCustomObject]@{ name = $k; value = [string]$userDict[$k]; scope = "User" })
    }

    $machineVars = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($k in $machineDict.Keys) {
        $machineVars.Add([PSCustomObject]@{ name = $k; value = [string]$machineDict[$k]; scope = "Machine" })
    }

    $userPath = if ($userDict.ContainsKey("Path")) { [string]$userDict["Path"] } else { "" }
    $machinePath = if ($machineDict.ContainsKey("Path")) { [string]$machineDict["Path"] } else { "" }

    $pathAnalysis = [System.Collections.Generic.List[PSCustomObject]]::new()
    $rawPaths = ($userPath + ";" + $machinePath).Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
    foreach ($p in $rawPaths) {
        $trimmed = $p.Trim()
        if ($trimmed) {
            $exists = Test-Path -Path $trimmed
            $pathAnalysis.Add([PSCustomObject]@{
                path = $trimmed
                exists = $exists
            })
        }
    }

    return [PSCustomObject]@{
        userVars = $userVars
        machineVars = $machineVars
        pathAnalysis = $pathAnalysis
        isAdmin = (Test-IsAdmin)
    }
}

function Set-EnvVar([string]$name, [string]$value, [string]$scope = "User") {
    $target = if ($scope -eq "Machine") { [System.EnvironmentVariableTarget]::Machine } else { [System.EnvironmentVariableTarget]::User }
    try {
        [System.Environment]::SetEnvironmentVariable($name, $value, $target)
        return @{ success = $true; message = "Environment variable saved successfully." }
    }
    catch {
        if ($scope -eq "Machine" -and -not (Test-IsAdmin)) {
            $escapedValue = $value.Replace("`"", "```"").Replace("'", "''")
            $cmd = "[System.Environment]::SetEnvironmentVariable('$name', '$escapedValue', [System.EnvironmentVariableTarget]::Machine)"
            $elevatedRes = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevatedRes.success) {
                return @{ success = $true; message = "Environment variable saved via elevated UAC administrator." }
            } else {
                return @{ success = $false; error = "Save failed: $($elevatedRes.error)" }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Delete-EnvVar([string]$name, [string]$scope = "User") {
    $target = if ($scope -eq "Machine") { [System.EnvironmentVariableTarget]::Machine } else { [System.EnvironmentVariableTarget]::User }
    try {
        [System.Environment]::SetEnvironmentVariable($name, $null, $target)
        return @{ success = $true; message = "Environment variable deleted successfully." }
    }
    catch {
        if ($scope -eq "Machine" -and -not (Test-IsAdmin)) {
            $cmd = "[System.Environment]::SetEnvironmentVariable('$name', `$null, [System.EnvironmentVariableTarget]::Machine)"
            $elevatedRes = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevatedRes.success) {
                return @{ success = $true; message = "Environment variable deleted via elevated UAC administrator." }
            } else {
                return @{ success = $false; error = "Delete failed: $($elevatedRes.error)" }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-ProcessList {
    $list = [System.Collections.Generic.List[PSCustomObject]]::new()
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
        $mem = [math]::Round($_.WorkingSet64 / 1MB, 1)
        $cpu = if ($_.CPU) { [math]::Round($_.CPU, 1) } else { 0 }
        $path = try { $_.Path } catch { "" }
        $desc = try { $_.Description } catch { "" }
        $list.Add([PSCustomObject]@{
            pid = $_.Id
            name = $_.ProcessName
            memoryMB = $mem
            cpu = $cpu
            responding = $_.Responding
            path = $path
            description = $desc
        })
    }
    return $list
}

function Kill-ProcessById([int]$pid) {
    try {
        Stop-Process -Id $pid -Force -ErrorAction Stop
        return @{ success = $true; message = "进程已终止" }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $cmd = "Stop-Process -Id $pid -Force -ErrorAction Stop"
            $elevatedRes = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevatedRes.success) {
                return @{ success = $true; message = "进程已通过管理员权限终止" }
            } else {
                return @{ success = $false; error = "终止进程失败: $($elevatedRes.error)" }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-HostsInfo {
    try {
        $content = [System.IO.File]::ReadAllText($hostsPath, [System.Text.Encoding]::UTF8)
        return @{
            success = $true
            path = $hostsPath
            content = $content
            isAdmin = (Test-IsAdmin)
        }
    }
    catch {
        return @{
            success = $false
            path = $hostsPath
            error = $_.Exception.Message
            isAdmin = (Test-IsAdmin)
        }
    }
}

function Save-HostsInfo([string]$content) {
    try {
        [System.IO.File]::WriteAllText($hostsPath, $content, [System.Text.Encoding]::UTF8)
        return @{ success = $true; message = "Hosts saved successfully." }
    }
    catch {
        $tmpFile = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($tmpFile, $content, [System.Text.Encoding]::UTF8)
            $cmd = "Copy-Item -Path '$tmpFile' -Destination '$hostsPath' -Force; Remove-Item -Path '$tmpFile' -Force -ErrorAction SilentlyContinue"
            $elevatedRes = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevatedRes.success) {
                return @{ success = $true; message = "Hosts saved successfully via elevated UAC administrator." }
            } else {
                return @{ success = $false; error = "Save failed: $($elevatedRes.error)" }
            }
        }
        finally {
            if (Test-Path $tmpFile) {
                Remove-Item -Path $tmpFile -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# ----------------- 7. Windows Services Functions -----------------
function Get-WinServiceList {
    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $services = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue
        foreach ($s in $services) {
            $results.Add([PSCustomObject]@{
                name = $s.Name
                displayName = $s.DisplayName
                status = $s.State
                startMode = $s.StartMode
                pid = $s.ProcessId
                pathName = $s.PathName
                description = $s.Description
            })
        }
    }
    catch {
        Get-Service -ErrorAction SilentlyContinue | ForEach-Object {
            $results.Add([PSCustomObject]@{
                name = $_.Name
                displayName = $_.DisplayName
                status = $_.Status.ToString()
                startMode = $_.StartType.ToString()
                pid = 0
                pathName = ""
                description = ""
            })
        }
    }
    return $results
}

function Set-WinServiceStatus([string]$serviceName, [string]$action) {
    try {
        if ($action -eq "start") {
            Start-Service -Name $serviceName -ErrorAction Stop
        } elseif ($action -eq "stop") {
            Stop-Service -Name $serviceName -Force -ErrorAction Stop
        } elseif ($action -eq "restart") {
            Restart-Service -Name $serviceName -Force -ErrorAction Stop
        }
        return @{ success = $true; message = "服务操作成功" }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $psCmd = switch ($action) {
                "start" { "Start-Service -Name '$serviceName' -ErrorAction Stop" }
                "stop" { "Stop-Service -Name '$serviceName' -Force -ErrorAction Stop" }
                "restart" { "Restart-Service -Name '$serviceName' -Force -ErrorAction Stop" }
            }
            $elevated = Invoke-ElevatedCommand -scriptBlockText $psCmd
            if ($elevated.success) {
                return @{ success = $true; message = "已通过管理员权限成功执行服务操作" }
            } else {
                return @{ success = $false; error = $elevated.error }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Set-WinServiceStartMode([string]$serviceName, [string]$startType) {
    try {
        Set-Service -Name $serviceName -StartupType $startType -ErrorAction Stop
        return @{ success = $true; message = "服务启动类型已更新" }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $cmd = "Set-Service -Name '$serviceName' -StartupType '$startType' -ErrorAction Stop"
            $elevated = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevated.success) {
                return @{ success = $true; message = "已通过管理员权限成功更新服务启动类型" }
            } else {
                return @{ success = $false; error = $elevated.error }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 8. Startup Items Auditor Functions -----------------
function Get-AllStartupItems {
    $items = [System.Collections.Generic.List[PSCustomObject]]::new()

    # HKCU Run
    $hkcuRun = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    if (Test-Path $hkcuRun) {
        $props = Get-ItemProperty -Path $hkcuRun -ErrorAction SilentlyContinue
        foreach ($p in $props.psobject.properties) {
            if ($p.Name -notmatch "^PS|^_") {
                $val = [string]$p.Value
                $cleanPath = $val.Trim('"').Split('"')[0].Trim()
                $items.Add([PSCustomObject]@{
                    id = "hkcu_" + $p.Name
                    name = $p.Name
                    command = $val
                    targetPath = $cleanPath
                    locationType = "注册表 (当前用户)"
                    locationPath = $hkcuRun
                    enabled = $true
                    fileExists = (Test-Path $cleanPath -PathType Leaf)
                })
            }
        }
    }

    # HKLM Run
    $hklmRun = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
    if (Test-Path $hklmRun) {
        $props = Get-ItemProperty -Path $hklmRun -ErrorAction SilentlyContinue
        foreach ($p in $props.psobject.properties) {
            if ($p.Name -notmatch "^PS|^_") {
                $val = [string]$p.Value
                $cleanPath = $val.Trim('"').Split('"')[0].Trim()
                $items.Add([PSCustomObject]@{
                    id = "hklm_" + $p.Name
                    name = $p.Name
                    command = $val
                    targetPath = $cleanPath
                    locationType = "注册表 (系统所有用户)"
                    locationPath = $hklmRun
                    enabled = $true
                    fileExists = (Test-Path $cleanPath -PathType Leaf)
                })
            }
        }
    }

    # WOW6432Node Run
    $wowRun = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"
    if (Test-Path $wowRun) {
        $props = Get-ItemProperty -Path $wowRun -ErrorAction SilentlyContinue
        foreach ($p in $props.psobject.properties) {
            if ($p.Name -notmatch "^PS|^_") {
                $val = [string]$p.Value
                $cleanPath = $val.Trim('"').Split('"')[0].Trim()
                $items.Add([PSCustomObject]@{
                    id = "wow_" + $p.Name
                    name = $p.Name
                    command = $val
                    targetPath = $cleanPath
                    locationType = "注册表 (32位兼容)"
                    locationPath = $wowRun
                    enabled = $true
                    fileExists = (Test-Path $cleanPath -PathType Leaf)
                })
            }
        }
    }

    # User Startup Folder
    $userStartup = [Environment]::GetFolderPath('Startup')
    if (Test-Path $userStartup) {
        Get-ChildItem -Path $userStartup -ErrorAction SilentlyContinue | ForEach-Object {
            $items.Add([PSCustomObject]@{
                id = "folder_user_" + $_.Name
                name = $_.Name
                command = $_.FullName
                targetPath = $_.FullName
                locationType = "启动文件夹 (用户)"
                locationPath = $userStartup
                enabled = $true
                fileExists = $true
            })
        }
    }

    # Common Startup Folder
    $commonStartup = [Environment]::GetFolderPath('CommonStartup')
    if (Test-Path $commonStartup) {
        Get-ChildItem -Path $commonStartup -ErrorAction SilentlyContinue | ForEach-Object {
            $items.Add([PSCustomObject]@{
                id = "folder_common_" + $_.Name
                name = $_.Name
                command = $_.FullName
                targetPath = $_.FullName
                locationType = "启动文件夹 (公共)"
                locationPath = $commonStartup
                enabled = $true
                fileExists = $true
            })
        }
    }

    return $items
}

function Remove-StartupItemEntry([string]$id, [string]$locationType, [string]$locationPath, [string]$name) {
    try {
        if ($locationType -match "注册表") {
            Remove-ItemProperty -Path $locationPath -Name $name -Force -ErrorAction Stop
            return @{ success = $true; message = "已成功从注册表中移除自启动项" }
        } elseif ($locationType -match "启动文件夹") {
            $target = Join-Path $locationPath $name
            Remove-Item -Path $target -Force -ErrorAction Stop
            return @{ success = $true; message = "已从启动文件夹中删除" }
        }
        return @{ success = $false; error = "未知的自启动项来源类型" }
    }
    catch {
        if (-not (Test-IsAdmin)) {
            $cmd = if ($locationType -match "注册表") { "Remove-ItemProperty -Path '$locationPath' -Name '$name' -Force" } else { "Remove-Item -Path '$(Join-Path $locationPath $name)' -Force" }
            $elevated = Invoke-ElevatedCommand -scriptBlockText $cmd
            if ($elevated.success) {
                return @{ success = $true; message = "已通过管理员权限成功删除自启动项" }
            } else {
                return @{ success = $false; error = $elevated.error }
            }
        }
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 9. File Lock Hunter Functions -----------------
function Get-FileLockingDetails([string]$path) {
    if (-not (Test-Path $path)) {
        return @{ success = $false; error = "指定文件或路径不存在" }
    }
    $resolved = (Resolve-Path $path).Path

    $processes = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $pids = [RestartManagerWrapper]::FindLockingProcesses($resolved)
        foreach ($pidNum in $pids) {
            try {
                $p = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
                if ($p) {
                    $mem = [math]::Round($p.WorkingSet64 / 1MB, 1)
                    $procPath = try { $p.Path } catch { "" }
                    $desc = try { $p.Description } catch { "" }
                    $wTitle = try { $p.MainWindowTitle } catch { "" }

                    $processes.Add([PSCustomObject]@{
                        pid = $p.Id
                        name = $p.ProcessName
                        title = $wTitle
                        path = $procPath
                        description = $desc
                        memoryMB = $mem
                    })
                }
            } catch { }
        }
    } catch { }

    return @{
        success = $true
        path = $resolved
        locked = ($processes.Count -gt 0)
        lockCount = $processes.Count
        processes = $processes
    }
}

# ----------------- 10. Hardware & System Specs Functions -----------------
function Get-ComprehensiveSpecs {
    try {
        $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
        $cpuInfo = @{
            name = if ($cpu) { $cpu.Name.Trim() } else { "Unknown Processor" }
            manufacturer = if ($cpu) { $cpu.Manufacturer } else { "Unknown" }
            cores = if ($cpu) { $cpu.NumberOfCores } else { 0 }
            threads = if ($cpu) { $cpu.NumberOfLogicalProcessors } else { 0 }
            maxClockSpeedMHz = if ($cpu) { $cpu.MaxClockSpeed } else { 0 }
            socket = if ($cpu) { $cpu.SocketDesignation } else { "" }
            loadPercent = if ($cpu -and $cpu.LoadPercentage) { $cpu.LoadPercentage } else { 0 }
        }

        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        $totalMemKB = if ($os) { $os.TotalVisibleMemorySize } else { 0 }
        $freeMemKB = if ($os) { $os.FreePhysicalMemory } else { 0 }
        $totalGB = [math]::Round($totalMemKB / 1MB, 1)
        $freeGB = [math]::Round($freeMemKB / 1MB, 1)
        $usedGB = [math]::Round($totalGB - $freeGB, 1)
        $memPercent = if ($totalGB -gt 0) { [math]::Round(($usedGB / $totalGB) * 100, 1) } else { 0 }

        $memSlots = [System.Collections.Generic.List[PSCustomObject]]::new()
        Get-CimInstance Win32_PhysicalMemory -ErrorAction SilentlyContinue | ForEach-Object {
            $memSlots.Add([PSCustomObject]@{
                slot = $_.DeviceLocator
                capacityGB = [math]::Round($_.Capacity / 1GB, 1)
                speedMHz = $_.Speed
                manufacturer = $_.Manufacturer
                partNumber = if ($_.PartNumber) { $_.PartNumber.Trim() } else { "" }
            })
        }

        $disks = [System.Collections.Generic.List[PSCustomObject]]::new()
        Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | ForEach-Object {
            $total = [math]::Round($_.Size / 1GB, 1)
            $free = [math]::Round($_.FreeSpace / 1GB, 1)
            $used = [math]::Round($total - $free, 1)
            $pct = if ($total -gt 0) { [math]::Round(($used / $total) * 100, 1) } else { 0 }
            $disks.Add([PSCustomObject]@{
                drive = $_.DeviceID
                volumeName = $_.VolumeName
                fileSystem = $_.FileSystem
                totalGB = $total
                freeGB = $free
                usedGB = $used
                percentUsed = $pct
            })
        }

        $physicalDisks = [System.Collections.Generic.List[PSCustomObject]]::new()
        Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object {
            $physicalDisks.Add([PSCustomObject]@{
                model = $_.Model
                sizeGB = [math]::Round($_.Size / 1GB, 1)
                interfaceType = $_.InterfaceType
                mediaType = $_.MediaType
            })
        }

        $gpus = [System.Collections.Generic.List[PSCustomObject]]::new()
        Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
            $ramMB = if ($_.AdapterRAM) { [math]::Round($_.AdapterRAM / 1MB, 0) } else { 0 }
            $gpus.Add([PSCustomObject]@{
                name = $_.Name
                driverVersion = $_.DriverVersion
                memoryMB = $ramMB
                status = $_.Status
            })
        }

        $bootTime = if ($os) { $os.LastBootUpTime } else { [DateTime]::MinValue }
        $uptimeStr = "0 分钟"
        if ($bootTime -ne [DateTime]::MinValue) {
            $diff = [DateTime]::Now - $bootTime
            $uptimeStr = "$($diff.Days) 天 $($diff.Hours) 小时 $($diff.Minutes) 分钟"
        }

        $osInfo = @{
            caption = if ($os) { $os.Caption } else { "Windows" }
            version = if ($os) { $os.Version } else { "" }
            buildNumber = if ($os) { $os.BuildNumber } else { "" }
            architecture = if ($os) { $os.OSArchitecture } else { "64-bit" }
            installDate = if ($os -and $os.InstallDate) { $os.InstallDate.ToString("yyyy-MM-dd HH:mm:ss") } else { "-" }
            lastBootTime = if ($bootTime -ne [DateTime]::MinValue) { $bootTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "-" }
            uptime = $uptimeStr
            computerName = $env:COMPUTERNAME
            userName = $env:USERNAME
            isAdmin = (Test-IsAdmin)
        }

        return @{
            success = $true
            cpu = $cpuInfo
            memory = @{
                totalGB = $totalGB
                freeGB = $freeGB
                usedGB = $usedGB
                percentUsed = $memPercent
                slots = $memSlots
            }
            disks = $disks
            physicalDisks = $physicalDisks
            gpus = $gpus
            os = $osInfo
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 11. System Shortcuts Launcher Functions -----------------
function Launch-SysUtility([string]$toolKey) {
    try {
        switch ($toolKey) {
            "gpedit"    { Start-Process "gpedit.msc" }
            "regedit"   { Start-Process "regedit.exe" }
            "devmgmt"   { Start-Process "devmgmt.msc" }
            "eventvwr"  { Start-Process "eventvwr.msc" }
            "taskschd"  { Start-Process "taskschd.msc" }
            "diskmgmt"  { Start-Process "diskmgmt.msc" }
            "compmgmt"  { Start-Process "compmgmt.msc" }
            "perfmon"   { Start-Process "perfmon.msc" }
            "firewall"  { Start-Process "wf.msc" }
            "services"  { Start-Process "services.msc" }
            "ncpa"      { Start-Process "ncpa.cpl" }
            "appwiz"    { Start-Process "appwiz.cpl" }
            "sysdm"     { Start-Process "sysdm.cpl" }
            "powercfg"  { Start-Process "powercfg.cpl" }
            "mmsys"     { Start-Process "mmsys.cpl" }
            "dxdiag"    { Start-Process "dxdiag.exe" }
            "resmon"    { Start-Process "resmon.exe" }
            "msinfo32"  { Start-Process "msinfo32.exe" }
            "certmgr"   { Start-Process "certmgr.msc" }
            "cleanmgr"  { Start-Process "cleanmgr.exe" }
            "cmd"       { Start-Process "cmd.exe" }
            "powershell"{ Start-Process "powershell.exe" }
            "godmode"   { Start-Process "explorer.exe" -ArgumentList "shell:::{ED7BA470-8E54-465E-825C-99712043E01C}" }
            default     { return @{ success = $false; error = "未知的快捷工具标识" } }
        }
        return @{ success = $true; message = "已启动工具" }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# ----------------- 12. DevTools Box Scheduled Tasks -----------------
$script:ToolboxTaskPrefix = "DevToolsBox_"

function Get-ToolboxScheduledTasks {
    $items = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $tasks = @(Get-ScheduledTask -TaskName "$($script:ToolboxTaskPrefix)*" -ErrorAction SilentlyContinue)
        foreach ($task in $tasks) {
            $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
            $taskAction = @($task.Actions)[0]
            $trigger = @($task.Triggers)[0]
            $execute = [string]$taskAction.Execute
            $arguments = [string]$taskAction.Arguments
            $actionKey = "program"

            if ($execute -match "(?i)shutdown(\.exe)?$") {
                if ($arguments -match "(?i)(^|\s)/r(\s|$)") { $actionKey = "restart" } else { $actionKey = "shutdown" }
            }
            elseif ($execute -match "(?i)rundll32(\.exe)?$") {
                if ($arguments -match "(?i)LockWorkStation") { $actionKey = "lock" }
                elseif ($arguments -match "(?i)SetSuspendState") { $actionKey = "sleep" }
            }

            $scheduleType = if ($trigger.CimClass.CimClassName -eq "MSFT_TaskDailyTrigger") { "daily" } else { "once" }
            $nextRun = if ($info -and $info.NextRunTime -and $info.NextRunTime.Year -gt 1900) { $info.NextRunTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
            $lastRun = if ($info -and $info.LastRunTime -and $info.LastRunTime.Year -gt 1900) { $info.LastRunTime.ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
            $displayName = ($task.TaskName -replace "^$([regex]::Escape($script:ToolboxTaskPrefix))", "")
            if ([string]$task.Description -match "^DevToolsBoxName:(.+)$") {
                try { $displayName = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1])) } catch { }
            }

            $items.Add([PSCustomObject]@{
                id = $task.TaskName
                name = $displayName
                action = $actionKey
                execute = $execute
                arguments = $arguments
                scheduleType = $scheduleType
                nextRun = $nextRun
                lastRun = $lastRun
                lastResult = if ($info) { [int64]$info.LastTaskResult } else { $null }
                enabled = [bool]$task.Settings.Enabled
                state = [string]$task.State
            })
        }

        return @($items | Sort-Object @{ Expression = { if ($_.nextRun) { [datetime]$_.nextRun } else { [datetime]::MaxValue } } })
    }
    catch {
        throw "读取计划任务失败: $($_.Exception.Message)"
    }
}

function New-ToolboxScheduledTask([string]$name, [string]$actionKey, [string]$scheduleType, [string]$runAt, [string]$programPath = "", [string]$arguments = "", [string]$workingDirectory = "") {
    try {
        $allowedActions = @("shutdown", "restart", "sleep", "lock", "program")
        if ($allowedActions -notcontains $actionKey) { return @{ success = $false; error = "不支持的任务动作" } }
        if (@("once", "daily") -notcontains $scheduleType) { return @{ success = $false; error = "不支持的执行频率" } }

        $parsedAt = [datetime]::MinValue
        if (-not [datetime]::TryParse($runAt, [ref]$parsedAt)) { return @{ success = $false; error = "执行时间格式无效" } }
        if ($scheduleType -eq "once" -and $parsedAt -le (Get-Date).AddSeconds(20)) {
            return @{ success = $false; error = "一次性任务的执行时间必须至少晚于当前时间 20 秒" }
        }

        $execute = ""
        $taskArguments = ""
        switch ($actionKey) {
            "shutdown" { $execute = "$env:SystemRoot\System32\shutdown.exe"; $taskArguments = "/s /t 0" }
            "restart"  { $execute = "$env:SystemRoot\System32\shutdown.exe"; $taskArguments = "/r /t 0" }
            "sleep"    { $execute = "$env:SystemRoot\System32\rundll32.exe"; $taskArguments = "powrprof.dll,SetSuspendState 0,1,0" }
            "lock"     { $execute = "$env:SystemRoot\System32\rundll32.exe"; $taskArguments = "user32.dll,LockWorkStation" }
            "program" {
                if ([string]::IsNullOrWhiteSpace($programPath) -or -not (Test-Path -LiteralPath $programPath -PathType Leaf)) {
                    return @{ success = $false; error = "请选择一个存在的程序或脚本文件" }
                }
                $resolvedProgram = (Resolve-Path -LiteralPath $programPath).Path
                $extension = [System.IO.Path]::GetExtension($resolvedProgram).ToLowerInvariant()
                if ($extension -eq ".ps1") {
                    $execute = "powershell.exe"
                    $taskArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$resolvedProgram`" $arguments".Trim()
                }
                elseif ($extension -in @(".bat", ".cmd")) {
                    $execute = "$env:SystemRoot\System32\cmd.exe"
                    $taskArguments = "/c `"`"$resolvedProgram`" $arguments`"".Trim()
                }
                else {
                    $execute = $resolvedProgram
                    $taskArguments = $arguments
                }
            }
        }

        $displayName = if ([string]::IsNullOrWhiteSpace($name)) { $actionKey } else { $name.Trim() }
        $safeLabel = (($displayName -replace "[^\p{L}\p{Nd}_-]", "_").Trim("_"))
        if ([string]::IsNullOrWhiteSpace($safeLabel)) { $safeLabel = $actionKey }
        if ($safeLabel.Length -gt 32) { $safeLabel = $safeLabel.Substring(0, 32) }
        $taskName = "$($script:ToolboxTaskPrefix)$safeLabel`_$([guid]::NewGuid().ToString('N').Substring(0, 8))"

        $actionParams = @{ Execute = $execute }
        if (-not [string]::IsNullOrWhiteSpace($taskArguments)) { $actionParams.Argument = $taskArguments }
        if (-not [string]::IsNullOrWhiteSpace($workingDirectory) -and (Test-Path -LiteralPath $workingDirectory -PathType Container)) {
            $actionParams.WorkingDirectory = (Resolve-Path -LiteralPath $workingDirectory).Path
        }
        $taskAction = New-ScheduledTaskAction @actionParams
        $trigger = if ($scheduleType -eq "daily") {
            New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.Add($parsedAt.TimeOfDay))
        } else {
            New-ScheduledTaskTrigger -Once -At $parsedAt
        }
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $encodedDisplayName = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($displayName))
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Settings $settings -Description "DevToolsBoxName:$encodedDisplayName" -Force -ErrorAction Stop | Out-Null

        return @{ success = $true; id = $taskName; message = "定时任务已创建" }
    }
    catch {
        return @{ success = $false; error = "创建计划任务失败: $($_.Exception.Message)" }
    }
}

function Set-ToolboxScheduledTaskState([string]$taskName, [bool]$enabled) {
    try {
        if (-not $taskName.StartsWith($script:ToolboxTaskPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return @{ success = $false; error = "只能管理由 DevTools Box 创建的任务" }
        }
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
        if ($enabled) { $task | Enable-ScheduledTask -ErrorAction Stop | Out-Null }
        else { $task | Disable-ScheduledTask -ErrorAction Stop | Out-Null }
        return @{ success = $true; message = if ($enabled) { "任务已启用" } else { "任务已暂停" } }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

function Remove-ToolboxScheduledTask([string]$taskName) {
    try {
        if (-not $taskName.StartsWith($script:ToolboxTaskPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return @{ success = $false; error = "只能删除由 DevTools Box 创建的任务" }
        }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
        return @{ success = $true; message = "任务已删除" }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

# ----------------- 13. Windows Context Menu Manager -----------------
function Get-ContextMenuRoots {
    return @(
        @{ path = "HKCU:\Software\Classes\*\shell"; target = "file"; targetName = "文件"; scope = "User" },
        @{ path = "HKCU:\Software\Classes\Directory\shell"; target = "folder"; targetName = "文件夹"; scope = "User" },
        @{ path = "HKCU:\Software\Classes\Directory\Background\shell"; target = "background"; targetName = "目录背景"; scope = "User" },
        @{ path = "HKCU:\Software\Classes\DesktopBackground\Shell"; target = "background"; targetName = "桌面背景"; scope = "User" },
        @{ path = "HKCU:\Software\Classes\Drive\shell"; target = "drive"; targetName = "磁盘"; scope = "User" },
        @{ path = "HKLM:\Software\Classes\*\shell"; target = "file"; targetName = "文件"; scope = "Machine" },
        @{ path = "HKLM:\Software\Classes\Directory\shell"; target = "folder"; targetName = "文件夹"; scope = "Machine" },
        @{ path = "HKLM:\Software\Classes\Directory\Background\shell"; target = "background"; targetName = "目录背景"; scope = "Machine" },
        @{ path = "HKLM:\Software\Classes\DesktopBackground\Shell"; target = "background"; targetName = "桌面背景"; scope = "Machine" },
        @{ path = "HKLM:\Software\Classes\Drive\shell"; target = "drive"; targetName = "磁盘"; scope = "Machine" }
    )
}

function Test-ContextMenuVerbPath([string]$registryPath) {
    foreach ($root in (Get-ContextMenuRoots)) {
        if ((Split-Path -Path $registryPath -Parent) -ieq $root.path) { return $true }
    }
    return $false
}

function Get-ContextMenuItems {
    $items = [System.Collections.Generic.List[PSCustomObject]]::new()
    $blockedUserPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked"
    $blockedMachinePath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked"
    $blockedUser = if (Test-Path $blockedUserPath) { Get-ItemProperty -LiteralPath $blockedUserPath -ErrorAction SilentlyContinue } else { $null }
    $blockedMachine = if (Test-Path $blockedMachinePath) { Get-ItemProperty -LiteralPath $blockedMachinePath -ErrorAction SilentlyContinue } else { $null }

    foreach ($root in (Get-ContextMenuRoots)) {
        if (-not (Test-Path -LiteralPath $root.path)) { continue }
        foreach ($key in @(Get-ChildItem -LiteralPath $root.path -ErrorAction SilentlyContinue)) {
            $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
            $defaultValue = [string]$key.GetValue("")
            $displayName = if ($props.MUIVerb -and -not ([string]$props.MUIVerb).StartsWith("@")) {
                [string]$props.MUIVerb
            } elseif ($defaultValue -and -not $defaultValue.StartsWith("@")) {
                $defaultValue
            } else {
                $key.PSChildName
            }
            $commandKey = Join-Path $key.PSPath "command"
            $command = if (Test-Path -LiteralPath $commandKey) { [string](Get-Item -LiteralPath $commandKey).GetValue("") } else { "" }
            $isDisabled = $props.PSObject.Properties.Name -contains "LegacyDisable"
            $items.Add([PSCustomObject]@{
                id = "verb|$($key.Name)"
                name = $displayName
                keyName = $key.PSChildName
                type = "verb"
                typeName = "命令菜单"
                target = $root.target
                targetName = $root.targetName
                scope = $root.scope
                enabled = -not $isDisabled
                command = $command
                registryPath = ($key.Name -replace "^HKEY_CURRENT_USER", "HKCU:" -replace "^HKEY_LOCAL_MACHINE", "HKLM:")
                clsid = ""
                policyLocked = $false
            })
        }

        $handlerRoot = Join-Path (Split-Path $root.path -Parent) "shellex\ContextMenuHandlers"
        if (-not (Test-Path -LiteralPath $handlerRoot)) { continue }
        foreach ($key in @(Get-ChildItem -LiteralPath $handlerRoot -ErrorAction SilentlyContinue)) {
            $clsid = [string]$key.GetValue("")
            if ($clsid -notmatch "^\{[0-9A-Fa-f-]{36}\}$") { continue }
            $userBlocked = $blockedUser -and ($blockedUser.PSObject.Properties.Name -contains $clsid)
            $machineBlocked = $blockedMachine -and ($blockedMachine.PSObject.Properties.Name -contains $clsid)
            $items.Add([PSCustomObject]@{
                id = "handler|$clsid|$($root.target)|$($root.scope)"
                name = $key.PSChildName
                keyName = $key.PSChildName
                type = "handler"
                typeName = "扩展处理器"
                target = $root.target
                targetName = $root.targetName
                scope = $root.scope
                enabled = -not ($userBlocked -or $machineBlocked)
                command = $clsid
                registryPath = ($key.Name -replace "^HKEY_CURRENT_USER", "HKCU:" -replace "^HKEY_LOCAL_MACHINE", "HKLM:")
                clsid = $clsid
                policyLocked = [bool]$machineBlocked
            })
        }
    }

    return @($items | Sort-Object targetName, name, scope)
}

function Set-ContextMenuItemState([string]$type, [string]$registryPath, [string]$clsid, [bool]$enabled) {
    try {
        if ($type -eq "verb") {
            if (-not (Test-ContextMenuVerbPath -registryPath $registryPath) -or -not (Test-Path -LiteralPath $registryPath)) {
                return @{ success = $false; error = "右键菜单注册表路径不在允许范围内" }
            }
            if ($registryPath.StartsWith("HKLM:", [System.StringComparison]::OrdinalIgnoreCase) -and -not (Test-IsAdmin)) {
                $safePath = $registryPath.Replace("'", "''")
                $cmd = if ($enabled) {
                    "Remove-ItemProperty -LiteralPath '$safePath' -Name 'LegacyDisable' -ErrorAction SilentlyContinue"
                } else {
                    "New-ItemProperty -LiteralPath '$safePath' -Name 'LegacyDisable' -Value '' -PropertyType String -Force -ErrorAction Stop | Out-Null"
                }
                $res = Invoke-ElevatedCommand -scriptBlockText $cmd
                if (-not $res.success) { return $res }
            }
            elseif ($enabled) {
                Remove-ItemProperty -LiteralPath $registryPath -Name "LegacyDisable" -ErrorAction SilentlyContinue
            }
            else {
                New-ItemProperty -LiteralPath $registryPath -Name "LegacyDisable" -Value "" -PropertyType String -Force -ErrorAction Stop | Out-Null
            }
        }
        elseif ($type -eq "handler") {
            if ($clsid -notmatch "^\{[0-9A-Fa-f-]{36}\}$") { return @{ success = $false; error = "无效的 Shell 扩展 CLSID" } }
            $blockedPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked"
            if (-not (Test-Path -LiteralPath $blockedPath)) { New-Item -Path $blockedPath -Force | Out-Null }
            if ($enabled) { Remove-ItemProperty -LiteralPath $blockedPath -Name $clsid -ErrorAction SilentlyContinue }
            else { New-ItemProperty -LiteralPath $blockedPath -Name $clsid -Value "Disabled by DevTools Box" -PropertyType String -Force | Out-Null }
        }
        else { return @{ success = $false; error = "不支持的右键菜单项目类型" } }

        return @{ success = $true; restartRequired = $true; message = if ($enabled) { "菜单项已启用，重启资源管理器后生效" } else { "菜单项已禁用，重启资源管理器后生效" } }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}

function Open-ContextMenuRegistryPath([string]$registryPath) {
    try {
        $isVerbPath = Test-ContextMenuVerbPath -registryPath $registryPath
        $isHandlerPath = $registryPath -match "^(HKCU|HKLM):\\Software\\Classes\\(\*|Directory|Directory\\Background|DesktopBackground|Drive)\\shellex\\ContextMenuHandlers\\[^\\]+$"
        if (-not $isVerbPath -and -not $isHandlerPath) { return @{ success = $false; error = "注册表路径不在允许范围内" } }
        $nativePath = $registryPath -replace "^HKCU:", "HKEY_CURRENT_USER" -replace "^HKLM:", "HKEY_LOCAL_MACHINE"
        $regeditState = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Applets\Regedit"
        if (-not (Test-Path $regeditState)) { New-Item -Path $regeditState -Force | Out-Null }
        Set-ItemProperty -Path $regeditState -Name "LastKey" -Value "Computer\$nativePath" -Force
        Start-Process "regedit.exe"
        return @{ success = $true }
    }
    catch { return @{ success = $false; error = $_.Exception.Message } }
}
