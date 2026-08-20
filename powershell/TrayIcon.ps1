# Native system tray integration and quick actions.
$script:AllowAppExit = $false
$script:TrayHintShown = $false
$script:MinimizeToTray = $true
$script:TrayToolCatalog = [ordered]@{
    "net-adapter-dns" = "网卡与 DNS 切换器"
    "portproxy-manager" = "Windows 端口代理管理器"
    "lan-scanner" = "局域网设备扫描发现"
    "domain-diagnostic" = "域名诊断"
    "proxy-manager" = "系统与终端代理管理"
    "port-checker" = "端口占用与探测"
    "network-link-diagnostic" = "网络链路诊断"
    "socket-debugger" = "WebSocket / Socket 调试台"
    "local-cert-generator" = "本地 CA 与多域名证书生成器"
    "wifi-analyzer" = "Wi-Fi 分析器"
    "http-redirect-tracer" = "HTTP 重定向追踪"
    "service-manager" = "Windows 服务管理器"
    "winget-manager" = "WinGet 软件包管理"
    "file-lock-hunter" = "文件占用与句柄解锁"
    "scheduled-tasks" = "定时任务中心"
    "context-menu-manager" = "右键菜单管理器"
    "env-viewer" = "系统环境变量管理"
    "hosts-editor" = "Hosts 快速切换器"
}

