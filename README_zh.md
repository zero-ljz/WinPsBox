# WinPsBox

[English](README.md) | [简体中文](README_zh.md)

> 专为开发者与系统管理员打造的轻量级 Windows 工具箱，基于 **PowerShell + WebView2** 构建，免去 Electron/Node.js 等庞大运行时依赖，开箱即用。

---

## ✨ 核心特性

### 🌐 网络工具
- **网卡与 DNS 切换器**：快速切换 DHCP / 静态 IP 及主流公共 DNS（AliDNS、DNSPod、Cloudflare 等），支持一键刷新 DNS 缓存。
- **端口代理管理器 (PortProxy)**：可视化管理 `netsh interface portproxy` 转发规则，支持一键按需提权。
- **局域网设备发现**：高速扫描局域网存活设备（IP、MAC、主机名），内置 OUI 硬件厂商自动识别。
- **域名综合诊断**：一键检测 SSL/TLS 证书有效性、DNS/DoH 解析记录及 IP ASN / Whois 信息。
- **系统与终端代理管理**：快速开关 Windows 全局/PAC 代理，一键复制终端代理命令（PowerShell / CMD / Bash）。
- **端口占用与连通性探测**：快速排查本地端口占用进程（PID / 进程名），或探测远程主机 TCP 端口。
- **网络链路诊断**：集成 Ping 延迟抖动测试、逐跳 Traceroute 追踪与 Windows 路由表查询。
- **Socket / WebSocket 调试台**：支持 TCP 与 WebSocket 长连接实时调试，支持 Text / Hex / Base64 收发。
- **本地 CA 与证书生成器**：一键签发并信任本地 Root CA，快速生成 localhost / 局域网 HTTPS 证书。

### ⚙️ 系统运维
- **Windows 服务管理器**：查看与检索系统服务状态，快捷启停、重启及修改自启动类型。
- **WinGet 软件包管理**：图形化管理 WinGet 软件源，支持应用搜索、安装、升级与批量卸载。
- **文件占用与句柄解锁**：基于 Windows 原生 Restart Manager 快速定位锁定文件的进程并安全解锁。
- **定时任务与电源中心**：支持定时关机、重启、睡眠、锁屏或执行自定义脚本程序。
- **右键菜单管理**：清理与管理文件、文件夹及桌面的右键上下文菜单。
- **系统环境变量管理**：可视化查看、搜索与编辑用户和系统的 PATH 及环境变量。
- **Hosts 快速切换器**：快速编辑与切换系统 Hosts 规则，支持配置导入与备份。
- **一键诊断与报告中心**：集中检查系统、磁盘、网络、DNS、代理与关键服务，支持导出 Markdown 或 JSON 报告。

### 开发工具
- **SSH / OpenSSH 管理器**：检查与安装 Windows OpenSSH 组件，管理 `sshd` 服务、用户密钥并测试 SSH 端点。
- **WSL 管理中心**：查看已安装发行版，启动、终止和切换默认发行版，支持更新 WSL 与在线安装。
- **开发文本工具箱**：在本地处理 JSON、Base64、URL、JWT、时间戳、消息摘要与 UUID。

---

## 🛠️ 技术架构

- **后端引擎**：PowerShell 5.1+ / .NET Windows Forms
- **前端界面**：HTML5 + CSS3 + Vanilla JavaScript + Bootstrap 5 + Lucide Icons
- **渲染内核**：Microsoft Edge WebView2 (基于 Chromium)
- **进程通信**：基于 WebView2 `WebMessage` 原生双向 IPC

---

## 📋 环境要求

- **操作系统**：Windows 10 / Windows 11 (x64)
- **PowerShell**：PowerShell 5.1 或更高版本（Windows 系统自带）
- **WebView2 运行时**：Microsoft Edge WebView2 Runtime（Win11 及较新 Win10 已内置，若缺失可前往 [微软官网下载](https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/)）

---

## 🚀 快速开始

### 方式一：双击启动
直接双击根目录下的 **`WinPsBox.bat`** 即可启动。

### 方式二：命令行启动
在 PowerShell 终端中执行：
```powershell
powershell -ExecutionPolicy Bypass -STA -File .\app.ps1
```

> **提示**：如需执行端口代理、修改 Hosts 或服务管理等高级操作，建议以管理员身份运行或通过应用内提权按钮申请提权。

---

## 📁 目录结构

```text
WinPsBox/
├── app.ps1              # 应用程序主入口（WinForms + WebView2 初始化）
├── WinPsBox.bat         # 快捷启动脚本
├── LICENSE              # 开源许可证 (MIT)
├── README.md            # 英文说明文档
├── README_zh.md         # 中文说明文档
├── lib/                 # WebView2 依赖库 (.NET DLLs & Loader)
├── powershell/          # 后端功能模块与 IPC 路由
│   ├── Common.ps1
│   ├── IpcRouter.ps1
│   ├── NetworkTools.ps1
│   ├── SystemTools.ps1
│   └── ...
├── ui/                  # 前端界面静态资源
│   ├── index.html       # 工作台主界面
│   ├── css/             # 样式表
│   ├── js/              # 页面交互与工具逻辑
│   └── vendor/          # Bootstrap / Lucide 前端依赖
└── data/                # 运行时数据与配置存储 (WebView2 数据等)
```

---

## 📄 开源许可

本项目采用 [MIT License](LICENSE) 开源许可。
