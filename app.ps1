Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:AppRoot = $PSScriptRoot
$script:PowerShellRoot = Join-Path $script:AppRoot "powershell"

$libPath = Join-Path $script:AppRoot "lib"
$dataPath = Join-Path $script:AppRoot "data"
$configFile = Join-Path $dataPath "config.json"
$userDataPath = Join-Path $dataPath "WebView2Data"

[System.IO.Directory]::CreateDirectory($dataPath) | Out-Null
[System.IO.Directory]::CreateDirectory($userDataPath) | Out-Null

# Make the native WebView2 loader visible to the WinForms control.
$env:PATH = $libPath + [System.IO.Path]::PathSeparator + $env:PATH

Add-Type -Path (Join-Path $libPath "Microsoft.Web.WebView2.Core.dll")
Add-Type -Path (Join-Path $libPath "Microsoft.Web.WebView2.WinForms.dll")

. (Join-Path $script:PowerShellRoot "Common.ps1")
. (Join-Path $script:PowerShellRoot "NetworkTools.ps1")
. (Join-Path $script:PowerShellRoot "SystemTools.ps1")
. (Join-Path $script:PowerShellRoot "NetworkDeveloperTools.ps1")
. (Join-Path $script:PowerShellRoot "WingetBridge.ps1")
. (Join-Path $script:PowerShellRoot "IpcRouter.ps1")

# ----------------- Main Window -----------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "DevTools Box - Toolbox"
$form.Width = 1180
$form.Height = 780
$form.MinimumSize = New-Object System.Drawing.Size(900, 600)
$form.StartPosition = "CenterScreen"

$htmlPath = Join-Path $script:AppRoot "ui\index.html"
$htmlUri = [System.Uri]::new((Resolve-Path $htmlPath).Path)

$webView = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$creationProperties = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$creationProperties.UserDataFolder = $userDataPath
$webView.CreationProperties = $creationProperties
$webView.Tag = $htmlUri
$webView.Dock = [System.Windows.Forms.DockStyle]::Fill

Register-AppWebViewHandlers -webView $webView

$form.Controls.Add($webView)

$form.Add_Shown({
    try {
        if ($null -eq $webView.CoreWebView2) {
            $null = $webView.EnsureCoreWebView2Async()
        }
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.ToString(),
            "WebView2 Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
    }
})

[void]$form.ShowDialog()