function New-AppIcon {
    $bitmap = New-Object System.Drawing.Bitmap(32, 32)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(31, 107, 99))
    $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 180, 64))
    $foreground = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $outline = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(15, 66, 62), 1.5)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath

    try {
        $path.AddArc(2, 2, 8, 8, 180, 90)
        $path.AddArc(22, 2, 8, 8, 270, 90)
        $path.AddArc(22, 22, 8, 8, 0, 90)
        $path.AddArc(2, 22, 8, 8, 90, 90)
        $path.CloseFigure()
        $graphics.FillPath($background, $path)
        $graphics.DrawPath($outline, $path)

        $graphics.FillRectangle($foreground, 8, 8, 7, 7)
        $graphics.FillRectangle($foreground, 17, 8, 7, 7)
        $graphics.FillRectangle($foreground, 8, 17, 7, 7)
        $graphics.FillRectangle($accent, 17, 17, 7, 7)

        $iconHandle = $bitmap.GetHicon()
        try {
            return ([System.Drawing.Icon]::FromHandle($iconHandle).Clone())
        }
        finally {
            if (-not ('TrayIconNativeMethods' -as [type])) {
                Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TrayIconNativeMethods
{
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
'@
            }
            [TrayIconNativeMethods]::DestroyIcon($iconHandle) | Out-Null
        }
    }
    finally {
        $path.Dispose()
        $outline.Dispose()
        $foreground.Dispose()
        $accent.Dispose()
        $background.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Show-AppWindow {
    if ($null -eq $form -or $form.IsDisposed) { return }

    $form.ShowInTaskbar = $true
    if (-not $form.Visible) { $form.Show() }
    if ($form.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
        $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    }
    $form.Activate()
    $form.BringToFront()
}

function Hide-AppToTray([bool]$showHint = $true) {
    if ($null -eq $form -or $form.IsDisposed) { return }

    $form.ShowInTaskbar = $false
    $form.Hide()

    if ($showHint -and -not $script:TrayHintShown -and $null -ne $script:TrayIcon) {
        $script:TrayHintShown = $true
        $script:TrayIcon.BalloonTipTitle = "WinPsBox 正在后台运行"
        $script:TrayIcon.BalloonTipText = "双击图标打开工具箱，右键可使用快捷面板。"
        $script:TrayIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $script:TrayIcon.ShowBalloonTip(2500)
    }
}

function Invoke-AppView([string]$view, [string]$toolId = "") {
    Show-AppWindow
    if ($null -eq $webView.CoreWebView2) { return }

    if ($toolId) {
        $safeToolId = $toolId.Replace("'", "\'")
        $scriptCode = "if (typeof ToolRegistry !== 'undefined') { ToolRegistry.openToolWorkspace('$safeToolId'); }"
    }
    else {
        $safeView = $view.Replace("'", "\'")
        $scriptCode = "if (typeof AppNavigation !== 'undefined') { AppNavigation.switchView('$safeView'); }"
    }
    $null = $webView.CoreWebView2.ExecuteScriptAsync($scriptCode)
}

function Set-AppConfigProperty([string]$name, $value) {
    $config = Get-AppConfig
    if ($null -eq $config.PSObject.Properties[$name]) {
        $config | Add-Member -NotePropertyName $name -NotePropertyValue $value
    }
    else {
        $config.$name = $value
    }
    return Save-AppConfig -configObj $config
}

function Set-AppTrayBehavior([bool]$enabled) {
    $script:MinimizeToTray = $enabled
    return Set-AppConfigProperty -name "minimizeToTray" -value $enabled
}

function Set-AppAutoStartFromTray([bool]$enabled) {
    $result = Set-AutoStartStatus -enable $enabled
    if (-not $result.success) {
        [System.Windows.Forms.MessageBox]::Show(
            $result.error,
            "开机自启动设置失败",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        return
    }

    Set-AppConfigProperty -name "autoStart" -value $enabled | Out-Null
    if ($null -ne $webView.CoreWebView2) {
        $checked = if ($enabled) { "true" } else { "false" }
        $scriptCode = "if (typeof SettingsManager !== 'undefined') { SettingsManager.autoStartEnabled = $checked; const el = document.getElementById('switchAutoStart'); if (el) el.checked = $checked; }"
        $null = $webView.CoreWebView2.ExecuteScriptAsync($scriptCode)
    }
}

function Restart-AppElevated {
    try {
        $appScript = Join-Path $script:AppRoot "app.ps1"
        Start-Process powershell.exe -ArgumentList "-STA -NoProfile -ExecutionPolicy Bypass -File `"$appScript`"" -Verb RunAs
        Request-AppExit
    }
    catch {
        if ($_.Exception.Message -notmatch "cancel|canceled") {
            [System.Windows.Forms.MessageBox]::Show(
                $_.Exception.Message,
                "管理员模式启动失败",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            ) | Out-Null
        }
    }
}

function Request-AppExit {
    $script:AllowAppExit = $true
    if ($null -ne $script:TrayIcon) { $script:TrayIcon.Visible = $false }
    if ($null -ne $form -and -not $form.IsDisposed) { $form.Close() }
}

function New-TrayMenuItem([string]$text, [scriptblock]$onClick) {
    $item = New-Object System.Windows.Forms.ToolStripMenuItem
    $item.Text = $text
    if ($null -ne $onClick) { $item.Add_Click($onClick) }
    return $item
}

function Update-TrayFavoriteMenu {
    if ($null -eq $script:TrayQuickMenu) { return }

    foreach ($existingItem in @($script:TrayQuickMenu.DropDownItems)) {
        [void]$script:TrayQuickMenu.DropDownItems.Remove($existingItem)
        $existingItem.Dispose()
    }
    $config = Get-AppConfig
    $favoriteIds = @($config.favorites)
    $validCount = 0

    foreach ($favoriteId in $favoriteIds) {
        $toolId = [string]$favoriteId
        $toolTitle = $script:TrayToolCatalog[$toolId]
        if (-not $toolTitle) { continue }

        $favoriteItem = New-TrayMenuItem $toolTitle $null
        $favoriteItem.Tag = $toolId
        $favoriteItem.Add_Click({
            Invoke-AppView -view "workspace" -toolId ([string]$this.Tag)
        })
        [void]$script:TrayQuickMenu.DropDownItems.Add($favoriteItem)
        $validCount++
    }

    $script:TrayQuickMenu.Text = "快速打开收藏 ($validCount)"
    if ($validCount -eq 0) {
        $emptyItem = New-TrayMenuItem "暂无收藏工具" $null
        $emptyItem.Enabled = $false
        [void]$script:TrayQuickMenu.DropDownItems.Add($emptyItem)
    }
}

function Initialize-AppTray {
    $config = Get-AppConfig
    if ($null -ne $config.PSObject.Properties["minimizeToTray"]) {
        $script:MinimizeToTray = [bool]$config.minimizeToTray
    }

    $script:AppIcon = New-AppIcon
    $form.Icon = $script:AppIcon

    $script:TrayMenu = New-Object System.Windows.Forms.ContextMenuStrip
    $script:TrayMenu.ShowImageMargin = $false
    $script:TrayMenu.ShowCheckMargin = $true
    $script:TrayMenu.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

    $statusItem = New-TrayMenuItem "WinPsBox · 本地运行中" $null
    $statusItem.Enabled = $false
    $statusItem.Font = New-Object System.Drawing.Font($script:TrayMenu.Font, [System.Drawing.FontStyle]::Bold)

    $script:TrayShowItem = New-TrayMenuItem "打开 WinPsBox" { Show-AppWindow }
    $script:TrayShowItem.Font = New-Object System.Drawing.Font($script:TrayMenu.Font, [System.Drawing.FontStyle]::Bold)

    $script:TrayQuickMenu = New-TrayMenuItem "快速打开收藏" $null
    Update-TrayFavoriteMenu

    $settingsItem = New-TrayMenuItem "应用设置" { Invoke-AppView -view "settings" }
    $script:TrayAutoStartItem = New-TrayMenuItem "开机自启动" {
        Set-AppAutoStartFromTray -enabled (-not (Get-AutoStartStatus))
    }
    $adminItem = New-TrayMenuItem "以管理员身份重启" { Restart-AppElevated }
    $exitItem = New-TrayMenuItem "退出 WinPsBox" { Request-AppExit }

    [void]$script:TrayMenu.Items.Add($statusItem)
    [void]$script:TrayMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    [void]$script:TrayMenu.Items.Add($script:TrayShowItem)
    [void]$script:TrayMenu.Items.Add($script:TrayQuickMenu)
    [void]$script:TrayMenu.Items.Add($settingsItem)
    [void]$script:TrayMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    [void]$script:TrayMenu.Items.Add($script:TrayAutoStartItem)
    if (-not (Test-IsAdmin)) { [void]$script:TrayMenu.Items.Add($adminItem) }
    [void]$script:TrayMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
    [void]$script:TrayMenu.Items.Add($exitItem)

    $script:TrayMenu.Add_Opening({
        $script:TrayAutoStartItem.Checked = Get-AutoStartStatus
        Update-TrayFavoriteMenu
        $isWindowOpen = $form.Visible -and $form.WindowState -ne [System.Windows.Forms.FormWindowState]::Minimized
        $script:TrayShowItem.Text = if ($isWindowOpen) { "WinPsBox 已打开" } else { "打开 WinPsBox" }
        $script:TrayShowItem.Enabled = -not $isWindowOpen
    })

    $script:TrayIcon = New-Object System.Windows.Forms.NotifyIcon
    $script:TrayIcon.Icon = $script:AppIcon
    $script:TrayIcon.Text = "WinPsBox - 开发者与系统管理员工具箱"
    $script:TrayIcon.ContextMenuStrip = $script:TrayMenu
    $script:TrayIcon.Visible = $true
    $script:TrayIcon.Add_DoubleClick({ Show-AppWindow })
    $script:TrayIcon.Add_BalloonTipClicked({ Show-AppWindow })

    $form.Add_Resize({
        if ($script:MinimizeToTray -and $form.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
            Hide-AppToTray
        }
    })

    $form.Add_FormClosing({
        param($sender, $eventArgs)
        if (-not $script:AllowAppExit -and $script:MinimizeToTray -and $eventArgs.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
            $eventArgs.Cancel = $true
            Hide-AppToTray
        }
    })

    $form.Add_FormClosed({
        $script:TrayIcon.Visible = $false
        $script:TrayIcon.Dispose()
        $script:TrayMenu.Dispose()
        $script:AppIcon.Dispose()
    })
}
