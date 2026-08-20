# WinPsBox

[English](README.md) | [简体中文](README_zh.md)

> A lightweight Windows toolbox for developers and sysadmins, powered by PowerShell and WebView2.

---

## ✨ Key Features

### 🌐 Network Tools
- **Network Adapter & DNS Switcher**: Quick toggle between DHCP / Static IP and major public DNS providers (AliDNS, DNSPod, Cloudflare, Google, etc.), with one-click DNS cache flushing.
- **PortProxy Manager**: Visual manager for `netsh interface portproxy` forwarding rules with on-demand UAC elevation.
- **LAN Device Discovery**: High-speed discovery of active LAN devices (IP, MAC, Hostname) with automated OUI vendor identification.
- **Domain Diagnostics**: Comprehensive testing for SSL/TLS certificate validity, DNS / DoH records, and IP ASN / Whois registration info.
- **System & Terminal Proxy**: Fast switching of Windows Global / PAC proxy, plus one-click copy of terminal proxy commands (PowerShell / CMD / Bash).
- **Port Inspector & Connectivity**: Inspect processes occupying local ports (PID / Name) or test TCP port reachability on remote hosts.
- **Network Link Diagnostics**: Ping jitter & latency analysis, hop-by-hop Traceroute, and Windows IPv4 routing table viewer.
- **Socket / WebSocket Debugger**: Real-time interactive debugger for TCP and WebSocket connections supporting Text, Hex, and Base64 payloads.
- **Local CA & Cert Generator**: Create and trust local Root CAs and generate SAN HTTPS certificates for localhost, LAN IPs, and test domains.

### ⚙️ System Operations
- **Windows Service Manager**: Search and manage Windows system services, with quick start, stop, restart, and startup type configuration.
- **WinGet Package Manager**: GUI wrapper for WinGet to search, install, upgrade, uninstall, and batch-manage installed applications.
- **File Lock Hunter**: Identify processes locking files using native Windows Restart Manager and unlock/terminate them safely.
- **Scheduled Tasks & Power**: Set one-time or recurring schedules for Shutdown, Restart, Sleep, Lock Screen, or custom scripts.
- **Context Menu Manager**: Inspect, enable, or disable context menu items for files, folders, and desktop background.
- **Environment Variables**: View, search, and edit User and System PATH and environment variables cleanly.
- **Hosts Quick Switcher**: Easily read, switch, and edit system Hosts rules with backup and restore support.

---

## 🛠️ Architecture & Tech Stack

- **Backend Engine**: PowerShell 5.1+ / .NET Windows Forms
- **Frontend Interface**: HTML5 + CSS3 + Vanilla JavaScript + Bootstrap 5 + Lucide Icons
- **Webview Engine**: Microsoft Edge WebView2 (Chromium-based)
- **IPC Protocol**: Native bidirectional `WebMessage` messaging

---

## 📋 Prerequisites

- **Operating System**: Windows 10 / Windows 11 (x64)
- **PowerShell**: PowerShell 5.1 or later (pre-installed on Windows)
- **WebView2 Runtime**: Microsoft Edge WebView2 Runtime (built-in on Windows 11 & modern Windows 10; downloadable from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/))

---

## 🚀 Quick Start

### Option 1: Double Click
Simply double-click **`WinPsBox.bat`** in the project root.

### Option 2: Command Line
Run via PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -STA -File .\app.ps1
```

> **Tip**: Administrative privileges may be requested for advanced operations like PortProxy, Hosts editing, or Windows Service configuration.

---

## 📁 Directory Structure

```text
WinPsBox/
├── app.ps1              # Main application entry (WinForms + WebView2 init)
├── WinPsBox.bat         # Quick startup batch file
├── LICENSE              # MIT License
├── README.md            # English Documentation
├── README_zh.md         # Chinese Documentation
├── lib/                 # WebView2 binaries (.NET DLLs & Loader)
├── powershell/          # Backend PowerShell modules & IPC routing
│   ├── Common.ps1
│   ├── IpcRouter.ps1
│   ├── NetworkTools.ps1
│   ├── SystemTools.ps1
│   └── ...
├── ui/                  # Frontend UI assets
│   ├── index.html       # Workbench main UI
│   ├── css/             # Stylesheets
│   ├── js/              # Application logic & tool modules
│   └── vendor/          # Bootstrap & Lucide vendor assets
└── data/                # Runtime data & configuration cache (WebView2 data, etc.)
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
