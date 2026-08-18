Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$libPath = Join-Path $PSScriptRoot "lib"

# Make the native WebView2 loader visible to the WinForms control.
$env:PATH = $libPath + [System.IO.Path]::PathSeparator + $env:PATH

Add-Type -Path (Join-Path $libPath "Microsoft.Web.WebView2.Core.dll")
Add-Type -Path (Join-Path $libPath "Microsoft.Web.WebView2.WinForms.dll")

$form = New-Object System.Windows.Forms.Form
$form.Text = "PowerShell WebView2"
$form.Width = 1000
$form.Height = 700
$form.StartPosition = "CenterScreen"

$htmlPath = Join-Path $PSScriptRoot "ui\index.html"
$htmlUri = [System.Uri]::new((Resolve-Path $htmlPath).Path)

# Keep the WebView2 profile beside the app for portable deployment.
$userDataPath = Join-Path $PSScriptRoot "data\WebView2Data"
[System.IO.Directory]::CreateDirectory($userDataPath) | Out-Null

$webView = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$creationProperties = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$creationProperties.UserDataFolder = $userDataPath
$webView.CreationProperties = $creationProperties
$webView.Tag = $htmlUri
$webView.Dock = [System.Windows.Forms.DockStyle]::Fill

# Navigate only after the WebView2 control reports successful initialization.
$webView.add_CoreWebView2InitializationCompleted({
    param($sender, $eventArgs)

    if (-not $eventArgs.IsSuccess) {
        $message = if ($eventArgs.InitializationException) {
            $exception = $eventArgs.InitializationException
            "Type: $($exception.GetType().FullName)`r`nHResult: 0x$('{0:X8}' -f ($exception.HResult -band 0xffffffff))`r`n$($exception.ToString())"
        } else {
            "WebView2 initialization failed. User data folder: $userDataPath"
        }

        [System.Windows.Forms.MessageBox]::Show(
            $message,
            "WebView2 Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
        return
    }

    $sender.CoreWebView2.Navigate($sender.Tag.AbsoluteUri)
})

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
