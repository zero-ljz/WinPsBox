param(
    [string]$PlaywrightCorePath = $env:PLAYWRIGHT_CORE_PATH,
    [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent

if (-not $NodePath) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "Node.js 20 or newer is required to run the WebView2 Playwright tests."
}

if (-not $PlaywrightCorePath) {
    $localPlaywright = Join-Path $repoRoot "node_modules\playwright-core"
    if (Test-Path -LiteralPath $localPlaywright -PathType Container) {
        $PlaywrightCorePath = $localPlaywright
    }
    else {
        $bundledPlaywright = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright-core"
        if (Test-Path -LiteralPath $bundledPlaywright -PathType Container) {
            $PlaywrightCorePath = $bundledPlaywright
        }
    }
}
if (-not $PlaywrightCorePath -or -not (Test-Path -LiteralPath $PlaywrightCorePath -PathType Container)) {
    throw "playwright-core was not found. Set PLAYWRIGHT_CORE_PATH or install it under node_modules."
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$debugPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("WinPsBox-e2e-" + [Guid]::NewGuid().ToString("N"))
$testProcess = $null
$previousWebViewArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousCdpUrl = $env:WINPSBOX_CDP_URL
$previousPlaywrightPath = $env:PLAYWRIGHT_CORE_PATH
$exitCode = 1

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    Get-ChildItem -LiteralPath $repoRoot -Force |
        Where-Object { $_.Name -notin @(".git", "data", "node_modules") } |
        Copy-Item -Destination $testRoot -Recurse -Force

    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort --remote-allow-origins=*"
    $testProcess = Start-Process powershell.exe -ArgumentList @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", (Join-Path $testRoot "app.ps1")
    ) -PassThru
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArguments

    $deadline = (Get-Date).AddSeconds(30)
    do {
        try {
            $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$debugPort/json" -TimeoutSec 2)
            if ($targets | Where-Object { $_.url -like "file:*/ui/index.html" }) { break }
        }
        catch { }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline -and -not $testProcess.HasExited)

    if ($testProcess.HasExited) { throw "The isolated WinPsBox test process exited before WebView2 initialized." }
    if ((Get-Date) -ge $deadline) { throw "WebView2 did not expose its Playwright endpoint within 30 seconds." }

    $env:WINPSBOX_CDP_URL = "http://127.0.0.1:$debugPort"
    $env:PLAYWRIGHT_CORE_PATH = (Resolve-Path -LiteralPath $PlaywrightCorePath).Path
    & $NodePath (Join-Path $PSScriptRoot "webview-playwright.e2e.js")
    $exitCode = $LASTEXITCODE
}
finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArguments
    $env:WINPSBOX_CDP_URL = $previousCdpUrl
    $env:PLAYWRIGHT_CORE_PATH = $previousPlaywrightPath

    if ($testProcess -and -not $testProcess.HasExited) {
        Stop-Process -Id $testProcess.Id -Force -ErrorAction SilentlyContinue
        $testProcess.WaitForExit(5000) | Out-Null
    }

    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $testLeaf = Split-Path $resolvedTestRoot -Leaf
    if ($resolvedTestRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and $testLeaf.StartsWith("WinPsBox-e2e-")) {
        for ($attempt = 0; $attempt -lt 10 -and (Test-Path -LiteralPath $resolvedTestRoot); $attempt++) {
            Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path -LiteralPath $resolvedTestRoot) { Start-Sleep -Milliseconds 300 }
        }
    }
}

exit $exitCode
