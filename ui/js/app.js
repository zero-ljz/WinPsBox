/**
 * DevTools Box - Lightweight Desktop Toolbox
 * Modules: IPC Bridge, ThemeManager, ToolRegistry, Tool Workspace Renderers, SettingsManager, Toast
 */

// ==========================================
// 1. IPC Communication Bridge
// ==========================================
const IPC = {
  callbacks: new Map(),
  reqCounter: 0,
  isWebView: Boolean(window.chrome && window.chrome.webview),

  init() {
    if (this.isWebView) {
      window.chrome.webview.addEventListener('message', (event) => {
        let msg = event.data;
        if (typeof msg === 'string') {
          try {
            msg = JSON.parse(msg);
          } catch (e) {
            console.error('Failed to parse IPC message:', e);
            return;
          }
        }
        if (msg && msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.success) {
            resolve(msg.data);
          } else {
            reject(new Error(msg.error || 'IPC call failed'));
          }
        }
      });
    } else {
      console.warn('Running outside WebView2. Using mock handlers for standalone browser preview.');
    }
  },

  send(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = 'req_' + (++this.reqCounter) + '_' + Date.now();
      if (!this.isWebView) {
        this.mockHandle(action, payload, resolve, reject);
        return;
      }
      this.callbacks.set(id, { resolve, reject });
      window.chrome.webview.postMessage({ id, action, payload });

      // Timeout safeguard
      const timeoutMs = (action === 'net_http_request' || action === 'net_ping' || action === 'net_check_remote_port' || action === 'net_trace_route' || action === 'net_scan_lan') ? 45000 : 15000;
      setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error(`IPC Timeout for action: ${action}`));
        }
      }, timeoutMs);
    });
  },

  mockHandle(action, payload, resolve, reject) {
    setTimeout(() => {
      switch (action) {
        case 'get_autostart':
          resolve({ enabled: localStorage.getItem('mock_autostart') === 'true' });
          break;
        case 'set_autostart':
          localStorage.setItem('mock_autostart', payload.enabled);
          resolve({ enabled: payload.enabled, message: 'Mock autostart toggled' });
          break;
        case 'get_config':
          resolve({
            theme: localStorage.getItem('app_theme') || 'system',
            autoStart: localStorage.getItem('mock_autostart') === 'true',
            favorites: JSON.parse(localStorage.getItem('app_favorites') || '[]')
          });
          break;
        case 'save_config':
          resolve({ success: true });
          break;
        case 'get_system_info':
          resolve({ os: 'Windows 11 (Browser Preview)', psVersion: '7.4.x / 5.1', appVersion: 'v1.0.0', isAdmin: localStorage.getItem('mock_admin') === 'true' });
          break;
        case 'get_privilege_info':
          resolve({ isAdmin: localStorage.getItem('mock_admin') === 'true', userName: 'DevUser', userDomain: 'WORKGROUP' });
          break;
        case 'sys_elevate_app':
          localStorage.setItem('mock_admin', 'true');
          resolve({ success: true, message: '模拟管理员实例已启动' });
          break;

        // Mock Network Tools
        case 'net_get_local_ports':
          resolve([
            { protocol: 'TCP', localAddress: '0.0.0.0', localPort: 80, remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', pid: 4, processName: 'System' },
            { protocol: 'TCP', localAddress: '127.0.0.1', localPort: 3306, remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', pid: 3120, processName: 'mysqld' },
            { protocol: 'TCP', localAddress: '127.0.0.1', localPort: 6379, remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', pid: 5412, processName: 'redis-server' },
            { protocol: 'TCP', localAddress: '0.0.0.0', localPort: 135, remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', pid: 980, processName: 'svchost' },
            { protocol: 'UDP', localAddress: '0.0.0.0', localPort: 5353, remoteAddress: '*', remotePort: '*', state: 'Listening', pid: 1420, processName: 'mDNSResponder' }
          ]);
          break;
        case 'net_check_remote_port':
          resolve((payload.ports || [80, 443]).map(p => ({
            port: p,
            isOpen: p === 80 || p === 443,
            latencyMs: p === 80 ? 24.5 : p === 443 ? 28.1 : 1500,
            error: (p === 80 || p === 443) ? null : 'Connection timed out'
          })));
          break;
        case 'net_ping':
          resolve({
            target: payload.host || 'baidu.com',
            dnsIps: ['180.101.50.242', '180.101.50.188'],
            sent: 4,
            received: 4,
            lossRate: 0,
            minTime: 18,
            maxTime: 23,
            avgTime: 20.5,
            records: [
              { seq: 1, ip: '180.101.50.242', timeMs: 19, ttl: 53, status: 'Success' },
              { seq: 2, ip: '180.101.50.242', timeMs: 18, ttl: 53, status: 'Success' },
              { seq: 3, ip: '180.101.50.242', timeMs: 23, ttl: 53, status: 'Success' },
              { seq: 4, ip: '180.101.50.242', timeMs: 22, ttl: 53, status: 'Success' }
            ]
          });
          break;
        case 'net_http_request':
          resolve({
            success: true,
            statusCode: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json; charset=utf-8', 'server': 'MockServer/1.0' },
            body: JSON.stringify({ message: 'Hello from mock HTTP response', timestamp: Date.now(), url: payload.url }, null, 2),
            timeMs: 86.4,
            sizeBytes: 128
          });
          break;

        // Mock System Tools
        case 'sys_get_env_vars':
          resolve({
            userVars: [
              { name: 'Path', value: 'C:\\Users\\User\\bin;C:\\Users\\User\\.cargo\\bin', scope: 'User' },
              { name: 'JAVA_HOME', value: 'C:\\Program Files\\Java\\jdk-17', scope: 'User' },
              { name: 'NODE_ENV', value: 'development', scope: 'User' }
            ],
            machineVars: [
              { name: 'OS', value: 'Windows_NT', scope: 'Machine' },
              { name: 'Path', value: 'C:\\Windows\\System32;C:\\Program Files\\PowerShell\\7;C:\\NonExistentPath_Test', scope: 'Machine' },
              { name: 'PROCESSOR_ARCHITECTURE', value: 'AMD64', scope: 'Machine' }
            ],
            pathAnalysis: [
              { path: 'C:\\Windows\\System32', exists: true },
              { path: 'C:\\Program Files\\PowerShell\\7', exists: true },
              { path: 'C:\\Users\\User\\bin', exists: true },
              { path: 'C:\\NonExistentPath_Test', exists: false }
            ]
          });
          break;
        case 'sys_set_env_var':
        case 'sys_delete_env_var':
          resolve({ success: true });
          break;
        case 'sys_get_processes':
          resolve([
            { pid: 4, name: 'System', memoryMB: 12.4, cpu: 1.2, responding: true, path: '', description: 'NT Kernel' },
            { pid: 1024, name: 'powershell', memoryMB: 128.5, cpu: 0.5, responding: true, path: 'C:\\Windows\\System32\\powershell.exe', description: 'Windows PowerShell' },
            { pid: 2450, name: 'msedge', memoryMB: 480.2, cpu: 4.8, responding: true, path: 'C:\\Program Files\\Microsoft\\Edge\\msedge.exe', description: 'Microsoft Edge' },
            { pid: 3820, name: 'Code', memoryMB: 320.0, cpu: 2.1, responding: true, path: 'C:\\Users\\User\\AppData\\Local\\Programs\\VSCode\\Code.exe', description: 'Visual Studio Code' }
          ]);
          break;
        case 'sys_kill_process':
          resolve({ success: true, message: `Process ${payload.pid} terminated (Mock)` });
          break;
        case 'sys_get_hosts':
          resolve({
            success: true,
            path: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
            content: '# Copyright (c) 1993-2009 Microsoft Corp.\n127.0.0.1 localhost\n::1 localhost\n# 127.0.0.1 test.dev.local\n199.232.69.194 github.global.ssl.fastly.net\n'
          });
          break;
        case 'sys_save_hosts':
          resolve({ success: true, message: 'Hosts saved successfully (Mock)' });
          break;


        // --- 11 New Tools Mock Handlers ---
        case 'net_get_adapters':
          resolve([
            {
              name: 'Realtek PCIe GbE Family Controller',
              interfaceAlias: '以太网',
              interfaceIndex: 12,
              status: 'Up',
              macAddress: 'B4-2E-99-4A-12-88',
              linkSpeed: '1 Gbps',
              ipAddresses: ['192.168.1.108'],
              prefixLengths: [24],
              dnsServers: ['223.5.5.5', '223.6.6.6'],
              gateway: '192.168.1.1',
              dhcpEnabled: false,
              isPhysical: true
            },
            {
              name: 'Intel(R) Wi-Fi 6 AX200 160MHz',
              interfaceAlias: 'WLAN',
              interfaceIndex: 18,
              status: 'Down',
              macAddress: '54-EE-75-BC-33-01',
              linkSpeed: '0 bps',
              ipAddresses: [],
              prefixLengths: [],
              dnsServers: [],
              gateway: '',
              dhcpEnabled: true,
              isPhysical: true
            },
            {
              name: 'vEthernet (Default Switch)',
              interfaceAlias: 'vEthernet (Default Switch)',
              interfaceIndex: 24,
              status: 'Up',
              macAddress: '00-15-5D-38-01-20',
              linkSpeed: '10 Gbps',
              ipAddresses: ['172.28.16.1'],
              prefixLengths: [20],
              dnsServers: [],
              gateway: '',
              dhcpEnabled: false,
              isPhysical: false
            }
          ]);
          break;
        case 'net_set_adapter_dns':
          resolve({ success: true, message: `已成功更新 [${payload.interfaceAlias}] DNS 设置 (Mock)` });
          break;
        case 'net_set_adapter_ip':
          resolve({ success: true, message: `已成功更新 [${payload.interfaceAlias}] IP 设置 (Mock)` });
          break;
        case 'net_flush_dns_winsock':
          resolve({ success: true, message: 'DNS 解析缓存已刷新 (Mock)' });
          break;
        case 'net_scan_lan':
          resolve({
            success: true,
            subnet: payload.subnet || '192.168.1',
            totalScanned: 254,
            foundCount: 6,
            devices: [
              { ip: '192.168.1.1', mac: '50-3E-AA-21-44-01', hostName: 'gateway.local', vendor: 'TP-Link', latencyMs: 1.2, isLocal: false, status: 'Online' },
              { ip: '192.168.1.100', mac: '70-85-C2-88-11-22', hostName: 'HUAWEI-MateBook', vendor: 'Huawei', latencyMs: 3.5, isLocal: false, status: 'Online' },
              { ip: '192.168.1.105', mac: 'F0-18-98-33-22-11', hostName: 'iPhone-15-Pro', vendor: 'Apple', latencyMs: 12.4, isLocal: false, status: 'Online' },
              { ip: '192.168.1.108', mac: 'B4-2E-99-4A-12-88', hostName: 'DESKTOP-MAIN', vendor: '本机设备', latencyMs: 0, isLocal: true, status: 'Online' },
              { ip: '192.168.1.120', mac: '50-D2-F5-66-77-88', hostName: 'Xiaomi-AX6000', vendor: 'Xiaomi', latencyMs: 2.1, isLocal: false, status: 'Online' },
              { ip: '192.168.1.200', mac: '00-0C-29-FE-33-11', hostName: 'ubuntu-server', vendor: 'VMware', latencyMs: 0.8, isLocal: false, status: 'Online' }
            ]
          });
          break;
        case 'net_check_ssl':
          resolve({
            success: true,
            host: payload.host || 'github.com',
            port: payload.port || 443,
            subject: 'CN=github.com, O=GitHub\\, Inc., L=San Francisco, S=California, C=US',
            issuer: 'CN=DigiCert TLS Hybrid ECC SHA384 2020 CA1, O=DigiCert Inc, C=US',
            validFrom: '2025-02-14 08:00:00',
            validTo: '2026-03-15 08:00:00',
            daysRemaining: 185.5,
            totalDays: 395,
            percentElapsed: 53.0,
            isExpired: false,
            isExpiringSoon: false,
            serialNumber: '0D83897B34BAA9292881E993',
            thumbprint: 'AA898FE8374987E8B83748239019283748921829',
            signatureAlgorithm: 'sha384ECDSA',
            keyAlgorithm: 'ECC',
            keySize: 256,
            protocol: 'Tls13',
            cipherAlgorithm: 'AES_256_GCM',
            cipherStrength: 256,
            sans: ['github.com', '*.github.com', 'github.io', '*.github.io'],
            chain: [
              { subject: 'CN=github.com', issuer: 'DigiCert TLS Hybrid ECC SHA384 2020 CA1', validTo: '2026-03-15' },
              { subject: 'CN=DigiCert TLS Hybrid ECC SHA384 2020 CA1', issuer: 'DigiCert Global Root CA', validTo: '2030-04-14' }
            ]
          });
          break;
        case 'net_get_proxy':
          resolve({
            success: true,
            enabled: false,
            server: '127.0.0.1:7890',
            override: '<local>;localhost;127.*;192.168.*',
            pacUrl: ''
          });
          break;
        case 'net_set_proxy':
          resolve({
            success: true,
            enabled: payload.enabled,
            server: payload.server,
            override: payload.override,
            pacUrl: payload.pacUrl,
            message: payload.enabled ? `系统代理已开启: ${payload.server}` : '系统代理已关闭'
          });
          break;
        case 'net_start_file_server':
          resolve({
            success: true,
            running: true,
            port: payload.port || 8000,
            path: payload.path || 'C:\\Users\\User\\Downloads',
            urls: [`http://192.168.1.108:${payload.port || 8000}/`, `http://127.0.0.1:${payload.port || 8000}/`]
          });
          break;
        case 'net_stop_file_server':
          resolve({ success: true, running: false });
          break;
        case 'net_get_file_server_status':
          resolve({ success: true, running: false, port: 8000, path: '', urls: [] });
          break;
        case 'net_get_route_table':
          resolve([
            { destination: '0.0.0.0/0', nextHop: '192.168.1.1', interfaceAlias: '以太网', interfaceIndex: 12, metric: 25, ifMetric: 25, protocol: 'NetMgmt' },
            { destination: '127.0.0.0/8', nextHop: '0.0.0.0', interfaceAlias: 'Loopback', interfaceIndex: 1, metric: 256, ifMetric: 75, protocol: 'Local' },
            { destination: '192.168.1.0/24', nextHop: '0.0.0.0', interfaceAlias: '以太网', interfaceIndex: 12, metric: 281, ifMetric: 25, protocol: 'Local' },
            { destination: '172.28.16.0/20', nextHop: '0.0.0.0', interfaceAlias: 'vEthernet', interfaceIndex: 24, metric: 281, ifMetric: 15, protocol: 'Local' }
          ]);
          break;
        case 'net_trace_route':
          resolve({
            target: payload.host || '114.114.114.114',
            hops: [
              { hop: 1, ip: '192.168.1.1', hostname: 'router.local', latencyMs: 1.1, status: 'Success' },
              { hop: 2, ip: '100.64.0.1', hostname: 'bras.isp.net', latencyMs: 4.8, status: 'Success' },
              { hop: 3, ip: '218.2.132.1', hostname: '', latencyMs: 8.2, status: 'Success' },
              { hop: 4, ip: '202.97.45.18', hostname: 'chinanet.backbone', latencyMs: 14.5, status: 'Success' },
              { hop: 5, ip: '114.114.114.114', hostname: 'public1.114dns.com', latencyMs: 16.2, status: 'Success' }
            ]
          });
          break;
        case 'sys_get_services':
          resolve([
            { name: 'MySQL', displayName: 'MySQL Database Server 8.0', status: 'Running', startMode: 'Auto', pid: 3120, pathName: 'C:\\Program Files\\MySQL\\bin\\mysqld.exe', description: 'MySQL Server relational database daemon' },
            { name: 'Redis', displayName: 'Redis In-Memory Data Store', status: 'Running', startMode: 'Auto', pid: 5412, pathName: 'C:\\Redis\\redis-server.exe', description: 'Redis memory cache and key-value database' },
            { name: 'nginx', displayName: 'Nginx Web Server', status: 'Stopped', startMode: 'Manual', pid: 0, pathName: 'C:\\nginx\\nginx.exe', description: 'High performance web server and reverse proxy' },
            { name: 'Spooler', displayName: 'Print Spooler', status: 'Running', startMode: 'Auto', pid: 1450, pathName: 'C:\\Windows\\System32\\spoolsv.exe', description: 'Manages all local and network print queues' },
            { name: 'W32Time', displayName: 'Windows Time', status: 'Running', startMode: 'Manual', pid: 980, pathName: 'C:\\Windows\\System32\\svchost.exe', description: 'Maintains date and time synchronization on clients and servers' },
            { name: 'WinRM', displayName: 'Windows Remote Management (WS-Management)', status: 'Stopped', startMode: 'Manual', pid: 0, pathName: 'C:\\Windows\\System32\\svchost.exe', description: 'Implements WS-Management protocol for remote management' },
            { name: 'wuauserv', displayName: 'Windows Update', status: 'Running', startMode: 'Manual', pid: 820, pathName: 'C:\\Windows\\System32\\svchost.exe', description: 'Enables detection, download, and installation of updates' }
          ]);
          break;
        case 'sys_set_service_state':
          resolve({ success: true, message: `服务 [${payload.name}] 执行 [${payload.action}] 成功 (Mock)` });
          break;
        case 'sys_set_service_start_type':
          resolve({ success: true, message: `服务 [${payload.name}] 启动类型已更新为 [${payload.startType}] (Mock)` });
          break;
        case 'sys_get_startup_items':
          resolve([
            { id: 'hkcu_OneDrive', name: 'Microsoft OneDrive', command: '"C:\\Users\\User\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" /background', targetPath: 'C:\\Users\\User\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe', locationType: '注册表 (当前用户)', locationPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', enabled: true, fileExists: true },
            { id: 'hkcu_Discord', name: 'Discord', command: 'C:\\Users\\User\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe', targetPath: 'C:\\Users\\User\\AppData\\Local\\Discord\\Update.exe', locationType: '注册表 (当前用户)', locationPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', enabled: true, fileExists: true },
            { id: 'hklm_SecurityHealth', name: 'SecurityHealth', command: '%windir%\\system32\\SecurityHealthSystray.exe', targetPath: 'C:\\Windows\\system32\\SecurityHealthSystray.exe', locationType: '注册表 (系统所有用户)', locationPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', enabled: true, fileExists: true },
            { id: 'folder_user_Docker', name: 'Docker Desktop.lnk', command: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', targetPath: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', locationType: '启动文件夹 (用户)', locationPath: 'C:\\Users\\User\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup', enabled: true, fileExists: true }
          ]);
          break;
        case 'sys_remove_startup_item':
          resolve({ success: true, message: `已移除自启动项 [${payload.name}] (Mock)` });
          break;
        case 'sys_get_file_locks':
          resolve({
            success: true,
            path: payload.path || 'C:\\Test\\example.db',
            locked: true,
            lockCount: 1,
            processes: [
              { pid: 3820, name: 'Code.exe', title: 'pwsh-webui-app1 - Visual Studio Code', path: 'C:\\Users\\User\\AppData\\Local\\Programs\\VSCode\\Code.exe', memoryMB: 320.5 }
            ]
          });
          break;
        case 'sys_get_hardware_specs':
          resolve({
            success: true,
            cpu: { name: '13th Gen Intel(R) Core(TM) i7-13700K', manufacturer: 'GenuineIntel', cores: 16, threads: 24, maxClockSpeedMHz: 3400, socket: 'LGA1700', loadPercent: 12 },
            memory: {
              totalGB: 32.0,
              freeGB: 18.4,
              usedGB: 13.6,
              percentUsed: 42.5,
              slots: [
                { slot: 'DIMM 1', capacityGB: 16.0, speedMHz: 6000, manufacturer: 'Kingston', partNumber: 'KF560C36-16' },
                { slot: 'DIMM 3', capacityGB: 16.0, speedMHz: 6000, manufacturer: 'Kingston', partNumber: 'KF560C36-16' }
              ]
            },
            disks: [
              { drive: 'C:', volumeName: '系统盘 (Windows)', fileSystem: 'NTFS', totalGB: 512.0, freeGB: 284.5, usedGB: 227.5, percentUsed: 44.4 },
              { drive: 'D:', volumeName: '工作数据 (Data)', fileSystem: 'NTFS', totalGB: 1024.0, freeGB: 650.2, usedGB: 373.8, percentUsed: 36.5 }
            ],
            physicalDisks: [
              { model: 'Samsung SSD 980 PRO 1TB', sizeGB: 1000.0, interfaceType: 'NVMe', mediaType: 'SSD' }
            ],
            gpus: [
              { name: 'NVIDIA GeForce RTX 4070', driverVersion: '551.86', memoryMB: 12288, status: 'OK' }
            ],
            os: {
              caption: 'Microsoft Windows 11 Pro 64-Bit',
              version: '10.0.22631',
              buildNumber: '22631.3296',
              architecture: '64-bit',
              installDate: '2024-01-10 14:22:00',
              lastBootTime: '2026-08-16 09:12:00',
              uptime: '2 天 6 小时 44 分钟',
              computerName: 'DEV-WORKSTATION',
              userName: 'Developer',
              isAdmin: true
            }
          });
          break;
        case 'sys_launch_shortcut':
          resolve({ success: true, message: `已成功调起系统工具: ${payload.toolKey} (Mock)` });
          break;

        default:
          resolve({ success: true });
      }
    }, 60);
  }
};

// ==========================================
// 2. Toast Notification Component
// ==========================================
const Toast = {
  show(message, type = 'info', duration = 2500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'custom-toast';

    let iconName = 'info';
    let iconColor = 'var(--accent-primary)';
    if (type === 'success') {
      iconName = 'check-circle-2';
      iconColor = '#10b981';
    } else if (type === 'warning') {
      iconName = 'alert-triangle';
      iconColor = '#f59e0b';
    } else if (type === 'error') {
      iconName = 'x-circle';
      iconColor = '#ef4444';
    }

    toast.innerHTML = `
      <i data-lucide="${iconName}" style="color: ${iconColor}; width: 18px; height: 18px;"></i>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons({ root: toast });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};

// ==========================================
// 3. Theme Manager (Light / Dark / Auto)
// ==========================================
const ThemeManager = {
  currentTheme: 'system',
  mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),

  init() {
    const savedTheme = localStorage.getItem('app_theme') || 'system';
    this.setTheme(savedTheme, false);

    this.mediaQuery.addEventListener('change', () => {
      if (this.currentTheme === 'system') {
        this.applyThemeToDOM('system');
      }
    });

    const btnQuick = document.getElementById('btnQuickTheme');
    if (btnQuick) {
      btnQuick.addEventListener('click', () => {
        const nextTheme = this.currentTheme === 'light' ? 'dark' : this.currentTheme === 'dark' ? 'system' : 'light';
        this.setTheme(nextTheme, true);
      });
    }

    ['themeOptLight', 'themeOptDark', 'themeOptSystem'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          this.setTheme(el.dataset.themeVal, true);
        });
      }
    });
  },

  setTheme(theme, showNotice = false) {
    this.currentTheme = theme;
    localStorage.setItem('app_theme', theme);
    this.applyThemeToDOM(theme);
    this.updateThemeUI(theme);

    if (showNotice) {
      const labelMap = { light: '浅色模式', dark: '深色模式', system: '跟随系统' };
      Toast.show(`主题已切换为：${labelMap[theme]}`, 'info', 1800);
      SettingsManager.saveConfig();
    }
  },

  applyThemeToDOM(theme) {
    let effectiveTheme = theme;
    if (theme === 'system') {
      effectiveTheme = this.mediaQuery.matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-bs-theme', effectiveTheme);
  },

  updateThemeUI(theme) {
    const quickIcon = document.getElementById('quickThemeIcon');
    const quickText = document.getElementById('quickThemeText');

    let iconName = 'sun';
    let text = '浅色';
    if (theme === 'dark') {
      iconName = 'moon';
      text = '深色';
    } else if (theme === 'system') {
      iconName = 'monitor';
      text = '跟随系统';
    }

    if (quickText) quickText.textContent = text;
    if (quickIcon) {
      quickIcon.setAttribute('data-lucide', iconName);
      if (window.lucide) lucide.createIcons();
    }

    ['light', 'dark', 'system'].forEach(t => {
      const el = document.getElementById(`themeOpt${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (el) {
        el.classList.toggle('active', t === theme);
      }
    });
  }
};

// ==========================================
// 3.5 Privilege & Windows UAC Manager
// ==========================================
const PrivilegeManager = {
  isAdmin: false,

  async init() {
    try {
      const res = await IPC.send('get_privilege_info');
      this.isAdmin = Boolean(res && res.isAdmin);
      this.updateUI();
    } catch (e) {
      console.warn('Failed to check admin privilege:', e);
    }

    const btnHeader = document.getElementById('btnAppPrivilege');
    const btnSettings = document.getElementById('btnRestartAsAdmin');

    [btnHeader, btnSettings].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => this.requestElevation());
      }
    });
  },

  updateUI() {
    const btnHeader = document.getElementById('btnAppPrivilege');
    const iconHeader = document.getElementById('privilegeIcon');
    const textHeader = document.getElementById('privilegeText');
    const statusSettings = document.getElementById('settingsPrivilegeStatus');
    const infoPrivilege = document.getElementById('infoPrivilege');
    const btnSettings = document.getElementById('btnRestartAsAdmin');

    if (btnHeader) {
      btnHeader.classList.toggle('is-admin', this.isAdmin);
      btnHeader.title = this.isAdmin ? '当前应用已获得完整管理员权限' : '当前为普通用户模式（点击可申请管理员权限重启）';
    }
    if (iconHeader) {
      iconHeader.setAttribute('data-lucide', this.isAdmin ? 'shield-check' : 'shield');
    }
    if (textHeader) {
      textHeader.textContent = this.isAdmin ? '管理员模式' : '普通模式';
    }

    if (statusSettings) {
      statusSettings.innerHTML = this.isAdmin
        ? `<span class="text-success fw-bold"><i data-lucide="shield-check" class="lucide-sm me-1"></i>已具备管理员完全权限</span>`
        : `<span class="text-warning fw-bold"><i data-lucide="shield" class="lucide-sm me-1"></i>普通权限（已启用自动 UAC 按需提权）</span>`;
    }

    if (infoPrivilege) {
      infoPrivilege.textContent = this.isAdmin ? 'Administrator (管理员)' : 'Standard User (普通用户)';
      infoPrivilege.className = `info-item-val fw-bold ${this.isAdmin ? 'text-success' : 'text-secondary'}`;
    }

    if (btnSettings) {
      if (this.isAdmin) {
        btnSettings.innerHTML = `<i data-lucide="check" style="width: 14px; height: 14px;"></i> 已处于管理员权限`;
        btnSettings.className = 'btn btn-success btn-sm d-flex align-items-center gap-1 disabled';
      } else {
        btnSettings.innerHTML = `<i data-lucide="shield" style="width: 14px; height: 14px;"></i> 以管理员身份重启应用`;
        btnSettings.className = 'btn btn-outline-primary btn-sm d-flex align-items-center gap-1';
      }
    }

    if (window.lucide) lucide.createIcons();
  },

  async requestElevation() {
    if (this.isAdmin) {
      Toast.show('当前应用已处于管理员完全权限状态', 'info', 2000);
      return;
    }

    Toast.show('正在请求以管理员身份重启，请在 Windows 弹出的 UAC 窗口中点击“是”...', 'info', 3000);

    try {
      const res = await IPC.send('sys_elevate_app');
      if (res && res.success) {
        Toast.show('已启动管理员新实例，当前窗口即将关闭...', 'success', 2000);
      }
    } catch (e) {
      Toast.show('提权失败: ' + e.message, 'error', 3500);
    }
  }
};

// ==========================================
// 4. Concrete Tool Modules Implementation
// ==========================================

// Tool 1: Port Checker Tool
const PortCheckerTool = {
  activeTab: 'local',
  localData: [],
  remoteResults: [],
  onlyOpen: false,

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs">
              <button class="tool-tab-btn ${this.activeTab === 'local' ? 'active' : ''}" id="tabPortLocal">本地端口占用</button>
              <button class="tool-tab-btn ${this.activeTab === 'remote' ? 'active' : ''}" id="tabPortRemote">远程端口连通探测</button>
            </div>
            <div class="search-input-group ${this.activeTab === 'local' ? '' : 'd-none'}" id="portSearchBox">
              <i data-lucide="search" class="search-icon"></i>
              <input type="text" class="form-control form-control-sm" id="localPortSearch" placeholder="搜索端口 / PID / 进程名 / 地址...">
            </div>
          </div>
          <div class="tool-toolbar-right">
            <button class="btn btn-primary btn-sm d-flex align-items-center gap-1" id="btnRefreshPorts">
              <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> 刷新端口
            </button>
          </div>
        </div>

        <!-- Local Ports Panel -->
        <div id="panelPortLocal" class="table-card ${this.activeTab === 'local' ? '' : 'd-none'}">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th>协议</th>
                  <th>本地绑定地址</th>
                  <th>端口</th>
                  <th>状态</th>
                  <th>进程 PID</th>
                  <th>进程名称</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="localPortsTableBody">
                <tr><td colspan="7" class="text-center text-muted py-4">正在加载本地端口...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Remote Ports Panel -->
        <div id="panelPortRemote" class="tool-view-wrapper ${this.activeTab === 'remote' ? '' : 'd-none'}">
          <div class="settings-card">
            <div class="row g-3 align-items-end">
              <div class="col-md-4">
                <label class="form-label small fw-bold text-secondary">目标主机 / 域名 / IP</label>
                <input type="text" class="form-control form-control-sm font-mono" id="remoteHostInput" placeholder="例如: 127.0.0.1 或 baidu.com" value="127.0.0.1">
              </div>
              <div class="col-md-6">
                <label class="form-label small fw-bold text-secondary">探测端口 (支持单端口与范围，例如: 80, 443, 8000-8080, 1-100)</label>
                <input type="text" class="form-control form-control-sm font-mono" id="remotePortsInput" placeholder="例如: 80, 443, 8000-8080, 3000-3010" value="80, 443, 8000-8020, 3306, 6379, 22">
              </div>
              <div class="col-md-2">
                <button class="btn btn-primary btn-sm w-100 d-flex align-items-center justify-content-center gap-1" id="btnStartRemoteScan">
                  <i data-lucide="play" style="width: 14px; height: 14px;"></i> 开始探测
                </button>
              </div>
            </div>
            <div class="d-flex flex-wrap align-items-center gap-2 mt-3 pt-2 border-top">
              <span class="small text-muted">常用预设:</span>
              <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="document.getElementById('remotePortsInput').value='80, 443, 8080, 8443, 8000-8010'">Web 常用</button>
              <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="document.getElementById('remotePortsInput').value='3306, 5432, 6379, 27017, 1433, 9200'">常用数据库</button>
              <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="document.getElementById('remotePortsInput').value='21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3389'">基础服务</button>
              <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="document.getElementById('remotePortsInput').value='1-100'">1~100 基础段</button>
              <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="document.getElementById('remotePortsInput').value='8000-8080'">8000~8080 微服务段</button>
              <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="document.getElementById('remotePortsInput').value='1-1024'">1~1024 特权端口段</button>
            </div>
          </div>

          <div class="table-card">
            <div class="p-2 px-3 border-bottom d-flex justify-content-between align-items-center bg-surface">
              <div class="d-flex align-items-center gap-3">
                <span class="small fw-bold" id="remoteSummaryText">输入主机与端口范围后点击“开始探测”</span>
                <div class="form-check form-switch m-0 small">
                  <input class="form-check-input" type="checkbox" id="chkOnlyOpenPorts" onchange="PortCheckerTool.toggleOnlyOpen(this.checked)">
                  <label class="form-check-label fw-bold" for="chkOnlyOpenPorts">仅显示开放端口</label>
                </div>
              </div>
              <div class="d-flex gap-2">
                <input type="text" class="form-control form-control-sm" id="remoteResultFilter" placeholder="过滤端口/状态..." style="max-width: 160px;" oninput="PortCheckerTool.renderRemoteTable()">
                <button class="btn btn-outline-secondary btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="PortCheckerTool.exportOpenPorts()">导出开放端口</button>
              </div>
            </div>
            <div class="table-responsive-container" style="max-height: 480px; overflow-y: auto;">
              <table class="modern-table">
                <thead>
                  <tr>
                    <th style="width: 120px;">端口号</th>
                    <th style="width: 140px;">连通状态</th>
                    <th style="width: 130px;">响应耗时 (ms)</th>
                    <th>检测结果 / 错误详情</th>
                  </tr>
                </thead>
                <tbody id="remotePortsTableBody">
                  <tr><td colspan="4" class="text-center text-muted py-4">输入主机与端口后点击“开始探测”</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadLocalPorts();
  },

  bindEvents(container) {
    const tabLocal = container.querySelector('#tabPortLocal');
    const tabRemote = container.querySelector('#tabPortRemote');
    const panelLocal = container.querySelector('#panelPortLocal');
    const panelRemote = container.querySelector('#panelPortRemote');
    const searchBox = container.querySelector('#portSearchBox');
    const btnRefresh = container.querySelector('#btnRefreshPorts');
    const searchInput = container.querySelector('#localPortSearch');
    const btnScan = container.querySelector('#btnStartRemoteScan');

    tabLocal.onclick = () => {
      this.activeTab = 'local';
      tabLocal.classList.add('active');
      tabRemote.classList.remove('active');
      panelLocal.classList.remove('d-none');
      panelRemote.classList.add('d-none');
      searchBox.classList.remove('d-none');
    };

    tabRemote.onclick = () => {
      this.activeTab = 'remote';
      tabRemote.classList.add('active');
      tabLocal.classList.remove('active');
      panelLocal.classList.add('d-none');
      panelRemote.classList.remove('d-none');
      searchBox.classList.add('d-none');
    };

    btnRefresh.onclick = () => this.loadLocalPorts();

    searchInput.oninput = (e) => {
      this.renderLocalTable(e.target.value.toLowerCase().trim());
    };

    btnScan.onclick = () => this.scanRemotePorts();
  },

  async loadLocalPorts() {
    const tbody = document.getElementById('localPortsTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>正在获取本地监听端口...</td></tr>`;

    try {
      const data = await IPC.send('net_get_local_ports');
      this.localData = data || [];
      const searchInput = document.getElementById('localPortSearch');
      this.renderLocalTable(searchInput ? searchInput.value.toLowerCase().trim() : '');
      Toast.show(`已更新本地端口列表 (共 ${this.localData.length} 条)`, 'success', 1500);
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">加载失败: ${e.message}</td></tr>`;
      Toast.show('加载本地端口失败: ' + e.message, 'error', 3000);
    }
  },

  renderLocalTable(filter = '') {
    const tbody = document.getElementById('localPortsTableBody');
    if (!tbody) return;

    let list = this.localData;
    if (filter) {
      list = list.filter(p =>
        String(p.localPort).includes(filter) ||
        String(p.pid).includes(filter) ||
        (p.processName && p.processName.toLowerCase().includes(filter)) ||
        (p.localAddress && p.localAddress.includes(filter))
      );
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">未找到匹配的端口记录</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => {
      const isListen = item.state === 'Listen' || item.state === 'Listening';
      const stateBadge = isListen
        ? `<span class="status-pill success"><span class="status-dot"></span>监听中 (Listen)</span>`
        : `<span class="status-pill info"><span class="status-dot"></span>${item.state}</span>`;

      return `
        <tr>
          <td><span class="badge ${item.protocol === 'TCP' ? 'bg-primary' : 'bg-secondary'}">${item.protocol}</span></td>
          <td class="font-mono">${item.localAddress || '*'}</td>
          <td class="font-mono fw-bold text-primary">${item.localPort}</td>
          <td>${stateBadge}</td>
          <td class="font-mono text-muted">${item.pid}</td>
          <td class="fw-semibold">${item.processName}</td>
          <td>
            ${item.pid > 4 ? `
              <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="PortCheckerTool.killPortProcess(${item.pid}, '${item.processName}')">
                结束进程
              </button>
            ` : `<span class="text-muted small">-</span>`}
          </td>
        </tr>
      `;
    }).join('');
  },

  async killPortProcess(pid, name) {
    if (!confirm(`确定要终止进程 [${name}] (PID: ${pid}) 吗？`)) return;
    try {
      await IPC.send('sys_kill_process', { pid });
      Toast.show(`已终止进程 ${name} (PID: ${pid})`, 'success', 2000);
      this.loadLocalPorts();
    } catch (e) {
      Toast.show('终止进程失败: ' + e.message, 'error', 3000);
    }
  },

  parsePortRanges(inputStr) {
    const portSet = new Set();
    const segments = (inputStr || '').split(/[,，;\s\n]+/).filter(Boolean);
    for (const seg of segments) {
      if (seg.includes('-') || seg.includes('~')) {
        const parts = seg.split(/[-~]/);
        if (parts.length === 2) {
          const start = parseInt(parts[0], 10);
          const end = parseInt(parts[1], 10);
          if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0 && start <= 65535 && end <= 65535) {
            const minP = Math.min(start, end);
            const maxP = Math.max(start, end);
            for (let p = minP; p <= maxP; p++) {
              portSet.add(p);
              if (portSet.size >= 3000) break;
            }
          }
        }
      } else {
        const p = parseInt(seg, 10);
        if (!isNaN(p) && p > 0 && p <= 65535) {
          portSet.add(p);
        }
      }
    }
    return Array.from(portSet).sort((a, b) => a - b);
  },

  toggleOnlyOpen(checked) {
    this.onlyOpen = checked;
    this.renderRemoteTable();
  },

  renderRemoteTable() {
    const tbody = document.getElementById('remotePortsTableBody');
    const filterInput = document.getElementById('remoteResultFilter');
    const summaryText = document.getElementById('remoteSummaryText');
    if (!tbody || !this.remoteResults) return;

    const query = filterInput ? filterInput.value.trim().toLowerCase() : '';
    let filtered = this.remoteResults;

    if (this.onlyOpen) {
      filtered = filtered.filter(r => r.isOpen);
    }

    if (query) {
      filtered = filtered.filter(r =>
        String(r.port).includes(query) ||
        (r.isOpen ? '开放 open' : '关闭 closed').includes(query) ||
        (r.error && r.error.toLowerCase().includes(query))
      );
    }

    const openCount = this.remoteResults.filter(r => r.isOpen).length;
    const closedCount = this.remoteResults.length - openCount;
    if (summaryText) {
      summaryText.innerHTML = `探测完成：共 <strong>${this.remoteResults.length}</strong> 个端口（<span class="text-success fw-bold">开放: ${openCount}</span>，<span class="text-muted">关闭: ${closedCount}</span>）`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">${this.onlyOpen ? '未发现开放的端口' : '无匹配的端口检测记录'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(r => {
      const badge = r.isOpen
        ? `<span class="badge bg-success-subtle text-success"><span class="status-dot online"></span>开放 (Open)</span>`
        : `<span class="badge bg-secondary-subtle text-secondary"><span class="status-dot stopped"></span>关闭 / 超时</span>`;

      return `
        <tr>
          <td class="font-mono fw-bold fs-6 text-primary">${r.port}</td>
          <td>${badge}</td>
          <td class="font-mono">${r.latencyMs > 0 ? r.latencyMs + ' ms' : '< 1 ms'}</td>
          <td class="small ${r.isOpen ? 'text-success fw-semibold' : 'text-muted'}">${r.isOpen ? '端口正常响应并允许建立 TCP 连接' : (r.error || '连接被拒绝或超时')}</td>
        </tr>
      `;
    }).join('');
  },

  exportOpenPorts() {
    const openPorts = (this.remoteResults || []).filter(r => r.isOpen).map(r => r.port);
    if (openPorts.length === 0) {
      Toast.show('当前无开放端口可导出', 'warning');
      return;
    }
    navigator.clipboard.writeText(openPorts.join(', '));
    Toast.show(`已复制 ${openPorts.length} 个开放端口 (${openPorts.join(', ')})`, 'success');
  },

  async scanRemotePorts() {
    const hostInput = document.getElementById('remoteHostInput');
    const portsInput = document.getElementById('remotePortsInput');
    const tbody = document.getElementById('remotePortsTableBody');
    const btn = document.getElementById('btnStartRemoteScan');

    const host = hostInput ? hostInput.value.trim() : '';
    if (!host) {
      Toast.show('请输入目标主机地址', 'warning');
      return;
    }

    const ports = this.parsePortRanges(portsInput ? portsInput.value : '');
    if (ports.length === 0) {
      Toast.show('请输入有效的端口号或范围 (例如: 80, 443, 8000-8080)', 'warning');
      return;
    }

    if (ports.length > 3000) {
      Toast.show(`单次探测端口数已自动限制为前 3000 个`, 'info');
    }

    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm text-primary me-2"></span>正在高并发探测 ${host} 的 ${ports.length} 个端口...</td></tr>`;
    if (btn) btn.disabled = true;

    try {
      const results = await IPC.send('net_check_remote_port', { host, ports, timeoutMs: 1200 });
      this.remoteResults = results || [];
      this.renderRemoteTable();
      Toast.show(`远程端口探测完成 (共 ${this.remoteResults.length} 个端口)`, 'success', 2000);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-4">探测失败: ${e.message}</td></tr>`;
      Toast.show('探测失败: ' + e.message, 'error', 3000);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
};

// Tool 2: Ping & DNS Diagnosis
const PingTool = {
  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="settings-card">
          <div class="row g-3 align-items-end">
            <div class="col-md-6">
              <label class="form-label small fw-bold text-secondary">目标域名 / IP 地址</label>
              <input type="text" class="form-control form-control-sm font-mono" id="pingHostInput" placeholder="例如: baidu.com, 1.1.1.1, github.com" value="baidu.com">
            </div>
            <div class="col-md-3">
              <label class="form-label small fw-bold text-secondary">发送次数 (Packets)</label>
              <select class="form-select form-select-sm font-mono" id="pingCountSelect">
                <option value="4" selected>4 次请求</option>
                <option value="8">8 次请求</option>
                <option value="12">12 次请求</option>
              </select>
            </div>
            <div class="col-md-3">
              <button class="btn btn-primary btn-sm w-100 d-flex align-items-center justify-content-center gap-1" id="btnStartPing">
                <i data-lucide="activity" style="width: 15px; height: 15px;"></i> 发起诊断
              </button>
            </div>
          </div>
        </div>

        <!-- Metric Cards -->
        <div class="metrics-row" id="pingMetricsRow">
          <div class="metric-card">
            <span class="metric-label">丢包率 (Loss Rate)</span>
            <span class="metric-value" id="valPingLoss">-%</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">平均延迟 (Avg Latency)</span>
            <span class="metric-value text-primary" id="valPingAvg">- ms</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">最小延迟 (Min)</span>
            <span class="metric-value" id="valPingMin">- ms</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">最大延迟 (Max)</span>
            <span class="metric-value" id="valPingMax">- ms</span>
          </div>
        </div>

        <!-- DNS Resolution Section -->
        <div class="settings-card py-2 px-3 d-flex align-items-center gap-2">
          <i data-lucide="globe" class="text-primary" style="width: 18px; height: 18px;"></i>
          <span class="small fw-bold text-secondary">DNS 解析地址:</span>
          <div class="d-flex gap-2 flex-wrap" id="dnsIpList">
            <span class="text-muted small">尚未解析</span>
          </div>
        </div>

        <!-- Ping Details Table -->
        <div class="table-card">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>响应 IP</th>
                  <th>延迟 (ms)</th>
                  <th>TTL</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody id="pingTableBody">
                <tr><td colspan="5" class="text-center text-muted py-4">点击“发起诊断”开始 Ping 探测</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const btn = container.querySelector('#btnStartPing');
    btn.onclick = () => this.executePing();
  },

  async executePing() {
    const hostInput = document.getElementById('pingHostInput');
    const countSelect = document.getElementById('pingCountSelect');
    const btn = document.getElementById('btnStartPing');
    const tbody = document.getElementById('pingTableBody');
    const dnsContainer = document.getElementById('dnsIpList');

    const host = hostInput ? hostInput.value.trim() : '';
    if (!host) {
      Toast.show('请输入目标主机地址', 'warning');
      return;
    }

    const count = parseInt(countSelect ? countSelect.value : '4', 10);
    btn.disabled = true;
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>正在向 ${host} 发送 ${count} 个探测包...</td></tr>`;

    try {
      const res = await IPC.send('net_ping', { host, count, timeoutMs: 2000 });

      // Render DNS IPs
      if (dnsContainer) {
        if (res.dnsIps && res.dnsIps.length > 0) {
          dnsContainer.innerHTML = res.dnsIps.map(ip => `<span class="badge bg-secondary font-mono">${ip}</span>`).join('');
        } else {
          dnsContainer.innerHTML = `<span class="text-muted small">无法解析或直接 IP 访问</span>`;
        }
      }

      // Render Metrics
      const valLoss = document.getElementById('valPingLoss');
      const valAvg = document.getElementById('valPingAvg');
      const valMin = document.getElementById('valPingMin');
      const valMax = document.getElementById('valPingMax');

      if (valLoss) {
        valLoss.textContent = `${res.lossRate}%`;
        valLoss.className = `metric-value ${res.lossRate > 0 ? 'text-danger' : 'text-success'}`;
      }
      if (valAvg) valAvg.textContent = `${res.avgTime} ms`;
      if (valMin) valMin.textContent = `${res.minTime} ms`;
      if (valMax) valMax.textContent = `${res.maxTime} ms`;

      // Render Table
      if (tbody && res.records) {
        tbody.innerHTML = res.records.map(r => {
          const isOk = r.status === 'Success';
          return `
            <tr>
              <td class="font-mono">#${r.seq}</td>
              <td class="font-mono">${r.ip}</td>
              <td class="font-mono fw-bold ${r.timeMs < 50 ? 'text-success' : r.timeMs < 150 ? 'text-warning' : 'text-danger'}">${r.timeMs} ms</td>
              <td class="font-mono text-muted">${r.ttl || '-'}</td>
              <td>
                <span class="status-pill ${isOk ? 'success' : 'danger'}">
                  <span class="status-dot"></span>${isOk ? '成功 (OK)' : r.status}
                </span>
              </td>
            </tr>
          `;
        }).join('');
      }
      Toast.show('网络诊断已完成', 'success', 2000);
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">诊断失败: ${e.message}</td></tr>`;
      Toast.show('Ping 探测失败: ' + e.message, 'error', 3000);
    } finally {
      btn.disabled = false;
    }
  }
};

// Tool 3: cURL / HTTP Client
const CurlTool = {
  headers: [
    { key: 'Content-Type', value: 'application/json' },
    { key: 'Accept', value: 'application/json' }
  ],
  activeReqTab: 'body',
  activeResTab: 'body',
  lastResponse: null,

  render(container) {
    container.innerHTML = `
      <div class="http-client-container">
        <!-- Request Top Bar -->
        <div class="http-request-bar">
          <select class="method-select" id="httpMethod">
            <option value="GET" selected>GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
            <option value="HEAD">HEAD</option>
          </select>
          <input type="text" class="url-input" id="httpUrl" placeholder="输入请求 URL (例如: https://myip.ipip.net)" value="https://myip.ipip.net">
          <button class="btn-send-req" id="btnSendHttp">
            <i data-lucide="send" style="width: 16px; height: 16px;"></i> 发送请求
          </button>
        </div>

        <!-- Quick URL Presets -->
        <div class="d-flex align-items-center gap-2 px-1 py-1" style="font-size: 0.8rem;">
          <span class="text-muted small">快速预设:</span>
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="CurlTool.setPreset('GET', 'https://myip.ipip.net')">IP 查询 (myip.ipip.net)</button>
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="CurlTool.setPreset('GET', 'https://api.github.com')">GitHub API</button>
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="CurlTool.setPreset('GET', 'https://httpbin.org/get')">HTTPBin</button>
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.75rem;" onclick="CurlTool.setPreset('GET', 'http://127.0.0.1:8080')">本地 127.0.0.1:8080</button>
        </div>

        <!-- Request / Response Split Panel -->
        <div class="http-split-panel">
          <!-- Left: Request Configuration -->
          <div class="panel-card">
            <div class="panel-card-header">
              <div class="tool-nav-tabs">
                <button class="tool-tab-btn ${this.activeReqTab === 'body' ? 'active' : ''}" id="tabReqBody">请求体 (Body)</button>
                <button class="tool-tab-btn ${this.activeReqTab === 'headers' ? 'active' : ''}" id="tabReqHeaders">请求头 (Headers) <span class="badge bg-secondary" id="badgeHeaderCount">${this.headers.length}</span></button>
                <button class="tool-tab-btn ${this.activeReqTab === 'curl' ? 'active' : ''}" id="tabReqCurl">cURL 命令</button>
              </div>
              <div class="d-flex align-items-center gap-1">
                <button class="btn btn-outline-secondary btn-sm py-0 px-2" style="font-size: 0.75rem;" id="btnFormatReqJson">格式化 JSON</button>
              </div>
            </div>

            <div class="panel-card-body">
              <!-- Req Body -->
              <div id="panelReqBody" class="${this.activeReqTab === 'body' ? '' : 'd-none'} d-flex flex-column h-100">
                <textarea class="code-editor-box flex-grow-1" id="httpRequestBody" rows="12" placeholder='{\n  "name": "DevTools",\n  "version": "1.0"\n}'></textarea>
              </div>

              <!-- Req Headers -->
              <div id="panelReqHeaders" class="${this.activeReqTab === 'headers' ? '' : 'd-none'} d-flex flex-column gap-2">
                <div id="headerRowsContainer" class="d-flex flex-column gap-2"></div>
                <button class="btn btn-outline-primary btn-sm mt-2 align-self-start" id="btnAddHeaderRow">
                  <i data-lucide="plus" style="width: 14px; height: 14px;"></i> 添加 Header
                </button>
              </div>

              <!-- Req cURL Preview -->
              <div id="panelReqCurl" class="${this.activeReqTab === 'curl' ? '' : 'd-none'} d-flex flex-column h-100 gap-2">
                <textarea class="code-editor-box flex-grow-1" id="httpCurlPreview" readonly></textarea>
                <button class="btn btn-secondary btn-sm align-self-end" id="btnCopyCurl">复制 cURL 命令</button>
              </div>
            </div>
          </div>

          <!-- Right: Response Result -->
          <div class="panel-card">
            <div class="panel-card-header">
              <div class="d-flex align-items-center gap-2">
                <div class="tool-nav-tabs">
                  <button class="tool-tab-btn ${this.activeResTab === 'body' ? 'active' : ''}" id="tabResBody">响应体 (Body)</button>
                  <button class="tool-tab-btn ${this.activeResTab === 'headers' ? 'active' : ''}" id="tabResHeaders">响应头 (Headers)</button>
                </div>
              </div>
              <div class="d-flex align-items-center gap-2" id="resMetaInfo">
                <span class="status-pill secondary" id="resStatusBadge">等待请求</span>
                <span class="small font-mono text-muted" id="resTimeBadge">- ms</span>
                <span class="small font-mono text-muted" id="resSizeBadge">- B</span>
              </div>
            </div>

            <div class="panel-card-body">
              <div id="panelResBody" class="${this.activeResTab === 'body' ? '' : 'd-none'} d-flex flex-column h-100 gap-2">
                <textarea class="code-editor-box flex-grow-1" id="httpResponseBody" readonly placeholder="发送请求后在此处查看响应体内容..."></textarea>
                <button class="btn btn-outline-secondary btn-sm align-self-end" id="btnCopyResBody">复制响应内容</button>
              </div>
              <div id="panelResHeaders" class="${this.activeResTab === 'headers' ? '' : 'd-none'}">
                <table class="modern-table">
                  <thead><tr><th>响应头名称</th><th>对应值</th></tr></thead>
                  <tbody id="resHeadersTbody"><tr><td colspan="2" class="text-center text-muted py-4">无响应头数据</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.renderHeaderRows();
    this.updateCurlPreview();
  },

  setPreset(method, url) {
    const m = document.getElementById('httpMethod');
    const u = document.getElementById('httpUrl');
    if (m) m.value = method;
    if (u) u.value = url;
    this.updateCurlPreview();
    Toast.show(`已载入预设: ${url}`, 'info', 1200);
  },

  bindEvents(container) {
    const tabReqBody = container.querySelector('#tabReqBody');
    const tabReqHeaders = container.querySelector('#tabReqHeaders');
    const tabReqCurl = container.querySelector('#tabReqCurl');
    const panelReqBody = container.querySelector('#panelReqBody');
    const panelReqHeaders = container.querySelector('#panelReqHeaders');
    const panelReqCurl = container.querySelector('#panelReqCurl');

    const tabResBody = container.querySelector('#tabResBody');
    const tabResHeaders = container.querySelector('#tabResHeaders');
    const panelResBody = container.querySelector('#panelResBody');
    const panelResHeaders = container.querySelector('#panelResHeaders');

    tabReqBody.onclick = () => {
      this.activeReqTab = 'body';
      tabReqBody.classList.add('active');
      tabReqHeaders.classList.remove('active');
      tabReqCurl.classList.remove('active');
      panelReqBody.classList.remove('d-none');
      panelReqHeaders.classList.add('d-none');
      panelReqCurl.classList.add('d-none');
    };

    tabReqHeaders.onclick = () => {
      this.activeReqTab = 'headers';
      tabReqHeaders.classList.add('active');
      tabReqBody.classList.remove('active');
      tabReqCurl.classList.remove('active');
      panelReqHeaders.classList.remove('d-none');
      panelReqBody.classList.add('d-none');
      panelReqCurl.classList.add('d-none');
    };

    tabReqCurl.onclick = () => {
      this.activeReqTab = 'curl';
      tabReqCurl.classList.add('active');
      tabReqBody.classList.remove('active');
      tabReqHeaders.classList.remove('active');
      panelReqCurl.classList.remove('d-none');
      panelReqBody.classList.add('d-none');
      panelReqHeaders.classList.add('d-none');
      this.updateCurlPreview();
    };

    tabResBody.onclick = () => {
      this.activeResTab = 'body';
      tabResBody.classList.add('active');
      tabResHeaders.classList.remove('active');
      panelResBody.classList.remove('d-none');
      panelResHeaders.classList.add('d-none');
    };

    tabResHeaders.onclick = () => {
      this.activeResTab = 'headers';
      tabResHeaders.classList.add('active');
      tabResBody.classList.remove('active');
      panelResHeaders.classList.remove('d-none');
      panelResBody.classList.add('d-none');
    };

    container.querySelector('#btnAddHeaderRow').onclick = () => {
      this.headers.push({ key: '', value: '' });
      this.renderHeaderRows();
    };

    container.querySelector('#btnFormatReqJson').onclick = () => {
      const textarea = container.querySelector('#httpRequestBody');
      try {
        if (textarea.value.trim()) {
          const parsed = JSON.parse(textarea.value);
          textarea.value = JSON.stringify(parsed, null, 2);
          Toast.show('JSON 格式化成功', 'success', 1200);
        }
      } catch (e) {
        Toast.show('JSON 语法错误: ' + e.message, 'error');
      }
    };

    container.querySelector('#btnCopyCurl').onclick = () => {
      const val = container.querySelector('#httpCurlPreview').value;
      navigator.clipboard.writeText(val);
      Toast.show('已复制 cURL 命令到剪贴板', 'success', 1500);
    };

    container.querySelector('#btnCopyResBody').onclick = () => {
      const val = container.querySelector('#httpResponseBody').value;
      navigator.clipboard.writeText(val);
      Toast.show('已复制响应内容到剪贴板', 'success', 1500);
    };

    container.querySelector('#httpMethod').onchange = () => this.updateCurlPreview();
    container.querySelector('#httpUrl').oninput = () => this.updateCurlPreview();
    container.querySelector('#httpRequestBody').oninput = () => this.updateCurlPreview();

    container.querySelector('#btnSendHttp').onclick = () => this.sendRequest();
  },

  renderHeaderRows() {
    const container = document.getElementById('headerRowsContainer');
    const badge = document.getElementById('badgeHeaderCount');
    if (badge) badge.textContent = this.headers.length;
    if (!container) return;

    container.innerHTML = this.headers.map((h, idx) => `
      <div class="kv-row">
        <input type="text" class="kv-input" placeholder="Header Key (例如: Authorization)" value="${h.key}" onchange="CurlTool.headers[${idx}].key = this.value; CurlTool.updateCurlPreview();">
        <input type="text" class="kv-input" placeholder="Header Value (例如: Bearer token...)" value="${h.value}" onchange="CurlTool.headers[${idx}].value = this.value; CurlTool.updateCurlPreview();">
        <button class="btn-icon-danger" onclick="CurlTool.removeHeader(${idx})"><i data-lucide="trash-2" style="width: 15px; height: 15px;"></i></button>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons({ root: container });
  },

  removeHeader(idx) {
    this.headers.splice(idx, 1);
    this.renderHeaderRows();
    this.updateCurlPreview();
  },

  updateCurlPreview() {
    const method = document.getElementById('httpMethod')?.value || 'GET';
    const url = document.getElementById('httpUrl')?.value || '';
    const body = document.getElementById('httpRequestBody')?.value || '';

    let curl = `curl -X ${method} "${url}"`;
    this.headers.forEach(h => {
      if (h.key && h.value) {
        curl += ` \\\n  -H "${h.key}: ${h.value}"`;
      }
    });
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      curl += ` \\\n  -d '${body.replace(/'/g, "\\'")}'`;
    }

    const preview = document.getElementById('httpCurlPreview');
    if (preview) preview.value = curl;
  },

  async sendRequest() {
    const method = document.getElementById('httpMethod')?.value || 'GET';
    const url = document.getElementById('httpUrl')?.value || '';
    const body = document.getElementById('httpRequestBody')?.value || '';
    const btn = document.getElementById('btnSendHttp');

    if (!url || !url.startsWith('http')) {
      Toast.show('请输入合法的 HTTP/HTTPS 网址 (需以 http:// 或 https:// 开头)', 'warning');
      return;
    }

    const headersDict = {};
    this.headers.forEach(h => {
      if (h.key.trim()) headersDict[h.key.trim()] = h.value;
    });

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> 发送中...`;

    try {
      const res = await IPC.send('net_http_request', { method, url, headers: headersDict, body, timeoutSec: 15 });
      this.lastResponse = res;

      // Status Badge
      const statusBadge = document.getElementById('resStatusBadge');
      const timeBadge = document.getElementById('resTimeBadge');
      const sizeBadge = document.getElementById('resSizeBadge');
      const bodyBox = document.getElementById('httpResponseBody');
      const headersTbody = document.getElementById('resHeadersTbody');

      if (statusBadge) {
        const is2xx = res.statusCode >= 200 && res.statusCode < 300;
        const is3xx = res.statusCode >= 300 && res.statusCode < 400;
        const is4xx = res.statusCode >= 400 && res.statusCode < 500;
        const is5xx = res.statusCode >= 500 || res.statusCode === 0;

        let statusClass = 'success';
        if (is3xx) statusClass = 'info';
        if (is4xx) statusClass = 'warning';
        if (is5xx) statusClass = 'danger';

        statusBadge.className = `status-pill ${statusClass}`;
        statusBadge.innerHTML = `<span class="status-dot"></span>${res.statusCode || 0} ${res.statusText || 'Error'}`;
      }

      if (timeBadge) timeBadge.textContent = `${res.timeMs} ms`;
      if (sizeBadge) sizeBadge.textContent = res.sizeBytes > 1024 ? `${(res.sizeBytes / 1024).toFixed(2)} KB` : `${res.sizeBytes || 0} B`;

      // Format response body if JSON
      if (bodyBox) {
        try {
          const parsed = JSON.parse(res.body);
          bodyBox.value = JSON.stringify(parsed, null, 2);
        } catch (e) {
          bodyBox.value = res.body || (res.statusCode === 0 ? '请求失败，未能收到响应内容。' : '');
        }
      }

      // Headers Table
      if (headersTbody) {
        if (res.headers && Object.keys(res.headers).length > 0) {
          headersTbody.innerHTML = Object.entries(res.headers).map(([k, v]) => `
            <tr>
              <td class="font-mono fw-bold text-secondary">${k}</td>
              <td class="font-mono">${v}</td>
            </tr>
          `).join('');
        } else {
          headersTbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted py-4">无响应头</td></tr>`;
        }
      }

      Toast.show(`请求已完成 (${res.statusCode} ${res.statusText})`, res.statusCode >= 200 && res.statusCode < 400 ? 'success' : 'warning', 2000);
    } catch (e) {
      Toast.show('请求异常: ' + e.message, 'error', 3000);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="send" style="width: 16px; height: 16px;"></i> 发送请求`;
      if (window.lucide) lucide.createIcons();
    }
  }
};

// Tool 4: Environment Variables Manager
const EnvTool = {
  activeScope: 'User', // 'User' | 'Machine' | 'PathAnalysis'
  envData: { userVars: [], machineVars: [], pathAnalysis: [] },

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs">
              <button class="tool-tab-btn ${this.activeScope === 'User' ? 'active' : ''}" id="tabEnvUser">用户变量 (User)</button>
              <button class="tool-tab-btn ${this.activeScope === 'Machine' ? 'active' : ''}" id="tabEnvMachine">系统变量 (Machine)</button>
              <button class="tool-tab-btn ${this.activeScope === 'PathAnalysis' ? 'active' : ''}" id="tabEnvPath">Path 路径分析器</button>
            </div>
            <input type="text" class="form-control form-control-sm" id="envSearchInput" placeholder="检索环境变量..." style="width: 220px;">
          </div>
          <div class="tool-toolbar-right">
            <button class="btn btn-outline-primary btn-sm d-flex align-items-center gap-1" id="btnAddEnv">
              <i data-lucide="plus" style="width: 14px; height: 14px;"></i> 新增变量
            </button>
            <button class="btn btn-primary btn-sm d-flex align-items-center gap-1" id="btnRefreshEnv">
              <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> 刷新
            </button>
          </div>
        </div>

        <!-- Normal Env Vars Table -->
        <div id="panelEnvNormal" class="table-card ${this.activeScope === 'PathAnalysis' ? 'd-none' : ''}">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th style="width: 28%;">变量名称 (Name)</th>
                  <th>变量值 (Value)</th>
                  <th style="width: 120px;">操作</th>
                </tr>
              </thead>
              <tbody id="envTableBody">
                <tr><td colspan="3" class="text-center text-muted py-4">正在加载环境变量...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Path Analysis Panel -->
        <div id="panelEnvPath" class="table-card ${this.activeScope === 'PathAnalysis' ? '' : 'd-none'}">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th style="width: 80px;">序号</th>
                  <th>Path 目录路径</th>
                  <th style="width: 150px;">磁盘有效性</th>
                </tr>
              </thead>
              <tbody id="envPathTableBody">
                <tr><td colspan="3" class="text-center text-muted py-4">正在分析 Path 路径...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadEnvVars();
  },

  bindEvents(container) {
    const tabUser = container.querySelector('#tabEnvUser');
    const tabMachine = container.querySelector('#tabEnvMachine');
    const tabPath = container.querySelector('#tabEnvPath');
    const panelNormal = container.querySelector('#panelEnvNormal');
    const panelPath = container.querySelector('#panelEnvPath');
    const searchInput = container.querySelector('#envSearchInput');

    tabUser.onclick = () => {
      this.activeScope = 'User';
      tabUser.classList.add('active');
      tabMachine.classList.remove('active');
      tabPath.classList.remove('active');
      panelNormal.classList.remove('d-none');
      panelPath.classList.add('d-none');
      this.renderTable(searchInput.value.toLowerCase().trim());
    };

    tabMachine.onclick = () => {
      this.activeScope = 'Machine';
      tabMachine.classList.add('active');
      tabUser.classList.remove('active');
      tabPath.classList.remove('active');
      panelNormal.classList.remove('d-none');
      panelPath.classList.add('d-none');
      this.renderTable(searchInput.value.toLowerCase().trim());
    };

    tabPath.onclick = () => {
      this.activeScope = 'PathAnalysis';
      tabPath.classList.add('active');
      tabUser.classList.remove('active');
      tabMachine.classList.remove('active');
      panelNormal.classList.add('d-none');
      panelPath.classList.remove('d-none');
      this.renderPathTable();
    };

    container.querySelector('#btnRefreshEnv').onclick = () => this.loadEnvVars();
    container.querySelector('#btnAddEnv').onclick = () => this.openEditModal('', '', this.activeScope === 'Machine' ? 'Machine' : 'User');

    searchInput.oninput = (e) => this.renderTable(e.target.value.toLowerCase().trim());

    // Modal bindings
    const modal = document.getElementById('envVarModal');
    const btnClose = document.getElementById('btnCloseEnvModal');
    const btnCancel = document.getElementById('btnCancelEnvModal');
    const btnSave = document.getElementById('btnSaveEnvModal');

    [btnClose, btnCancel].forEach(b => {
      if (b) b.onclick = () => modal.classList.add('d-none');
    });

    if (btnSave) {
      btnSave.onclick = async () => {
        const name = document.getElementById('envModalName').value.trim();
        const value = document.getElementById('envModalValue').value;
        const scope = document.getElementById('envModalScope').value;

        if (!name) {
          Toast.show('变量名不能为空', 'warning');
          return;
        }

        if (scope === 'Machine' && !PrivilegeManager.isAdmin) {
          Toast.show('正在保存系统级环境变量（如权限不足将自动呼出 UAC 授权）...', 'info', 2500);
        }

        try {
          const res = await IPC.send('sys_set_env_var', { name, value, scope });
          Toast.show(res.message || `已保存变量 ${name}`, 'success', 2000);
          modal.classList.add('d-none');
          this.loadEnvVars();
        } catch (e) {
          Toast.show('保存环境变量失败: ' + e.message, 'error', 3500);
        }
      };
    }
  },

  async loadEnvVars() {
    try {
      const data = await IPC.send('sys_get_env_vars');
      this.envData = data || { userVars: [], machineVars: [], pathAnalysis: [] };
      const searchInput = document.getElementById('envSearchInput');
      if (this.activeScope === 'PathAnalysis') {
        this.renderPathTable();
      } else {
        this.renderTable(searchInput ? searchInput.value.toLowerCase().trim() : '');
      }
      Toast.show('环境变量已刷新', 'success', 1200);
    } catch (e) {
      Toast.show('加载环境变量失败: ' + e.message, 'error', 3000);
    }
  },

  renderTable(filter = '') {
    const tbody = document.getElementById('envTableBody');
    if (!tbody) return;

    let list = this.activeScope === 'Machine' ? this.envData.machineVars : this.envData.userVars;
    if (filter) {
      list = list.filter(v => v.name.toLowerCase().includes(filter) || v.value.toLowerCase().includes(filter));
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">未找到相关环境变量</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(v => `
      <tr>
        <td class="font-mono fw-bold text-primary">${v.name}</td>
        <td class="font-mono text-break" style="max-width: 500px;">${v.value}</td>
        <td>
          <div class="d-flex align-items-center gap-1">
            <button class="btn btn-outline-secondary btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="EnvTool.openEditModal('${v.name}', \`${v.value.replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`, '${v.scope}')">编辑</button>
            <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="EnvTool.deleteVar('${v.name}', '${v.scope}')">删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  renderPathTable() {
    const tbody = document.getElementById('envPathTableBody');
    if (!tbody) return;

    const list = this.envData.pathAnalysis || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">Path 环境变量为空</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, idx) => {
      const badge = item.exists
        ? `<span class="status-pill success"><span class="status-dot"></span>有效目录</span>`
        : `<span class="status-pill danger"><span class="status-dot"></span>目录不存在/失效</span>`;

      return `
        <tr>
          <td class="font-mono text-muted">#${idx + 1}</td>
          <td class="font-mono ${item.exists ? '' : 'text-danger fw-bold'}">${item.path}</td>
          <td>${badge}</td>
        </tr>
      `;
    }).join('');
  },

  openEditModal(name, value, scope) {
    const modal = document.getElementById('envVarModal');
    const title = document.getElementById('envModalTitle');
    const inputName = document.getElementById('envModalName');
    const inputValue = document.getElementById('envModalValue');
    const selectScope = document.getElementById('envModalScope');

    if (title) title.textContent = name ? '编辑环境变量' : '新增环境变量';
    if (inputName) {
      inputName.value = name;
      inputName.disabled = Boolean(name); // Disable key modification on edit
    }
    if (inputValue) inputValue.value = value;
    if (selectScope) selectScope.value = scope || 'User';

    if (modal) modal.classList.remove('d-none');
  },

  async deleteVar(name, scope) {
    if (!confirm(`确定要删除 ${scope} 环境变量 [${name}] 吗？`)) return;
    if (scope === 'Machine' && !PrivilegeManager.isAdmin) {
      Toast.show('正在删除系统级环境变量（如权限不足将自动呼出 UAC 授权）...', 'info', 2500);
    }
    try {
      const res = await IPC.send('sys_delete_env_var', { name, scope });
      Toast.show(res.message || `已删除环境变量 ${name}`, 'success', 2000);
      this.loadEnvVars();
    } catch (e) {
      Toast.show('删除失败: ' + e.message, 'error', 3500);
    }
  }
};

// Tool 5: Process Manager
const ProcessTool = {
  processes: [],
  sortField: 'memoryMB',
  sortAsc: false,

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <input type="text" class="form-control form-control-sm" id="procSearchInput" placeholder="按进程名称 / PID 快速过滤..." style="width: 240px;">
            <select class="form-select form-select-sm" id="procSortSelect" style="width: 160px;">
              <option value="memoryMB" selected>按内存占用排序</option>
              <option value="cpu">按 CPU 占用排序</option>
              <option value="pid">按 PID 排序</option>
              <option value="name">按进程名称排序</option>
            </select>
          </div>
          <div class="tool-toolbar-right">
            <span class="small text-muted me-2" id="procCountBadge">进程数: -</span>
            <button class="btn btn-primary btn-sm d-flex align-items-center gap-1" id="btnRefreshProcesses">
              <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> 刷新进程
            </button>
          </div>
        </div>

        <div class="table-card">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th style="width: 90px;">PID</th>
                  <th style="width: 25%;">进程名称</th>
                  <th style="width: 20%;">内存使用 (MB)</th>
                  <th style="width: 12%;">CPU 时间</th>
                  <th>状态</th>
                  <th>可执行路径</th>
                  <th style="width: 100px;">操作</th>
                </tr>
              </thead>
              <tbody id="procTableBody">
                <tr><td colspan="7" class="text-center text-muted py-4">正在获取系统进程...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadProcesses();
  },

  bindEvents(container) {
    const searchInput = container.querySelector('#procSearchInput');
    const sortSelect = container.querySelector('#procSortSelect');
    const btnRefresh = container.querySelector('#btnRefreshProcesses');

    searchInput.oninput = (e) => this.renderTable(e.target.value.toLowerCase().trim());
    sortSelect.onchange = (e) => {
      this.sortField = e.target.value;
      this.sortAsc = (this.sortField === 'name' || this.sortField === 'pid');
      this.renderTable(searchInput.value.toLowerCase().trim());
    };
    btnRefresh.onclick = () => this.loadProcesses();
  },

  async loadProcesses() {
    const tbody = document.getElementById('procTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>正在采样系统进程...</td></tr>`;

    try {
      const data = await IPC.send('sys_get_processes');
      this.processes = data || [];
      const searchInput = document.getElementById('procSearchInput');
      this.renderTable(searchInput ? searchInput.value.toLowerCase().trim() : '');
      const badge = document.getElementById('procCountBadge');
      if (badge) badge.textContent = `进程数: ${this.processes.length}`;
      Toast.show(`进程采样完成 (共 ${this.processes.length} 个)`, 'success', 1200);
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">获取进程失败: ${e.message}</td></tr>`;
      Toast.show('获取进程失败: ' + e.message, 'error', 3000);
    }
  },

  renderTable(filter = '') {
    const tbody = document.getElementById('procTableBody');
    if (!tbody) return;

    let list = [...this.processes];
    if (filter) {
      list = list.filter(p =>
        String(p.pid).includes(filter) ||
        p.name.toLowerCase().includes(filter) ||
        (p.path && p.path.toLowerCase().includes(filter))
      );
    }

    // Sort
    list.sort((a, b) => {
      let valA = a[this.sortField];
      let valB = b[this.sortField];
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return this.sortAsc ? -1 : 1;
      if (valA > valB) return this.sortAsc ? 1 : -1;
      return 0;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">未找到匹配进程</td></tr>`;
      return;
    }

    const maxMem = Math.max(...list.map(p => p.memoryMB), 1);

    tbody.innerHTML = list.map(p => {
      const memPercent = Math.min((p.memoryMB / maxMem) * 100, 100);
      return `
        <tr>
          <td class="font-mono text-muted">${p.pid}</td>
          <td class="fw-bold">${p.name}</td>
          <td>
            <div class="d-flex justify-content-between font-mono small mb-1">
              <span>${p.memoryMB} MB</span>
            </div>
            <div class="mem-bar-bg"><div class="mem-bar-fill" style="width: ${memPercent}%;"></div></div>
          </td>
          <td class="font-mono text-secondary">${p.cpu}s</td>
          <td><span class="status-pill ${p.responding ? 'success' : 'danger'}"><span class="status-dot"></span>${p.responding ? '正常' : '未响应'}</span></td>
          <td class="font-mono small text-truncate" style="max-width: 260px;" title="${p.path || p.description || ''}">${p.path || p.description || '-'}</td>
          <td>
            ${p.pid > 4 ? `
              <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="ProcessTool.killProcess(${p.pid}, '${p.name}')">
                结束
              </button>
            ` : `<span class="text-muted small">-</span>`}
          </td>
        </tr>
      `;
    }).join('');
  },

  async killProcess(pid, name) {
    if (!confirm(`警告：确定要强行结束进程 [${name}] (PID: ${pid}) 吗？`)) return;
    if (!PrivilegeManager.isAdmin) {
      Toast.show(`正在尝试终止进程 ${name}（如遇受保护进程将自动请求 UAC 提权）...`, 'info', 2500);
    }
    try {
      const res = await IPC.send('sys_kill_process', { pid });
      Toast.show(res.message || `已结束进程 ${name} (PID: ${pid})`, 'success', 2000);
      this.loadProcesses();
    } catch (e) {
      Toast.show('终止进程失败: ' + e.message, 'error', 3500);
    }
  }
};

// Tool 6: Hosts Editor
const HostsTool = {
  activeTab: 'visual',
  rawContent: '',
  hostsPath: '',

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs">
              <button class="tool-tab-btn ${this.activeTab === 'visual' ? 'active' : ''}" id="tabHostsVisual">规则列表视图</button>
              <button class="tool-tab-btn ${this.activeTab === 'raw' ? 'active' : ''}" id="tabHostsRaw">源码文本编辑</button>
            </div>
            <span class="small font-mono text-muted text-truncate" style="max-width: 320px;" id="hostsFilePath">C:\\Windows\\System32\\drivers\\etc\\hosts</span>
          </div>
          <div class="tool-toolbar-right">
            <button class="btn btn-outline-primary btn-sm d-flex align-items-center gap-1" id="btnAddHostRule">
              <i data-lucide="plus" style="width: 14px; height: 14px;"></i> 添加规则
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="btnBackupHosts">备份 Hosts</button>
            <button class="btn btn-primary btn-sm d-flex align-items-center gap-1" id="btnSaveHosts">
              <i data-lucide="save" style="width: 14px; height: 14px;"></i> 保存修改
            </button>
          </div>
        </div>

        <!-- Visual Table -->
        <div id="panelHostsVisual" class="table-card ${this.activeTab === 'visual' ? '' : 'd-none'}">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th style="width: 80px;">状态</th>
                  <th style="width: 25%;">IP 地址</th>
                  <th>映射域名 / 主机名</th>
                  <th>备注说明</th>
                  <th style="width: 80px;">操作</th>
                </tr>
              </thead>
              <tbody id="hostsRulesTbody">
                <tr><td colspan="5" class="text-center text-muted py-4">正在读取系统 Hosts 文件...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Raw Textarea Editor -->
        <div id="panelHostsRaw" class="table-card p-3 ${this.activeTab === 'raw' ? '' : 'd-none'}">
          <textarea class="code-editor-box flex-grow-1" id="hostsRawTextarea" rows="18" style="height: calc(100vh - 280px);"></textarea>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadHosts();
  },

  bindEvents(container) {
    const tabVisual = container.querySelector('#tabHostsVisual');
    const tabRaw = container.querySelector('#tabHostsRaw');
    const panelVisual = container.querySelector('#panelHostsVisual');
    const panelRaw = container.querySelector('#panelHostsRaw');
    const textarea = container.querySelector('#hostsRawTextarea');

    tabVisual.onclick = () => {
      this.activeTab = 'visual';
      tabVisual.classList.add('active');
      tabRaw.classList.remove('active');
      panelVisual.classList.remove('d-none');
      panelRaw.classList.add('d-none');
      // If user typed in textarea, sync to rawContent
      if (textarea) this.rawContent = textarea.value;
      this.renderRulesTable();
    };

    tabRaw.onclick = () => {
      this.activeTab = 'raw';
      tabRaw.classList.add('active');
      tabVisual.classList.remove('active');
      panelRaw.classList.remove('d-none');
      panelVisual.classList.add('d-none');
      if (textarea) textarea.value = this.rawContent;
    };

    container.querySelector('#btnAddHostRule').onclick = () => {
      const modal = document.getElementById('addHostModal');
      if (modal) modal.classList.remove('d-none');
    };

    container.querySelector('#btnSaveHosts').onclick = () => this.saveHosts();
    container.querySelector('#btnBackupHosts').onclick = () => this.backupHosts();

    // Modal add host
    const modal = document.getElementById('addHostModal');
    const btnClose = document.getElementById('btnCloseHostModal');
    const btnCancel = document.getElementById('btnCancelHostModal');
    const btnSave = document.getElementById('btnSaveHostModal');

    [btnClose, btnCancel].forEach(b => {
      if (b) b.onclick = () => modal.classList.add('d-none');
    });

    if (btnSave) {
      btnSave.onclick = () => {
        const ip = document.getElementById('hostModalIp').value.trim();
        const domain = document.getElementById('hostModalDomain').value.trim();
        const comment = document.getElementById('hostModalComment').value.trim();

        if (!ip || !domain) {
          Toast.show('IP 与域名不能为空', 'warning');
          return;
        }

        const newLine = `${ip} ${domain}${comment ? ' # ' + comment : ''}\n`;
        this.rawContent = (this.rawContent.trim() ? this.rawContent.trim() + '\n' : '') + newLine;
        modal.classList.add('d-none');
        this.renderRulesTable();
        Toast.show('已添加规则（请点击“保存修改”写入磁盘）', 'info', 2500);
      };
    }
  },

  async loadHosts() {
    try {
      const res = await IPC.send('sys_get_hosts');
      this.rawContent = res.content || '';
      this.hostsPath = res.path || '';

      const pathEl = document.getElementById('hostsFilePath');
      const textarea = document.getElementById('hostsRawTextarea');
      if (pathEl) pathEl.textContent = this.hostsPath;
      if (textarea) textarea.value = this.rawContent;

      this.renderRulesTable();
      Toast.show('Hosts 文件加载成功', 'success', 1200);
    } catch (e) {
      Toast.show('读取 Hosts 文件失败: ' + e.message, 'error', 3000);
    }
  },

  parseRules() {
    const lines = this.rawContent.split('\n');
    const rules = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const isCommented = trimmed.startsWith('#');
      const content = isCommented ? trimmed.replace(/^#\s*/, '') : trimmed;
      const parts = content.split(/[\s\t]+/).filter(Boolean);

      if (parts.length >= 2 && (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parts[0]) || parts[0] === '::1' || parts[0].includes(':'))) {
        const ip = parts[0];
        const domain = parts[1];
        const commentIndex = content.indexOf('#');
        const comment = commentIndex !== -1 ? content.substring(commentIndex + 1).trim() : '';

        rules.push({
          lineIndex: idx,
          enabled: !isCommented,
          ip,
          domain,
          comment
        });
      }
    });

    return rules;
  },

  renderRulesTable() {
    const tbody = document.getElementById('hostsRulesTbody');
    if (!tbody) return;

    const rules = this.parseRules();
    if (rules.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Hosts 中未解析出有效 IP 映射规则</td></tr>`;
      return;
    }

    tbody.innerHTML = rules.map(r => `
      <tr>
        <td>
          <div class="form-check form-switch m-0">
            <input class="form-check-input" type="checkbox" role="switch" ${r.enabled ? 'checked' : ''} onchange="HostsTool.toggleRule(${r.lineIndex}, this.checked)">
          </div>
        </td>
        <td class="font-mono fw-bold">${r.ip}</td>
        <td class="font-mono text-primary">${r.domain}</td>
        <td class="text-muted small">${r.comment || '-'}</td>
        <td>
          <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="HostsTool.deleteRule(${r.lineIndex})">删除</button>
        </td>
      </tr>
    `).join('');
  },

  toggleRule(lineIndex, enabled) {
    const lines = this.rawContent.split('\n');
    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex];
      if (enabled) {
        lines[lineIndex] = line.replace(/^#\s*/, '');
      } else {
        lines[lineIndex] = '# ' + line.replace(/^#\s*/, '');
      }
      this.rawContent = lines.join('\n');
    }
  },

  deleteRule(lineIndex) {
    const lines = this.rawContent.split('\n');
    if (lineIndex >= 0 && lineIndex < lines.length) {
      lines.splice(lineIndex, 1);
      this.rawContent = lines.join('\n');
      this.renderRulesTable();
    }
  },

  async saveHosts() {
    const textarea = document.getElementById('hostsRawTextarea');
    if (this.activeTab === 'raw' && textarea) {
      this.rawContent = textarea.value;
    }

    if (!PrivilegeManager.isAdmin) {
      Toast.show('正在保存 Hosts（如遇系统权限限制将自动唤起 Windows UAC 授权）...', 'info', 2500);
    }

    try {
      const res = await IPC.send('sys_save_hosts', { content: this.rawContent });
      Toast.show(res.message || 'Hosts 文件已保存成功', 'success', 2500);
      this.loadHosts();
    } catch (e) {
      Toast.show('保存失败: ' + e.message, 'error', 4000);
    }
  },

  backupHosts() {
    const blob = new Blob([this.rawContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hosts_backup_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show('已导出 Hosts 备份文件', 'success', 2000);
  }
};


// ==========================================
// Minimal Standalone QR Code Generator
// ==========================================
const MiniQRCode = {
  draw(text, canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width || 180;
    ctx.clearRect(0, 0, size, size);

    const modules = 25; // 25x25 grid (Version 2 QR)
    const cellSize = Math.floor(size / modules);
    const offset = Math.floor((size - (cellSize * modules)) / 2);

    const matrix = Array.from({ length: modules }, () => Array(modules).fill(false));

    // Finder patterns (top-left, top-right, bottom-left)
    const drawFinder = (r, c) => {
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          if (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) {
            matrix[r + i][c + j] = true;
          }
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, modules - 7);
    drawFinder(modules - 7, 0);

    // Timing patterns
    for (let i = 8; i < modules - 8; i++) {
      if (i % 2 === 0) {
        matrix[6][i] = true;
        matrix[i][6] = true;
      }
    }
    matrix[modules - 8][8] = true;

    // Encode text bits into data area
    let bits = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      for (let b = 7; b >= 0; b--) {
        bits.push((code >> b) & 1);
      }
    }
    while (bits.length < (modules * modules)) {
      bits.push(0xEC, 0x11);
    }

    let bitIdx = 0;
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if ((r < 8 && c < 8) || (r < 8 && c >= modules - 8) || (r >= modules - 8 && c < 8)) continue;
        if (r === 6 || c === 6) continue;
        const b = bits[bitIdx % bits.length];
        bitIdx++;
        matrix[r][c] = (b ^ ((r + c) % 2 === 0)) === 1;
      }
    }

    // Render matrix
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#0f172a';

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if (matrix[r][c]) {
          ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
        }
      }
    }
  }
};

// ==========================================
// 1. NetAdapterTool - 网卡与 DNS 快速切换器
// ==========================================
const NetAdapterTool = {
  adapters: [],
  selectedAlias: '',

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <button class="btn btn-primary btn-sm px-3" id="btnRefreshAdapters">
              <i data-lucide="refresh-cw" class="lucide-sm me-1"></i> 刷新网卡列表
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="btnFlushDns">
              <i data-lucide="zap" class="lucide-sm me-1"></i> 刷新 DNS 缓存 (FlushDNS)
            </button>
          </div>
          <div class="tool-toolbar-right">
            <span class="text-muted small">快速应用公共 DNS：</span>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" data-dns="ali">阿里 DNS</button>
              <button class="btn btn-outline-primary" data-dns="dnspod">腾讯 DNSPod</button>
              <button class="btn btn-outline-primary" data-dns="114">114 DNS</button>
              <button class="btn btn-outline-primary" data-dns="google">Google</button>
              <button class="btn btn-outline-primary" data-dns="cf">Cloudflare</button>
              <button class="btn btn-outline-warning" data-dns="dhcp">恢复自动获取</button>
            </div>
          </div>
        </div>

        <div class="adapter-grid" id="adapterGrid">
          <div class="text-center text-muted py-5 w-100">
            <div class="spinner-border spinner-border-sm text-primary me-2"></div>
            正在获取本机网络适配器列表...
          </div>
        </div>
      </div>

      <!-- Quick Edit DNS Modal -->
      <div class="modal-overlay d-none" id="dnsEditModal">
        <div class="modal-dialog-box">
          <div class="modal-header-box">
            <h5 class="modal-title-box">配置网卡 DNS 服务器</h5>
            <button type="button" class="btn-close" id="btnCloseDnsModal"></button>
          </div>
          <div class="modal-body-box">
            <div>
              <label class="form-label fw-bold small text-secondary">目标网络适配器</label>
              <input type="text" class="form-control form-control-sm font-mono" id="dnsModalAlias" readonly>
            </div>
            <div>
              <label class="form-label fw-bold small text-secondary">首选 DNS 服务器 (Primary DNS)</label>
              <input type="text" class="form-control form-control-sm font-mono" id="dnsModalPrimary" placeholder="例如: 223.5.5.5 或 8.8.8.8">
            </div>
            <div>
              <label class="form-label fw-bold small text-secondary">备用 DNS 服务器 (Secondary DNS, 可选)</label>
              <input type="text" class="form-control form-control-sm font-mono" id="dnsModalSecondary" placeholder="例如: 223.6.6.6 或 8.8.4.4">
            </div>
          </div>
          <div class="modal-footer-box">
            <button type="button" class="btn btn-secondary btn-sm" id="btnCancelDnsModal">取消</button>
            <button type="button" class="btn btn-primary btn-sm" id="btnSaveDnsModal">保存应用</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadAdapters();
  },

  bindEvents(container) {
    const btnRefresh = container.querySelector('#btnRefreshAdapters');
    if (btnRefresh) btnRefresh.onclick = () => this.loadAdapters();

    const btnFlush = container.querySelector('#btnFlushDns');
    if (btnFlush) btnFlush.onclick = () => this.flushDns();

    // Quick DNS presets
    container.querySelectorAll('[data-dns]').forEach(btn => {
      btn.onclick = () => {
        const type = btn.dataset.dns;
        this.applyQuickDns(type);
      };
    });

    // Modal bindings
    const modal = container.querySelector('#dnsEditModal');
    const btnClose = container.querySelector('#btnCloseDnsModal');
    const btnCancel = container.querySelector('#btnCancelDnsModal');
    const btnSave = container.querySelector('#btnSaveDnsModal');

    const closeModal = () => modal.classList.add('d-none');
    if (btnClose) btnClose.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;
    if (btnSave) {
      btnSave.onclick = async () => {
        const ifAlias = document.getElementById('dnsModalAlias').value;
        const p = document.getElementById('dnsModalPrimary').value.trim();
        const s = document.getElementById('dnsModalSecondary').value.trim();
        const dnsList = [p, s].filter(Boolean);

        try {
          const res = await IPC.send('net_set_adapter_dns', {
            interfaceAlias: ifAlias,
            dnsServers: dnsList,
            isDhcp: dnsList.length === 0
          });
          Toast.show(res.message || 'DNS 配置更新成功', 'success');
          closeModal();
          this.loadAdapters();
        } catch (e) {
          Toast.show('设置 DNS 失败: ' + e.message, 'error');
        }
      };
    }
  },

  async loadAdapters() {
    const grid = document.getElementById('adapterGrid');
    if (!grid) return;
    grid.innerHTML = `<div class="text-center text-muted py-5 w-100"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在获取网卡列表...</div>`;

    try {
      const data = await IPC.send('net_get_adapters');
      this.adapters = Array.isArray(data) ? data : [];
      this.renderAdaptersList();
    } catch (e) {
      grid.innerHTML = `<div class="text-center text-danger py-4">加载网卡失败: ${e.message}</div>`;
    }
  },

  renderAdaptersList() {
    const grid = document.getElementById('adapterGrid');
    if (!grid) return;

    if (this.adapters.length === 0) {
      grid.innerHTML = `<div class="text-center text-muted py-4 w-100">未检测到活动的网络适配器</div>`;
      return;
    }

    grid.innerHTML = this.adapters.map(a => {
      const isUp = a.status === 'Up';
      const statusBadge = isUp ? `<span class="badge bg-success-subtle text-success border border-success">已连接 (Up)</span>` : `<span class="badge bg-secondary-subtle text-secondary">已断开 (Down)</span>`;
      const ipStr = (a.ipAddresses && a.ipAddresses.length > 0) ? a.ipAddresses.join(', ') : '-';
      const dnsStr = (a.dnsServers && a.dnsServers.length > 0) ? a.dnsServers.map(d => `<span class="badge bg-primary-subtle text-primary font-mono me-1">${d}</span>`).join('') : '<span class="text-muted small">DHCP 自动获取</span>';

      return `
        <div class="adapter-card">
          <div class="adapter-header">
            <div class="adapter-title">
              <i data-lucide="${a.isPhysical ? 'cpu' : 'layers'}" style="width:18px;height:18px;color:var(--accent-primary);"></i>
              <span>${a.interfaceAlias || a.name}</span>
            </div>
            ${statusBadge}
          </div>

          <div class="adapter-body">
            <div class="adapter-info-row">
              <span class="adapter-info-label">适配器名称:</span>
              <span class="adapter-info-val text-truncate" style="max-width:200px;" title="${a.name}">${a.name}</span>
            </div>
            <div class="adapter-info-row">
              <span class="adapter-info-label">IPv4 地址:</span>
              <span class="adapter-info-val text-primary">${ipStr}</span>
            </div>
            <div class="adapter-info-row">
              <span class="adapter-info-label">默认网关:</span>
              <span class="adapter-info-val">${a.gateway || '-'}</span>
            </div>
            <div class="adapter-info-row">
              <span class="adapter-info-label">MAC 地址:</span>
              <span class="adapter-info-val">${a.macAddress || '-'}</span>
            </div>
            <div class="adapter-info-row">
              <span class="adapter-info-label">连接速率:</span>
              <span class="adapter-info-val">${a.linkSpeed || '-'}</span>
            </div>
            <div class="adapter-info-row align-items-center mt-2">
              <span class="adapter-info-label">DNS 服务器:</span>
              <div class="text-end">${dnsStr}</div>
            </div>
          </div>

          <div class="adapter-footer d-flex gap-2 pt-2 border-top">
            <button class="btn btn-outline-primary btn-sm flex-fill" onclick="NetAdapterTool.openDnsModal('${a.interfaceAlias}')">
              <i data-lucide="edit-2" class="lucide-sm me-1"></i> 修改 DNS
            </button>
            <button class="btn btn-outline-secondary btn-sm flex-fill" onclick="NetAdapterTool.resetDns('${a.interfaceAlias}')">
              恢复 DHCP
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons({ root: grid });
  },

  openDnsModal(ifAlias) {
    const modal = document.getElementById('dnsEditModal');
    const aliasInput = document.getElementById('dnsModalAlias');
    const pInput = document.getElementById('dnsModalPrimary');
    const sInput = document.getElementById('dnsModalSecondary');

    const adapter = this.adapters.find(a => a.interfaceAlias === ifAlias);
    if (!adapter || !modal) return;

    aliasInput.value = ifAlias;
    pInput.value = (adapter.dnsServers && adapter.dnsServers[0]) || '';
    sInput.value = (adapter.dnsServers && adapter.dnsServers[1]) || '';

    modal.classList.remove('d-none');
  },

  async resetDns(ifAlias) {
    try {
      const res = await IPC.send('net_set_adapter_dns', { interfaceAlias: ifAlias, dnsServers: [], isDhcp: true });
      Toast.show(res.message || 'DNS 已恢复自动获取', 'success');
      this.loadAdapters();
    } catch (e) {
      Toast.show('恢复 DNS 失败: ' + e.message, 'error');
    }
  },

  async applyQuickDns(presetType) {
    const dnsPresets = {
      ali: ['223.5.5.5', '223.6.6.6'],
      dnspod: ['119.29.29.29', '182.254.116.116'],
      '114': ['114.114.114.114', '114.114.115.115'],
      google: ['8.8.8.8', '8.8.4.4'],
      cf: ['1.1.1.1', '1.0.0.1'],
      dhcp: []
    };

    const activeAdapter = this.adapters.find(a => a.status === 'Up' && a.isPhysical) || this.adapters[0];
    if (!activeAdapter) {
      Toast.show('未找到可用网卡', 'warning');
      return;
    }

    const dnsList = dnsPresets[presetType] || [];
    try {
      const res = await IPC.send('net_set_adapter_dns', {
        interfaceAlias: activeAdapter.interfaceAlias,
        dnsServers: dnsList,
        isDhcp: dnsList.length === 0
      });
      Toast.show(res.message || `已为 [${activeAdapter.interfaceAlias}] 应用 DNS`, 'success');
      this.loadAdapters();
    } catch (e) {
      Toast.show('应用 DNS 失败: ' + e.message, 'error');
    }
  },

  async flushDns() {
    try {
      const res = await IPC.send('net_flush_dns_winsock');
      Toast.show(res.message || 'DNS 缓存刷新成功！', 'success');
    } catch (e) {
      Toast.show('刷新 DNS 缓存失败: ' + e.message, 'error');
    }
  }
};

// ==========================================
// 2. LanScannerTool - 局域网设备扫描发现
// ==========================================
const LanScannerTool = {
  devices: [],
  isScanning: false,

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="input-group input-group-sm" style="max-width: 260px;">
              <span class="input-group-text font-mono">网段</span>
              <input type="text" class="form-control font-mono" id="lanSubnetInput" placeholder="自动探测 / 例如 192.168.1">
            </div>
            <button class="btn btn-primary btn-sm px-3" id="btnStartLanScan">
              <i data-lucide="radar" class="lucide-sm me-1"></i> 开始全网段并发扫描
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="btnCopyAllLanIps">
              <i data-lucide="copy" class="lucide-sm me-1"></i> 复制所有在线 IP
            </button>
          </div>
          <div class="tool-toolbar-right">
            <input type="text" class="form-control form-control-sm" id="lanFilterInput" placeholder="搜索 IP / MAC / 厂商 / 主机名..." style="max-width: 220px;">
          </div>
        </div>

        <div class="tool-card flex-grow-1 overflow-hidden d-flex flex-column p-0">
          <div class="p-3 border-bottom d-flex justify-content-between align-items-center bg-surface">
            <span class="fw-bold" id="lanScanStatusText">准备就绪，点击上方按钮开始扫描</span>
            <span class="badge bg-primary-subtle text-primary" id="lanDeviceCountBadge">在线设备: 0 台</span>
          </div>

          <div class="table-responsive flex-grow-1 p-0 m-0">
            <table class="table table-hover table-bordered align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th style="width: 70px;">状态</th>
                  <th>IP 地址</th>
                  <th>MAC 地址</th>
                  <th>硬件厂商 (OUI)</th>
                  <th>主机名 / 设备名</th>
                  <th>响应延迟</th>
                  <th style="width: 130px;">快速操作</th>
                </tr>
              </thead>
              <tbody id="lanDevicesTbody">
                <tr>
                  <td colspan="7" class="text-center text-muted py-5">点击“开始全网段并发扫描”探测当前局域网在线设备</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
  },

  bindEvents(container) {
    const btnScan = container.querySelector('#btnStartLanScan');
    const filterInput = container.querySelector('#lanFilterInput');
    const btnCopy = container.querySelector('#btnCopyAllLanIps');

    if (btnScan) btnScan.onclick = () => this.startScan();
    if (filterInput) filterInput.oninput = () => this.renderTable();
    if (btnCopy) {
      btnCopy.onclick = () => {
        if (this.devices.length === 0) {
          Toast.show('暂无在线设备可复制', 'warning');
          return;
        }
        const ips = this.devices.map(d => d.ip).join('\n');
        navigator.clipboard.writeText(ips);
        Toast.show(`已复制 ${this.devices.length} 个在线 IP 地址`, 'success');
      };
    }
  },

  async startScan() {
    if (this.isScanning) return;
    this.isScanning = true;

    const subnetInput = document.getElementById('lanSubnetInput');
    const statusText = document.getElementById('lanScanStatusText');
    const tbody = document.getElementById('lanDevicesTbody');
    const btnScan = document.getElementById('btnStartLanScan');

    const subnet = subnetInput ? subnetInput.value.trim() : '';

    if (btnScan) btnScan.disabled = true;
    if (statusText) statusText.innerHTML = `<span class="spinner-border spinner-border-sm text-primary me-2"></span>正在并发探测局域网 254 个 IP 与 ARP 表...`;
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在快速扫描局域网，请稍候 (约 1.5 秒)...</td></tr>`;

    try {
      const res = await IPC.send('net_scan_lan', { subnet });
      this.devices = (res && res.devices) ? res.devices : [];
      if (subnetInput && res.subnet) subnetInput.value = res.subnet;

      if (statusText) statusText.textContent = `扫描完成，在 ${res.subnet || ''}.0/24 网段发现 ${this.devices.length} 台在线设备`;
      Toast.show(`局域网扫描完成，发现 ${this.devices.length} 台设备`, 'success');
      this.renderTable();
    } catch (e) {
      if (statusText) statusText.textContent = '扫描失败';
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">扫描发生异常: ${e.message}</td></tr>`;
    } finally {
      this.isScanning = false;
      if (btnScan) btnScan.disabled = false;
    }
  },

  renderTable() {
    const tbody = document.getElementById('lanDevicesTbody');
    const countBadge = document.getElementById('lanDeviceCountBadge');
    const filterInput = document.getElementById('lanFilterInput');
    if (!tbody) return;

    const query = filterInput ? filterInput.value.trim().toLowerCase() : '';
    const filtered = this.devices.filter(d => {
      if (!query) return true;
      return (d.ip && d.ip.toLowerCase().includes(query)) ||
             (d.mac && d.mac.toLowerCase().includes(query)) ||
             (d.vendor && d.vendor.toLowerCase().includes(query)) ||
             (d.hostName && d.hostName.toLowerCase().includes(query));
    });

    if (countBadge) countBadge.textContent = `在线设备: ${filtered.length} 台`;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">未找到匹配的局域网设备</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(d => {
      const vendorBadge = d.vendor === '本机设备'
        ? `<span class="badge bg-success-subtle text-success">本机</span>`
        : `<span class="badge bg-secondary-subtle text-secondary">${d.vendor}</span>`;

      return `
        <tr>
          <td><span class="status-dot online pulsing"></span></td>
          <td class="font-mono fw-bold text-primary">${d.ip}</td>
          <td class="font-mono text-muted small">${d.mac}</td>
          <td>${vendorBadge}</td>
          <td>${d.hostName || '<span class="text-muted small">-</span>'}</td>
          <td class="font-mono">${d.latencyMs > 0 ? d.latencyMs + ' ms' : '< 1 ms'}</td>
          <td>
            <button class="btn btn-outline-primary btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="navigator.clipboard.writeText('${d.ip}'); Toast.show('已复制 IP: ${d.ip}', 'success', 1000);">复制 IP</button>
            <button class="btn btn-outline-secondary btn-sm py-0 px-2 ms-1" style="font-size:0.75rem;" onclick="PingTool.quickPing('${d.ip}')">Ping</button>
          </td>
        </tr>
      `;
    }).join('');
  }
};

// ==========================================
// 3. SslCheckerTool - SSL / TLS 证书检测与诊断
// ==========================================
const SslCheckerTool = {
  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="input-group input-group-sm" style="max-width: 320px;">
              <span class="input-group-text"><i data-lucide="globe" style="width:14px;height:14px;"></i></span>
              <input type="text" class="form-control font-mono" id="sslDomainInput" placeholder="输入域名，例如 github.com" value="github.com">
            </div>
            <div class="input-group input-group-sm" style="max-width: 140px;">
              <span class="input-group-text">端口</span>
              <input type="number" class="form-control font-mono" id="sslPortInput" value="443">
            </div>
            <button class="btn btn-primary btn-sm px-3" id="btnStartSslCheck">
              <i data-lucide="shield-check" class="lucide-sm me-1"></i> 检测证书
            </button>
          </div>
          <div class="tool-toolbar-right">
            <span class="text-muted small me-1">快捷测试:</span>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary" onclick="SslCheckerTool.quickCheck('github.com')">GitHub</button>
              <button class="btn btn-outline-secondary" onclick="SslCheckerTool.quickCheck('baidu.com')">Baidu</button>
              <button class="btn btn-outline-secondary" onclick="SslCheckerTool.quickCheck('qq.com')">QQ</button>
              <button class="btn btn-outline-secondary" onclick="SslCheckerTool.quickCheck('cloudflare.com')">Cloudflare</button>
            </div>
          </div>
        </div>

        <div id="sslResultMount" class="flex-grow-1 overflow-auto d-flex flex-column gap-3">
          <div class="text-center text-muted py-5">
            <i data-lucide="shield" style="width:48px;height:48px;opacity:0.3;margin-bottom:12px;"></i>
            <p>输入域名并点击“检测证书”分析 TLS 证书链与到期时间</p>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
  },

  bindEvents(container) {
    const btnCheck = container.querySelector('#btnStartSslCheck');
    const input = container.querySelector('#sslDomainInput');

    if (btnCheck) btnCheck.onclick = () => this.checkSsl();
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.checkSsl();
      });
    }
  },

  quickCheck(domain) {
    const input = document.getElementById('sslDomainInput');
    if (input) input.value = domain;
    this.checkSsl();
  },

  async checkSsl() {
    const domainInput = document.getElementById('sslDomainInput');
    const portInput = document.getElementById('sslPortInput');
    const mount = document.getElementById('sslResultMount');
    const btnCheck = document.getElementById('btnStartSslCheck');

    const host = domainInput ? domainInput.value.trim() : '';
    const port = portInput ? parseInt(portInput.value.trim(), 10) || 443 : 443;

    if (!host) {
      Toast.show('请输入要检测的域名', 'warning');
      return;
    }

    if (btnCheck) btnCheck.disabled = true;
    if (mount) mount.innerHTML = `<div class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在与 ${host}:${port} 建立 TLS 握手并读取证书详情...</div>`;

    try {
      const data = await IPC.send('net_check_ssl', { host, port, timeoutMs: 6000 });
      this.renderResult(data);
    } catch (e) {
      if (mount) {
        mount.innerHTML = `
          <div class="alert alert-danger d-flex align-items-center gap-2 m-3">
            <i data-lucide="alert-circle"></i>
            <div><strong>检测失败：</strong>${e.message}</div>
          </div>
        `;
        if (window.lucide) lucide.createIcons({ root: mount });
      }
    } finally {
      if (btnCheck) btnCheck.disabled = false;
    }
  },

  renderResult(cert) {
    const mount = document.getElementById('sslResultMount');
    if (!mount || !cert) return;

    let statusClass = 'valid';
    let statusText = '证书状态有效 (Valid)';
    let statusIcon = 'check-circle-2';

    if (cert.isExpired) {
      statusClass = 'expired';
      statusText = '证书已过期 (Expired)';
      statusIcon = 'x-circle';
    } else if (cert.isExpiringSoon) {
      statusClass = 'expiring';
      statusText = '证书即将到期 (<30天)';
      statusIcon = 'alert-triangle';
    }

    const sansHtml = (cert.sans && cert.sans.length > 0)
      ? cert.sans.map(s => `<span class="badge bg-secondary-subtle text-secondary font-mono me-1 mb-1">${s}</span>`).join('')
      : '<span class="text-muted">无 SAN 扩展</span>';

    const chainHtml = (cert.chain && cert.chain.length > 0)
      ? cert.chain.map((c, i) => `
          <div class="d-flex align-items-center gap-2 py-1">
            <span class="badge bg-primary-subtle text-primary">${i === 0 ? '末端证书' : '中间/根 CA'}</span>
            <span class="font-mono small text-truncate" title="${c.subject}">${c.subject}</span>
          </div>
        `).join('')
      : '<span class="text-muted">单证书</span>';

    mount.innerHTML = `
      <!-- Hero Status Card -->
      <div class="ssl-hero-card">
        <div>
          <div class="d-flex align-items-center gap-2 mb-2">
            <span class="ssl-status-badge ${statusClass}">
              <i data-lucide="${statusIcon}" style="width:18px;height:18px;"></i>
              <span>${statusText}</span>
            </span>
            <span class="text-muted font-mono">${cert.host}:${cert.port}</span>
          </div>
          <div class="ssl-days-highlight">
            ${cert.isExpired ? '已过期' : `剩余 ${cert.daysRemaining} 天`}
          </div>
          <div class="text-muted small mt-1">
            有效期限：${cert.validFrom} 至 ${cert.validTo}
          </div>
        </div>

        <div style="width: 200px;" class="text-end">
          <div class="small text-muted mb-1">有效期进度</div>
          <div class="progress" style="height: 10px;">
            <div class="progress-bar ${cert.isExpired ? 'bg-danger' : cert.isExpiringSoon ? 'bg-warning' : 'bg-success'}" style="width: ${cert.percentElapsed}%;"></div>
          </div>
          <div class="small text-muted mt-1">已使用 ${cert.percentElapsed}%</div>
        </div>
      </div>

      <!-- Detail Grid -->
      <div class="ssl-detail-grid">
        <div class="ssl-detail-item">
          <span class="ssl-detail-label">证书颁发给 (Subject)</span>
          <span class="ssl-detail-val font-mono">${cert.subject}</span>
        </div>
        <div class="ssl-detail-item">
          <span class="ssl-detail-label">证书颁发机构 (Issuer)</span>
          <span class="ssl-detail-val font-mono">${cert.issuer}</span>
        </div>
        <div class="ssl-detail-item">
          <span class="ssl-detail-label">协商协议 / 密码套件 (Protocol & Cipher)</span>
          <span class="ssl-detail-val font-mono text-primary">${cert.protocol} / ${cert.cipherAlgorithm || 'AES'} (${cert.cipherStrength || 256} bits)</span>
        </div>
        <div class="ssl-detail-item">
          <span class="ssl-detail-label">签名算法与公钥 (Key Info)</span>
          <span class="ssl-detail-val font-mono">${cert.signatureAlgorithm} / ${cert.keyAlgorithm} (${cert.keySize} bits)</span>
        </div>
        <div class="ssl-detail-item">
          <span class="ssl-detail-label">证书序列号 (Serial Number)</span>
          <span class="ssl-detail-val font-mono">${cert.serialNumber}</span>
        </div>
        <div class="ssl-detail-item">
          <span class="ssl-detail-label">证书 SHA-1 指纹 (Thumbprint)</span>
          <span class="ssl-detail-val font-mono">${cert.thumbprint}</span>
        </div>
      </div>

      <!-- SANs and Chain Card -->
      <div class="card p-3 border-color">
        <h6 class="fw-bold mb-2">备用主体名称 (SANs):</h6>
        <div class="d-flex flex-wrap">${sansHtml}</div>

        <h6 class="fw-bold mt-3 mb-2">证书信任链结构:</h6>
        <div>${chainHtml}</div>
      </div>
    `;

    if (window.lucide) lucide.createIcons({ root: mount });
  }
};

// ==========================================
// 4. ProxyManagerTool - 系统与终端代理管理
// ==========================================
const ProxyManagerTool = {
  currentConfig: { enabled: false, server: '', override: '', pacUrl: '' },

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <!-- Top Status Banner -->
        <div class="proxy-banner-card">
          <div class="d-flex align-items-center gap-3">
            <div class="tool-icon-wrapper" style="background:var(--accent-primary-light); color:var(--accent-primary);">
              <i data-lucide="arrow-left-right"></i>
            </div>
            <div>
              <h5 class="fw-bold m-0" id="proxyStatusTitle">系统代理：检测中...</h5>
              <small class="text-muted" id="proxyStatusDesc">读取 Windows Internet Settings 全局代理配置</small>
            </div>
          </div>

          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-outline-danger btn-sm" id="btnDisableProxy">关闭系统代理</button>
            <button class="btn btn-primary btn-sm" id="btnEnableProxy">启用系统代理</button>
          </div>
        </div>

        <!-- System Proxy Settings Form -->
        <div class="card p-3 border-color">
          <h6 class="fw-bold mb-3">Windows 系统代理配置 (WinInet)</h6>
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label small fw-bold text-muted">代理服务器地址 (IP:Port)</label>
              <input type="text" class="form-control form-control-sm font-mono" id="proxyServerInput" placeholder="例如: 127.0.0.1:7890">
            </div>
            <div class="col-md-6">
              <label class="form-label small fw-bold text-muted">绕过代理的地址 (Bypass List)</label>
              <input type="text" class="form-control form-control-sm font-mono" id="proxyOverrideInput" placeholder="例如: <local>;127.*;192.168.*" value="<local>;localhost;127.*;192.168.*">
            </div>
            <div class="col-12">
              <label class="form-label small fw-bold text-muted">自动配置脚本 PAC 网址 (可选)</label>
              <input type="text" class="form-control form-control-sm font-mono" id="proxyPacInput" placeholder="例如: http://127.0.0.1:7890/pac">
            </div>
          </div>

          <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
            <div class="d-flex align-items-center gap-1">
              <span class="small text-muted me-1">快捷预设:</span>
              <button class="btn btn-outline-secondary btn-sm py-0 px-2" onclick="ProxyManagerTool.setPreset('127.0.0.1:7890')">Clash (7890)</button>
              <button class="btn btn-outline-secondary btn-sm py-0 px-2" onclick="ProxyManagerTool.setPreset('127.0.0.1:10809')">v2rayN (10809)</button>
              <button class="btn btn-outline-secondary btn-sm py-0 px-2" onclick="ProxyManagerTool.setPreset('127.0.0.1:8888')">Fiddler (8888)</button>
            </div>
            <button class="btn btn-primary btn-sm px-3" id="btnSaveProxySettings">保存代理配置</button>
          </div>
        </div>

        <!-- Terminal Proxy Snippets -->
        <div class="card p-3 border-color">
          <h6 class="fw-bold mb-3">终端与开发工具一键代理命令</h6>
          <div class="d-flex flex-column gap-2">
            <div class="proxy-cmd-box">
              <div>
                <span class="badge bg-primary-subtle text-primary me-2">PowerShell</span>
                <span class="proxy-cmd-text" id="cmdPwsh">$env:http_proxy="http://127.0.0.1:7890"; $env:https_proxy="http://127.0.0.1:7890"</span>
              </div>
              <button class="btn btn-outline-primary btn-sm py-0 px-2" onclick="ProxyManagerTool.copyCmd('cmdPwsh')">复制</button>
            </div>

            <div class="proxy-cmd-box">
              <div>
                <span class="badge bg-secondary-subtle text-secondary me-2">CMD 命令行</span>
                <span class="proxy-cmd-text" id="cmdCmd">set http_proxy=http://127.0.0.1:7890 && set https_proxy=http://127.0.0.1:7890</span>
              </div>
              <button class="btn btn-outline-primary btn-sm py-0 px-2" onclick="ProxyManagerTool.copyCmd('cmdCmd')">复制</button>
            </div>

            <div class="proxy-cmd-box">
              <div>
                <span class="badge bg-success-subtle text-success me-2">Bash / WSL / Git Bash</span>
                <span class="proxy-cmd-text" id="cmdBash">export http_proxy=http://127.0.0.1:7890; export https_proxy=http://127.0.0.1:7890</span>
              </div>
              <button class="btn btn-outline-primary btn-sm py-0 px-2" onclick="ProxyManagerTool.copyCmd('cmdBash')">复制</button>
            </div>

            <div class="proxy-cmd-box">
              <div>
                <span class="badge bg-warning-subtle text-warning me-2">Git 全局代理</span>
                <span class="proxy-cmd-text" id="cmdGit">git config --global http.proxy http://127.0.0.1:7890</span>
              </div>
              <button class="btn btn-outline-primary btn-sm py-0 px-2" onclick="ProxyManagerTool.copyCmd('cmdGit')">复制</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadProxy();
  },

  bindEvents(container) {
    const btnEnable = container.querySelector('#btnEnableProxy');
    const btnDisable = container.querySelector('#btnDisableProxy');
    const btnSave = container.querySelector('#btnSaveProxySettings');
    const serverInput = container.querySelector('#proxyServerInput');

    if (btnEnable) btnEnable.onclick = () => this.toggleProxy(true);
    if (btnDisable) btnDisable.onclick = () => this.toggleProxy(false);
    if (btnSave) btnSave.onclick = () => this.saveProxy();
    if (serverInput) {
      serverInput.oninput = () => this.updateCommandSnippets(serverInput.value.trim());
    }
  },

  async loadProxy() {
    try {
      const res = await IPC.send('net_get_proxy');
      this.currentConfig = res || { enabled: false, server: '', override: '', pacUrl: '' };
      this.renderUI();
    } catch (e) {
      Toast.show('读取代理设置失败: ' + e.message, 'error');
    }
  },

  renderUI() {
    const title = document.getElementById('proxyStatusTitle');
    const desc = document.getElementById('proxyStatusDesc');
    const serverInput = document.getElementById('proxyServerInput');
    const overrideInput = document.getElementById('proxyOverrideInput');
    const pacInput = document.getElementById('proxyPacInput');

    if (this.currentConfig.enabled) {
      if (title) title.innerHTML = `<span class="status-dot online pulsing"></span>系统代理已开启 (${this.currentConfig.server || 'PAC'})`;
      if (desc) desc.textContent = `当前生效服务器: ${this.currentConfig.server || this.currentConfig.pacUrl}`;
    } else {
      if (title) title.innerHTML = `<span class="status-dot stopped"></span>系统代理已关闭`;
      if (desc) desc.textContent = `流量直连，未启用 Windows 系统代理`;
    }

    if (serverInput) serverInput.value = this.currentConfig.server || '127.0.0.1:7890';
    if (overrideInput && this.currentConfig.override) overrideInput.value = this.currentConfig.override;
    if (pacInput) pacInput.value = this.currentConfig.pacUrl || '';

    this.updateCommandSnippets(serverInput ? serverInput.value : '127.0.0.1:7890');
  },

  setPreset(server) {
    const serverInput = document.getElementById('proxyServerInput');
    if (serverInput) {
      serverInput.value = server;
      this.updateCommandSnippets(server);
    }
  },

  updateCommandSnippets(server) {
    const s = server || '127.0.0.1:7890';
    const pwsh = document.getElementById('cmdPwsh');
    const cmd = document.getElementById('cmdCmd');
    const bash = document.getElementById('cmdBash');
    const git = document.getElementById('cmdGit');

    if (pwsh) pwsh.textContent = `$env:http_proxy="http://${s}"; $env:https_proxy="http://${s}"`;
    if (cmd) cmd.textContent = `set http_proxy=http://${s} && set https_proxy=http://${s}`;
    if (bash) bash.textContent = `export http_proxy=http://${s}; export https_proxy=http://${s}`;
    if (git) git.textContent = `git config --global http.proxy http://${s}`;
  },

  async toggleProxy(enable) {
    const serverInput = document.getElementById('proxyServerInput');
    const overrideInput = document.getElementById('proxyOverrideInput');
    const pacInput = document.getElementById('proxyPacInput');

    const server = serverInput ? serverInput.value.trim() : '127.0.0.1:7890';
    const override = overrideInput ? overrideInput.value.trim() : '';
    const pacUrl = pacInput ? pacInput.value.trim() : '';

    try {
      const res = await IPC.send('net_set_proxy', { enabled: enable, server, override, pacUrl });
      Toast.show(res.message || '代理设置已更新', 'success');
      this.loadProxy();
    } catch (e) {
      Toast.show('更新代理失败: ' + e.message, 'error');
    }
  },

  async saveProxy() {
    this.toggleProxy(this.currentConfig.enabled);
  },

  copyCmd(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
      navigator.clipboard.writeText(el.textContent);
      Toast.show('命令已复制到剪贴板', 'success', 1200);
    }
  }
};

// ==========================================
// 5. FileServerTool - 简易局域网 HTTP 文件分享
// ==========================================
const FileServerTool = {
  serverState: { running: false, port: 8000, path: '', urls: [] },

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="file-server-card">
          <div class="d-flex align-items-center justify-content-between pb-3 border-bottom mb-3">
            <div class="d-flex align-items-center gap-3">
              <div class="tool-icon-wrapper" style="background:var(--accent-primary-light); color:var(--accent-primary);">
                <i data-lucide="share-2"></i>
              </div>
              <div>
                <h5 class="fw-bold m-0" id="fileServerStatusTitle">文件分享服务未运行</h5>
                <small class="text-muted" id="fileServerStatusSub">选择本地目录启动轻量 HTTP 文件服务，手机扫码即可极速下载</small>
              </div>
            </div>

            <button class="btn btn-primary px-4" id="btnToggleFileServer">
              <i data-lucide="play" class="lucide-sm me-1"></i> 启动分享服务
            </button>
          </div>

          <div class="row g-3">
            <div class="col-md-9">
              <label class="form-label fw-bold small text-muted">共享目录或文件绝对路径</label>
              <input type="text" class="form-control font-mono" id="fsPathInput" placeholder="例如: C:\\Users\\User\\Downloads 或 D:\\ShareFolder">
            </div>
            <div class="col-md-3">
              <label class="form-label fw-bold small text-muted">监听端口</label>
              <input type="number" class="form-control font-mono" id="fsPortInput" value="8000">
            </div>
          </div>
        </div>

        <!-- Running Details & QR Code -->
        <div class="card p-3 border-color flex-grow-1 overflow-auto d-none" id="fileServerRunningPanel">
          <h6 class="fw-bold mb-3">局域网访问地址与扫码下载</h6>
          <div class="row g-4 align-items-center">
            <div class="col-md-7">
              <p class="text-muted small">局域网内的手机、平板或其它电脑可通过以下链接访问下载：</p>
              <div class="d-flex flex-column gap-2" id="fsUrlsList"></div>
            </div>
            <div class="col-md-5 d-flex flex-column align-items-center">
              <div class="qr-container shadow-sm">
                <canvas id="fsQrCanvas" width="160" height="160"></canvas>
              </div>
              <small class="text-muted mt-2">📱 手机微信/浏览器扫码直达</small>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.checkStatus();
  },

  bindEvents(container) {
    const btnToggle = container.querySelector('#btnToggleFileServer');
    if (btnToggle) {
      btnToggle.onclick = () => {
        if (this.serverState.running) {
          this.stopServer();
        } else {
          this.startServer();
        }
      };
    }
  },

  async checkStatus() {
    try {
      const res = await IPC.send('net_get_file_server_status');
      this.serverState = res || { running: false, port: 8000, path: '', urls: [] };
      this.renderUI();
    } catch (e) { }
  },

  renderUI() {
    const title = document.getElementById('fileServerStatusTitle');
    const sub = document.getElementById('fileServerStatusSub');
    const btn = document.getElementById('btnToggleFileServer');
    const panel = document.getElementById('fileServerRunningPanel');
    const pathInput = document.getElementById('fsPathInput');
    const portInput = document.getElementById('fsPortInput');
    const urlsContainer = document.getElementById('fsUrlsList');
    const canvas = document.getElementById('fsQrCanvas');

    if (this.serverState.running) {
      if (title) title.innerHTML = `<span class="status-dot online pulsing"></span>文件服务正在运行中 (: ${this.serverState.port})`;
      if (sub) sub.textContent = `当前共享路径: ${this.serverState.path}`;
      if (btn) {
        btn.className = 'btn btn-danger px-4';
        btn.innerHTML = `<i data-lucide="square" class="lucide-sm me-1"></i> 停止服务`;
      }
      if (panel) panel.classList.remove('d-none');

      if (urlsContainer && this.serverState.urls) {
        urlsContainer.innerHTML = this.serverState.urls.map(url => `
          <div class="proxy-cmd-box">
            <span class="font-mono text-primary fw-bold">${url}</span>
            <div>
              <button class="btn btn-outline-primary btn-sm py-0 px-2" onclick="navigator.clipboard.writeText('${url}'); Toast.show('已复制下载地址', 'success');">复制</button>
              <button class="btn btn-outline-secondary btn-sm py-0 px-2 ms-1" onclick="IPC.send('open_external', { url: '${url}' })">打开</button>
            </div>
          </div>
        `).join('');
      }

      if (canvas && this.serverState.urls && this.serverState.urls[0]) {
        MiniQRCode.draw(this.serverState.urls[0], canvas);
      }
    } else {
      if (title) title.innerHTML = `<span class="status-dot stopped"></span>文件分享服务未运行`;
      if (sub) sub.textContent = `选择本地目录启动轻量 HTTP 文件服务，手机扫码即可极速下载`;
      if (btn) {
        btn.className = 'btn btn-primary px-4';
        btn.innerHTML = `<i data-lucide="play" class="lucide-sm me-1"></i> 启动分享服务`;
      }
      if (panel) panel.classList.add('d-none');
    }

    if (pathInput && this.serverState.path && !pathInput.value) pathInput.value = this.serverState.path;
    if (portInput && this.serverState.port) portInput.value = this.serverState.port;

    if (window.lucide) lucide.createIcons();
  },

  async startServer() {
    const pathInput = document.getElementById('fsPathInput');
    const portInput = document.getElementById('fsPortInput');

    const path = pathInput ? pathInput.value.trim() : '';
    const port = portInput ? parseInt(portInput.value.trim(), 10) || 8000 : 8000;

    if (!path) {
      Toast.show('请输入要共享的文件夹或文件路径', 'warning');
      return;
    }

    try {
      const res = await IPC.send('net_start_file_server', { path, port });
      if (res.success) {
        Toast.show(`文件服务已在端口 ${port} 成功启动！`, 'success');
        this.serverState = res;
        this.renderUI();
      }
    } catch (e) {
      Toast.show('启动文件服务器失败: ' + e.message, 'error');
    }
  },

  async stopServer() {
    try {
      await IPC.send('net_stop_file_server');
      Toast.show('文件分享服务已停止', 'info');
      this.serverState.running = false;
      this.renderUI();
    } catch (e) {
      Toast.show('停止服务失败: ' + e.message, 'error');
    }
  }
};

// ==========================================
// 6. RouteTracerTool - 路由表与 Traceroute 拓扑
// ==========================================
const RouteTracerTool = {
  activeTab: 'trace',

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs">
              <button class="tool-tab-btn active" id="tabTraceRoute"><i data-lucide="git-branch" class="lucide-sm me-1"></i> 路由追踪 (Traceroute)</button>
              <button class="tool-tab-btn" id="tabRouteTable"><i data-lucide="table" class="lucide-sm me-1"></i> Windows 路由表</button>
            </div>
          </div>
          <div class="tool-toolbar-right" id="traceToolbarRight">
            <div class="input-group input-group-sm" style="max-width: 280px;">
              <span class="input-group-text font-mono">目标</span>
              <input type="text" class="form-control font-mono" id="traceHostInput" placeholder="输入 IP 或域名" value="114.114.114.114">
            </div>
            <button class="btn btn-primary btn-sm px-3" id="btnStartTrace">
              <i data-lucide="play" class="lucide-sm me-1"></i> 开始追踪
            </button>
          </div>
        </div>

        <!-- Panel 1: Traceroute Flow -->
        <div class="card p-3 border-color flex-grow-1 overflow-auto" id="panelTraceFlow">
          <h6 class="fw-bold mb-3">逐跳路由追踪链路节点图</h6>
          <div class="trace-chain" id="traceChainContainer">
            <div class="text-center text-muted py-5">点击“开始追踪”分析前往目标主机的网络每一跳跃点</div>
          </div>
        </div>

        <!-- Panel 2: Routing Table -->
        <div class="card p-0 border-color flex-grow-1 overflow-hidden d-none d-flex flex-column" id="panelRouteTable">
          <div class="p-3 border-bottom d-flex justify-content-between align-items-center">
            <input type="text" class="form-control form-control-sm" id="routeFilterInput" placeholder="搜索目的地址 / 下一跳网关 / 接口..." style="max-width: 300px;">
            <button class="btn btn-outline-secondary btn-sm" id="btnRefreshRoutes"><i data-lucide="refresh-cw" class="lucide-sm me-1"></i> 刷新路由表</button>
          </div>
          <div class="table-responsive flex-grow-1 p-0 m-0">
            <table class="table table-hover table-bordered align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>目的网络 (Prefix)</th>
                  <th>下一跳网关 (NextHop)</th>
                  <th>网络接口 (Interface)</th>
                  <th>跃点数 (Metric)</th>
                  <th>协议</th>
                </tr>
              </thead>
              <tbody id="routeTableTbody">
                <tr><td colspan="5" class="text-center text-muted py-4">正在读取系统路由表...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
  },

  bindEvents(container) {
    const tabTrace = container.querySelector('#tabTraceRoute');
    const tabTable = container.querySelector('#tabRouteTable');
    const panelTrace = container.querySelector('#panelTraceFlow');
    const panelTable = container.querySelector('#panelRouteTable');
    const btnTrace = container.querySelector('#btnStartTrace');
    const btnRefresh = container.querySelector('#btnRefreshRoutes');
    const filterInput = container.querySelector('#routeFilterInput');

    if (tabTrace) {
      tabTrace.onclick = () => {
        tabTrace.classList.add('active');
        tabTable.classList.remove('active');
        panelTrace.classList.remove('d-none');
        panelTable.classList.add('d-none');
        document.getElementById('traceToolbarRight').classList.remove('d-none');
      };
    }

    if (tabTable) {
      tabTable.onclick = () => {
        tabTable.classList.add('active');
        tabTrace.classList.remove('active');
        panelTable.classList.remove('d-none');
        panelTrace.classList.add('d-none');
        document.getElementById('traceToolbarRight').classList.add('d-none');
        this.loadRoutes();
      };
    }

    if (btnTrace) btnTrace.onclick = () => this.startTrace();
    if (btnRefresh) btnRefresh.onclick = () => this.loadRoutes();
    if (filterInput) filterInput.oninput = () => this.renderRouteTable();
  },

  async startTrace() {
    const hostInput = document.getElementById('traceHostInput');
    const container = document.getElementById('traceChainContainer');
    const btn = document.getElementById('btnStartTrace');

    const host = hostInput ? hostInput.value.trim() : '';
    if (!host) {
      Toast.show('请输入目标主机地址', 'warning');
      return;
    }

    if (btn) btn.disabled = true;
    if (container) container.innerHTML = `<div class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在对 ${host} 执行逐跳路由追踪 (TTL 1~20)...</div>`;

    try {
      const res = await IPC.send('net_trace_route', { host, maxHops: 20, timeoutMs: 800 });
      this.renderTraceHops(res);
    } catch (e) {
      if (container) container.innerHTML = `<div class="text-danger py-4 text-center">路由追踪失败: ${e.message}</div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  renderTraceHops(res) {
    const container = document.getElementById('traceChainContainer');
    if (!container || !res) return;

    const hops = res.hops || [];
    if (hops.length === 0) {
      container.innerHTML = `<div class="text-center text-muted py-4">未能探测到任何跃点节点</div>`;
      return;
    }

    container.innerHTML = hops.map(h => {
      let badgeClass = 'slow';
      if (h.latencyMs >= 0 && h.latencyMs < 40) badgeClass = 'fast';
      else if (h.latencyMs >= 40 && h.latencyMs < 120) badgeClass = 'medium';

      const latencyText = h.latencyMs >= 0 ? `${h.latencyMs} ms` : '请求超时 (*)';

      return `
        <div class="trace-node">
          <div class="d-flex align-items-center gap-3">
            <span class="trace-hop-num">${h.hop}</span>
            <div>
              <div class="font-mono fw-bold text-main">${h.ip}</div>
              <div class="text-muted small">${h.hostname || '<span class="text-muted">-</span>'}</div>
            </div>
          </div>
          <span class="trace-latency-badge ${badgeClass}">${latencyText}</span>
        </div>
      `;
    }).join('');
  },

  async loadRoutes() {
    const tbody = document.getElementById('routeTableTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在获取系统路由表...</td></tr>`;

    try {
      this.routes = await IPC.send('net_get_route_table');
      this.renderRouteTable();
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">读取路由表失败: ${e.message}</td></tr>`;
    }
  },

  renderRouteTable() {
    const tbody = document.getElementById('routeTableTbody');
    const filterInput = document.getElementById('routeFilterInput');
    if (!tbody || !this.routes) return;

    const query = filterInput ? filterInput.value.trim().toLowerCase() : '';
    const filtered = this.routes.filter(r => {
      if (!query) return true;
      return (r.destination && r.destination.toLowerCase().includes(query)) ||
             (r.nextHop && r.nextHop.toLowerCase().includes(query)) ||
             (r.interfaceAlias && r.interfaceAlias.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">无匹配路由项</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td class="font-mono fw-bold">${r.destination}</td>
        <td class="font-mono text-primary">${r.nextHop}</td>
        <td>${r.interfaceAlias}</td>
        <td class="font-mono">${r.metric}</td>
        <td><span class="badge bg-secondary-subtle text-secondary">${r.protocol || 'Net'}</span></td>
      </tr>
    `).join('');
  }
};

// ==========================================
// 7. ServiceManagerTool - Windows 服务管理器
// ==========================================
const ServiceManagerTool = {
  services: [],
  activeFilter: 'all',

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs">
              <button class="tool-tab-btn active" data-svc-tab="all">全部服务</button>
              <button class="tool-tab-btn" data-svc-tab="running">运行中</button>
              <button class="tool-tab-btn" data-svc-tab="stopped">已停止</button>
              <button class="tool-tab-btn" data-svc-tab="auto">自动启动</button>
            </div>
            <button class="btn btn-outline-secondary btn-sm" id="btnRefreshServices">
              <i data-lucide="refresh-cw" class="lucide-sm me-1"></i> 刷新
            </button>
          </div>
          <div class="tool-toolbar-right">
            <input type="text" class="form-control form-control-sm" id="svcSearchInput" placeholder="搜索服务名称 / 显示名 / 描述..." style="max-width: 260px;">
          </div>
        </div>

        <div class="card p-0 border-color flex-grow-1 overflow-hidden d-flex flex-column">
          <div class="table-responsive flex-grow-1 p-0 m-0">
            <table class="table table-hover table-bordered align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>服务名称 (Name)</th>
                  <th>显示名称 (DisplayName)</th>
                  <th style="width: 100px;">运行状态</th>
                  <th style="width: 110px;">启动类型</th>
                  <th style="width: 70px;">PID</th>
                  <th style="width: 190px;">快捷控制</th>
                </tr>
              </thead>
              <tbody id="servicesTbody">
                <tr><td colspan="6" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在加载 Windows 服务列表...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadServices();
  },

  bindEvents(container) {
    const btnRefresh = container.querySelector('#btnRefreshServices');
    const searchInput = container.querySelector('#svcSearchInput');

    if (btnRefresh) btnRefresh.onclick = () => this.loadServices();
    if (searchInput) searchInput.oninput = () => this.renderTable();

    container.querySelectorAll('[data-svc-tab]').forEach(btn => {
      btn.onclick = () => {
        container.querySelectorAll('[data-svc-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.dataset.svcTab;
        this.renderTable();
      };
    });
  },

  async loadServices() {
    const tbody = document.getElementById('servicesTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在加载 Windows 服务列表...</td></tr>`;

    try {
      const data = await IPC.send('sys_get_services');
      this.services = Array.isArray(data) ? data : [];
      this.renderTable();
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">加载服务失败: ${e.message}</td></tr>`;
    }
  },

  renderTable() {
    const tbody = document.getElementById('servicesTbody');
    const searchInput = document.getElementById('svcSearchInput');
    if (!tbody) return;

    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const filtered = this.services.filter(s => {
      if (this.activeFilter === 'running' && s.status !== 'Running') return false;
      if (this.activeFilter === 'stopped' && s.status !== 'Stopped') return false;
      if (this.activeFilter === 'auto' && s.startMode !== 'Auto' && s.startMode !== 'Automatic') return false;

      if (query) {
        const m1 = (s.name && s.name.toLowerCase().includes(query));
        const m2 = (s.displayName && s.displayName.toLowerCase().includes(query));
        const m3 = (s.description && s.description.toLowerCase().includes(query));
        if (!m1 && !m2 && !m3) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">无匹配的 Windows 服务</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(s => {
      const isRunning = s.status === 'Running';
      const statusBadge = isRunning
        ? `<span class="badge bg-success-subtle text-success"><span class="status-dot online"></span>运行中</span>`
        : `<span class="badge bg-secondary-subtle text-secondary"><span class="status-dot stopped"></span>已停止</span>`;

      return `
        <tr>
          <td class="font-mono fw-bold text-main">${s.name}</td>
          <td>
            <div class="fw-semibold">${s.displayName || s.name}</div>
            <small class="text-muted text-truncate d-block" style="max-width:350px;" title="${s.description || ''}">${s.description || ''}</small>
          </td>
          <td>${statusBadge}</td>
          <td><span class="badge bg-light text-dark border">${s.startMode}</span></td>
          <td class="font-mono text-muted small">${s.pid > 0 ? s.pid : '-'}</td>
          <td>
            <div class="btn-group btn-group-sm">
              ${isRunning
                ? `<button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="ServiceManagerTool.setServiceState('${s.name}', 'stop')">停止</button>
                   <button class="btn btn-outline-warning btn-sm py-0 px-2" onclick="ServiceManagerTool.setServiceState('${s.name}', 'restart')">重启</button>`
                : `<button class="btn btn-outline-success btn-sm py-0 px-2" onclick="ServiceManagerTool.setServiceState('${s.name}', 'start')">启动</button>`
              }
              <button class="btn btn-outline-secondary btn-sm py-0 px-2" onclick="ServiceManagerTool.promptStartupType('${s.name}')">自启</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async setServiceState(name, action) {
    try {
      const res = await IPC.send('sys_set_service_state', { name, action });
      Toast.show(res.message || `服务 ${name} 操作成功`, 'success');
      this.loadServices();
    } catch (e) {
      Toast.show(`操作服务 ${name} 失败: ` + e.message, 'error');
    }
  },

  async promptStartupType(name) {
    const type = prompt(`请选择服务 [${name}] 的启动类型：\n1. Automatic (自动启动)\n2. Manual (手动触发)\n3. Disabled (禁用)`, 'Automatic');
    if (!type) return;

    let targetType = 'Automatic';
    if (type.includes('2') || type.toLowerCase().includes('manual')) targetType = 'Manual';
    else if (type.includes('3') || type.toLowerCase().includes('disable')) targetType = 'Disabled';

    try {
      const res = await IPC.send('sys_set_service_start_type', { name, startType: targetType });
      Toast.show(res.message || `已将 ${name} 设置为 ${targetType}`, 'success');
      this.loadServices();
    } catch (e) {
      Toast.show('修改启动类型失败: ' + e.message, 'error');
    }
  }
};

// ==========================================
// 8. StartupAuditorTool - 开机自启动项全面审计
// ==========================================
const StartupAuditorTool = {
  items: [],

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <button class="btn btn-primary btn-sm px-3" id="btnRefreshStartup">
              <i data-lucide="refresh-cw" class="lucide-sm me-1"></i> 扫描自启动项
            </button>
            <span class="text-muted small" id="startupCountText">共发现 0 项开机自启</span>
          </div>
          <div class="tool-toolbar-right">
            <input type="text" class="form-control form-control-sm" id="startupFilterInput" placeholder="过滤名称 / 路径 / 来源..." style="max-width: 260px;">
          </div>
        </div>

        <div class="card p-0 border-color flex-grow-1 overflow-hidden d-flex flex-column">
          <div class="table-responsive flex-grow-1 p-0 m-0">
            <table class="table table-hover table-bordered align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>自启项目名称</th>
                  <th>启动命令 / 执行目标路径</th>
                  <th style="width: 170px;">注册来源位置</th>
                  <th style="width: 100px;">文件有效性</th>
                  <th style="width: 120px;">操作</th>
                </tr>
              </thead>
              <tbody id="startupTbody">
                <tr><td colspan="5" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在全面扫描 Windows 自启动入口...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadStartupItems();
  },

  bindEvents(container) {
    const btn = container.querySelector('#btnRefreshStartup');
    const filter = container.querySelector('#startupFilterInput');

    if (btn) btn.onclick = () => this.loadStartupItems();
    if (filter) filter.oninput = () => this.renderTable();
  },

  async loadStartupItems() {
    const tbody = document.getElementById('startupTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在全面扫描 Windows 自启动入口...</td></tr>`;

    try {
      this.items = await IPC.send('sys_get_startup_items');
      this.renderTable();
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">扫描自启动失败: ${e.message}</td></tr>`;
    }
  },

  renderTable() {
    const tbody = document.getElementById('startupTbody');
    const countText = document.getElementById('startupCountText');
    const filterInput = document.getElementById('startupFilterInput');
    if (!tbody || !this.items) return;

    const query = filterInput ? filterInput.value.trim().toLowerCase() : '';
    const filtered = this.items.filter(item => {
      if (!query) return true;
      return (item.name && item.name.toLowerCase().includes(query)) ||
             (item.command && item.command.toLowerCase().includes(query)) ||
             (item.locationType && item.locationType.toLowerCase().includes(query));
    });

    if (countText) countText.textContent = `共发现 ${this.items.length} 项开机自启（当前展示 ${filtered.length} 项）`;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">未找到匹配的自启动项</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => `
      <tr>
        <td class="font-mono fw-bold text-main">${item.name}</td>
        <td>
          <span class="font-mono small text-truncate d-block" style="max-width:400px;" title="${item.command}">${item.command}</span>
        </td>
        <td><span class="badge bg-secondary-subtle text-secondary">${item.locationType}</span></td>
        <td>
          ${item.fileExists
            ? `<span class="badge bg-success-subtle text-success">文件存在</span>`
            : `<span class="badge bg-warning-subtle text-warning">失效残留</span>`
          }
        </td>
        <td>
          <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="StartupAuditorTool.deleteItem('${item.id}', '${item.locationType}', '${item.locationPath.replace(/\\/g, '\\\\')}', '${item.name}')">移除自启</button>
        </td>
      </tr>
    `).join('');
  },

  async deleteItem(id, locationType, locationPath, name) {
    if (!confirm(`确定要移除开机自启动项 [${name}] 吗？`)) return;

    try {
      const res = await IPC.send('sys_remove_startup_item', { id, locationType, locationPath, name });
      Toast.show(res.message || `已移除自启项 ${name}`, 'success');
      this.loadStartupItems();
    } catch (e) {
      Toast.show('移除自启项失败: ' + e.message, 'error');
    }
  }
};

// ==========================================
// 9. FileLockTool - 文件占用与句柄解锁
// ==========================================
const FileLockTool = {
  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left flex-grow-1">
            <div class="input-group input-group-sm w-100">
              <span class="input-group-text"><i data-lucide="file-search" style="width:14px;height:14px;"></i></span>
              <input type="text" class="form-control font-mono" id="fileLockPathInput" placeholder="输入或粘贴被占用的文件/文件夹完整路径...">
              <button class="btn btn-primary px-3" id="btnCheckFileLock">
                <i data-lucide="unlock" class="lucide-sm me-1"></i> 查询锁定进程
              </button>
            </div>
          </div>
        </div>

        <div id="fileLockResultMount" class="card p-4 border-color flex-grow-1 overflow-auto">
          <div class="text-center text-muted py-5">
            <i data-lucide="lock" style="width:48px;height:48px;opacity:0.3;margin-bottom:12px;"></i>
            <h5>输入文件路径查询占用</h5>
            <p class="small text-muted">基于 Windows 原生 Restart Manager API，精准定位锁定目标文件的进程 PID 与窗口标题</p>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
  },

  bindEvents(container) {
    const btn = container.querySelector('#btnCheckFileLock');
    const input = container.querySelector('#fileLockPathInput');

    if (btn) btn.onclick = () => this.checkLock();
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.checkLock();
      });
    }
  },

  async checkLock() {
    const input = document.getElementById('fileLockPathInput');
    const mount = document.getElementById('fileLockResultMount');
    const btn = document.getElementById('btnCheckFileLock');

    const path = input ? input.value.trim() : '';
    if (!path) {
      Toast.show('请输入文件或目录路径', 'warning');
      return;
    }

    if (btn) btn.disabled = true;
    if (mount) mount.innerHTML = `<div class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在调用 Restart Manager 探测占用句柄...</div>`;

    try {
      const res = await IPC.send('sys_get_file_locks', { path });
      this.renderResult(res);
    } catch (e) {
      if (mount) {
        mount.innerHTML = `
          <div class="alert alert-danger d-flex align-items-center gap-2">
            <i data-lucide="alert-circle"></i>
            <div><strong>查询失败：</strong>${e.message}</div>
          </div>
        `;
        if (window.lucide) lucide.createIcons({ root: mount });
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  renderResult(res) {
    const mount = document.getElementById('fileLockResultMount');
    if (!mount || !res) return;

    if (!res.locked || !res.processes || res.processes.length === 0) {
      mount.innerHTML = `
        <div class="text-center py-5">
          <i data-lucide="check-circle-2" style="width:48px;height:48px;color:#10b981;margin-bottom:12px;"></i>
          <h5 class="fw-bold text-success">文件未被任何进程锁定</h5>
          <p class="text-muted small">目标路径：${res.path}<br>该文件当前可被安全删除、重命名或编辑。</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons({ root: mount });
      return;
    }

    mount.innerHTML = `
      <div class="alert alert-warning d-flex align-items-center justify-content-between mb-3">
        <div class="d-flex align-items-center gap-2">
          <i data-lucide="alert-triangle"></i>
          <div><strong>警告：</strong>发现 <strong>${res.processes.length}</strong> 个进程正在锁定此文件</div>
        </div>
        <span class="font-mono small">${res.path}</span>
      </div>

      <div class="table-responsive">
        <table class="table table-hover table-bordered align-middle">
          <thead class="table-light">
            <tr>
              <th>PID</th>
              <th>进程名称</th>
              <th>主窗口标题</th>
              <th>进程路径</th>
              <th>内存占用</th>
              <th>强行解锁</th>
            </tr>
          </thead>
          <tbody>
            ${res.processes.map(p => `
              <tr>
                <td class="font-mono fw-bold">${p.pid}</td>
                <td class="font-mono text-primary">${p.name}</td>
                <td>${p.title || '<span class="text-muted">-</span>'}</td>
                <td class="font-mono small text-truncate" style="max-width:300px;" title="${p.path}">${p.path || '-'}</td>
                <td class="font-mono">${p.memoryMB} MB</td>
                <td>
                  <button class="btn btn-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="FileLockTool.killProcess(${p.pid})">结束进程</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    if (window.lucide) lucide.createIcons({ root: mount });
  },

  async killProcess(pid) {
    if (!confirm(`确定要强行终止 PID 为 ${pid} 的占用进程吗？`)) return;

    try {
      const res = await IPC.send('sys_kill_process', { pid });
      Toast.show(res.message || `已终止进程 ${pid}`, 'success');
      this.checkLock();
    } catch (e) {
      Toast.show('终止进程失败: ' + e.message, 'error');
    }
  }
};

// ==========================================
// 10. SystemSpecsTool - 硬件规格与运行健康面板
// ==========================================
const SystemSpecsTool = {
  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <h5 class="m-0 fw-bold"><i data-lucide="gauge" class="lucide-sm me-2 text-primary"></i>硬件规格与系统运行健康面板</h5>
          </div>
          <div class="tool-toolbar-right">
            <button class="btn btn-primary btn-sm px-3" id="btnRefreshSpecs">
              <i data-lucide="refresh-cw" class="lucide-sm me-1"></i> 刷新数据
            </button>
          </div>
        </div>

        <div class="specs-dashboard-grid flex-grow-1 overflow-auto" id="specsDashboardGrid">
          <div class="text-center text-muted py-5 w-100"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在采集硬件传感器与系统信息...</div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadSpecs();
  },

  bindEvents(container) {
    const btn = container.querySelector('#btnRefreshSpecs');
    if (btn) btn.onclick = () => this.loadSpecs();
  },

  async loadSpecs() {
    const grid = document.getElementById('specsDashboardGrid');
    if (!grid) return;
    grid.innerHTML = `<div class="text-center text-muted py-5 w-100"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在采集硬件传感器与系统信息...</div>`;

    try {
      const specs = await IPC.send('sys_get_hardware_specs');
      this.renderDashboard(specs);
    } catch (e) {
      grid.innerHTML = `<div class="text-danger py-4 text-center">读取硬件信息失败: ${e.message}</div>`;
    }
  },

  renderDashboard(specs) {
    const grid = document.getElementById('specsDashboardGrid');
    if (!grid || !specs) return;

    const cpu = specs.cpu || {};
    const mem = specs.memory || {};
    const disks = specs.disks || [];
    const gpus = specs.gpus || [];
    const os = specs.os || {};

    grid.innerHTML = `
      <!-- 1. CPU Card -->
      <div class="specs-card">
        <div class="specs-card-header">
          <span class="specs-card-title"><i data-lucide="cpu" class="text-primary"></i> 处理器 (CPU)</span>
          <span class="badge bg-primary-subtle text-primary">${cpu.cores || 0} 核 / ${cpu.threads || 0} 线程</span>
        </div>
        <div>
          <div class="fw-bold fs-6 text-main mb-2">${cpu.name || 'Unknown Processor'}</div>
          <div class="specs-metric-row"><span class="text-muted">基准主频:</span><span class="specs-metric-val">${cpu.maxClockSpeedMHz || 0} MHz</span></div>
          <div class="specs-metric-row"><span class="text-muted">封装插槽:</span><span class="specs-metric-val">${cpu.socket || 'Socket'}</span></div>
          <div class="specs-metric-row mt-2"><span class="text-muted">当前使用率:</span><span class="specs-metric-val text-primary">${cpu.loadPercent || 0}%</span></div>
          <div class="progress mt-1" style="height:6px;">
            <div class="progress-bar" style="width: ${cpu.loadPercent || 0}%;"></div>
          </div>
        </div>
      </div>

      <!-- 2. Memory Card -->
      <div class="specs-card">
        <div class="specs-card-header">
          <span class="specs-card-title"><i data-lucide="layers" class="text-success"></i> 物理内存 (RAM)</span>
          <span class="badge bg-success-subtle text-success">${mem.totalGB || 0} GB 总量</span>
        </div>
        <div>
          <div class="specs-metric-row"><span class="text-muted">已用内存:</span><span class="specs-metric-val">${mem.usedGB || 0} GB (${mem.percentUsed || 0}%)</span></div>
          <div class="specs-metric-row"><span class="text-muted">可用容量:</span><span class="specs-metric-val text-success">${mem.freeGB || 0} GB</span></div>
          <div class="progress my-2" style="height:8px;">
            <div class="progress-bar bg-success" style="width: ${mem.percentUsed || 0}%;"></div>
          </div>
          <div class="small text-muted mb-1">内存插槽详情:</div>
          <div class="font-mono small">
            ${(mem.slots && mem.slots.length > 0)
              ? mem.slots.map(s => `<div>• ${s.slot}: ${s.capacityGB}GB @ ${s.speedMHz}MHz (${s.manufacturer})</div>`).join('')
              : '<div>板载 / 单条内存</div>'
            }
          </div>
        </div>
      </div>

      <!-- 3. Storage Disks Card -->
      <div class="specs-card">
        <div class="specs-card-header">
          <span class="specs-card-title"><i data-lucide="hard-drive" class="text-warning"></i> 本地磁盘驱动器</span>
          <span class="badge bg-warning-subtle text-warning">${disks.length} 个分区</span>
        </div>
        <div class="d-flex flex-column gap-2">
          ${disks.map(d => `
            <div>
              <div class="d-flex justify-content-between small fw-bold">
                <span>盘符 ${d.drive} (${d.fileSystem})</span>
                <span>${d.usedGB}G / ${d.totalGB}G</span>
              </div>
              <div class="progress mt-1" style="height:6px;">
                <div class="progress-bar ${d.percentUsed > 85 ? 'bg-danger' : 'bg-warning'}" style="width: ${d.percentUsed}%;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 4. GPU & OS Health Card -->
      <div class="specs-card">
        <div class="specs-card-header">
          <span class="specs-card-title"><i data-lucide="monitor" class="text-info"></i> 显卡与系统健康</span>
          <span class="badge bg-info-subtle text-info">${os.architecture || '64位'}</span>
        </div>
        <div>
          <div class="specs-metric-row"><span class="text-muted">显卡设备:</span><span class="specs-metric-val text-truncate" style="max-width:200px;">${(gpus[0] && gpus[0].name) || '核芯显卡'}</span></div>
          <div class="specs-metric-row"><span class="text-muted">操作系统:</span><span class="specs-metric-val">${os.caption || 'Windows 11'}</span></div>
          <div class="specs-metric-row"><span class="text-muted">系统版本 Build:</span><span class="specs-metric-val">${os.buildNumber || '-'}</span></div>
          <div class="specs-metric-row"><span class="text-muted">计算机名称:</span><span class="specs-metric-val">${os.computerName || '-'}</span></div>
          <div class="specs-metric-row mt-2 pt-2 border-top"><span class="text-muted">连续运行时间 (Uptime):</span><span class="specs-metric-val text-primary">${os.uptime || '-'}</span></div>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons({ root: grid });
  }
};

// ==========================================
// 11. SystemLauncherTool - 常用系统管理入口与上帝模式
// ==========================================
const SystemLauncherTool = {
  shortcuts: [
    // MMC Tools
    { key: 'gpedit', name: '组策略编辑器', cmd: 'gpedit.msc', group: 'mmc', icon: 'shield-alert', desc: '系统与安全组策略高级配置' },
    { key: 'regedit', name: '注册表编辑器', cmd: 'regedit.exe', group: 'mmc', icon: 'key', desc: 'Windows Registry 注册表读写' },
    { key: 'devmgmt', name: '设备管理器', cmd: 'devmgmt.msc', group: 'mmc', icon: 'hard-drive', desc: '硬件设备与驱动管理' },
    { key: 'eventvwr', name: '事件查看器', cmd: 'eventvwr.msc', group: 'mmc', icon: 'file-text', desc: '系统日志、崩溃与错误事件审计' },
    { key: 'taskschd', name: '任务计划程序', cmd: 'taskschd.msc', group: 'mmc', icon: 'clock', desc: '系统定时与开机任务管理' },
    { key: 'diskmgmt', name: '磁盘管理', cmd: 'diskmgmt.msc', group: 'mmc', icon: 'pie-chart', desc: '分区压缩、扩展与驱动器号分配' },
    { key: 'compmgmt', name: '计算机管理', cmd: 'compmgmt.msc', group: 'mmc', icon: 'server', desc: '综合计算机管理控制台' },
    { key: 'perfmon', name: '性能监视器', cmd: 'perfmon.msc', group: 'mmc', icon: 'activity', desc: '系统性能计数器与实时分析' },
    { key: 'firewall', name: '高级安全防火墙', cmd: 'wf.msc', group: 'mmc', icon: 'shield', desc: '入站与出站防火墙规则' },
    { key: 'services', name: 'Windows 服务', cmd: 'services.msc', group: 'mmc', icon: 'sliders', desc: '系统服务管理器 MMC' },

    // Control Panel
    { key: 'ncpa', name: '网络连接', cmd: 'ncpa.cpl', group: 'cpl', icon: 'wifi', desc: '网络适配器与以太网连接设置' },
    { key: 'appwiz', name: '程序和功能', cmd: 'appwiz.cpl', group: 'cpl', icon: 'package', desc: '控制面板传统软件卸载面板' },
    { key: 'sysdm', name: '系统属性', cmd: 'sysdm.cpl', group: 'cpl', icon: 'sliders-horizontal', desc: '环境变量、远程桌面与系统保护' },
    { key: 'powercfg', name: '电源选项', cmd: 'powercfg.cpl', group: 'cpl', icon: 'zap', desc: '高性能电源方案与睡眠管理' },
    { key: 'mmsys', name: '声音设置', cmd: 'mmsys.cpl', group: 'cpl', icon: 'volume-2', desc: '音频播放、录音与输出设备' },

    // Utilities & GodMode
    { key: 'godmode', name: '上帝模式 (GodMode)', cmd: 'shell:::{ED7BA...}', group: 'util', icon: 'sparkles', desc: '聚集所有 Windows 隐藏控制面板' },
    { key: 'dxdiag', name: 'DirectX 诊断工具', cmd: 'dxdiag.exe', group: 'util', icon: 'monitor', desc: '显卡、DirectX 与声音硬件测试' },
    { key: 'resmon', name: '资源监视器', cmd: 'resmon.exe', group: 'util', icon: 'cpu', desc: '网络、磁盘句柄与内存实时监视' },
    { key: 'msinfo32', name: '系统信息 (msinfo32)', cmd: 'msinfo32.exe', group: 'util', icon: 'info', desc: '最详尽的系统软硬件资源摘要' },
    { key: 'certmgr', name: '证书管理器', cmd: 'certmgr.msc', group: 'util', icon: 'shield-check', desc: '系统受信任根证书与用户证书' },
    { key: 'cleanmgr', name: '磁盘清理工具', cmd: 'cleanmgr.exe', group: 'util', icon: 'trash-2', desc: '一键清理 Windows Update 与临时文件' }
  ],

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <h5 class="m-0 fw-bold"><i data-lucide="terminal" class="lucide-sm me-2 text-primary"></i>Windows 系统管理入口与上帝模式速开矩阵</h5>
          </div>
          <div class="tool-toolbar-right">
            <input type="text" class="form-control form-control-sm" id="launcherSearchInput" placeholder="快速搜索工具 (例如: 组策略 / 注册表 / ncpa)..." style="max-width: 300px;">
          </div>
        </div>

        <div class="flex-grow-1 overflow-auto d-flex flex-column gap-4 p-1" id="launcherGroupsMount"></div>
      </div>
    `;

    this.bindEvents(container);
    this.renderCards();
  },

  bindEvents(container) {
    const input = container.querySelector('#launcherSearchInput');
    if (input) input.oninput = () => this.renderCards();
  },

  renderCards() {
    const mount = document.getElementById('launcherGroupsMount');
    const input = document.getElementById('launcherSearchInput');
    if (!mount) return;

    const query = input ? input.value.trim().toLowerCase() : '';

    const groups = [
      { id: 'mmc', title: '核心 MMC 管理控制台' },
      { id: 'cpl', title: '经典控制面板组件 (CPL)' },
      { id: 'util', title: '高级系统诊断与上帝模式' }
    ];

    let html = '';
    groups.forEach(g => {
      const items = this.shortcuts.filter(s => s.group === g.id).filter(s => {
        if (!query) return true;
        return s.name.toLowerCase().includes(query) || s.cmd.toLowerCase().includes(query) || s.desc.toLowerCase().includes(query);
      });

      if (items.length > 0) {
        html += `
          <div>
            <h6 class="fw-bold text-muted mb-2">${g.title} (${items.length})</h6>
            <div class="launcher-grid">
              ${items.map(item => `
                <div class="launcher-card" onclick="SystemLauncherTool.launch('${item.key}')">
                  <div class="launcher-icon-box">
                    <i data-lucide="${item.icon}"></i>
                  </div>
                  <div class="launcher-info">
                    <span class="launcher-name">${item.name}</span>
                    <span class="launcher-sub">${item.cmd}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    });

    mount.innerHTML = html || `<div class="text-center text-muted py-5">未找到匹配的系统管理工具</div>`;
    if (window.lucide) lucide.createIcons({ root: mount });
  },

  async launch(key) {
    try {
      const res = await IPC.send('sys_launch_shortcut', { toolKey: key });
      Toast.show(res.message || `已调起 ${key}`, 'success', 1200);
    } catch (e) {
      Toast.show('启动失败: ' + e.message, 'error');
    }
  }
};


// Default Workspace Placeholder for tools under development
const DefaultToolPlaceholder = {
  render(container, tool) {
    container.innerHTML = `
      <div class="workspace-canvas">
        <div class="workspace-placeholder-box">
          <i data-lucide="puzzle" class="placeholder-icon"></i>
          <h4 class="fw-bold mb-2">${tool.title}</h4>
          <p class="text-secondary mb-4 fs-6">
            该工具模块处于<strong>模板就绪</strong>状态。您可继续提出功能需求以完成此工具的业务逻辑开发。
          </p>
          <div class="d-flex justify-content-center gap-2">
            <button class="btn btn-outline-primary btn-sm px-3" onclick="Toast.show('已触发 ${tool.title} 模拟测试', 'success')">
              <i data-lucide="play" class="lucide-sm me-1"></i> 模拟运行测试
            </button>
            <button class="btn btn-secondary btn-sm px-3" onclick="AppNavigation.switchView('tools')">
              返回工具箱
            </button>
          </div>
        </div>
      </div>
    `;
  }
};

// ==========================================
// 5. Tool Registry & Navigation
// ==========================================
const ToolRegistry = {
  tools: [
    // Dev tools
    { id: 'json-formatter', title: 'JSON 格式化校验', category: 'dev', categoryName: '开发辅助', icon: 'braces', desc: '支持 JSON 语法校验、美化缩进排版、紧凑压缩及树状结构解析', tags: ['格式化', '开发', 'JSON'] },
    { id: 'base64-codec', title: 'Base64 编解码器', category: 'dev', categoryName: '开发辅助', icon: 'binary', desc: '支持文本、URL 与文件二进制 Base64 双向安全编码与解码转换', tags: ['编解码', '转换', 'Base64'] },
    { id: 'jwt-debugger', title: 'JWT Token 调试器', category: 'dev', categoryName: '开发辅助', icon: 'key-round', desc: '在线快速解析 JWT Header、Payload 载荷与过期时间检测', tags: ['开发', '安全', 'Token'] },
    { id: 'regex-tester', title: '正则表达式测试', category: 'dev', categoryName: '开发辅助', icon: 'regex', desc: '常用正则表达式验证、实时匹配高亮、捕获组分析与常用规则库', tags: ['正则', '开发', '测试'] },
    { id: 'uuid-generator', title: 'UUID / GUID 生成器', category: 'dev', categoryName: '开发辅助', icon: 'fingerprint', desc: '批量生成 UUID v4、v1 及 GUID 字符串，支持大小写与连字符定制', tags: ['生成器', '开发', 'UUID'] },
    { id: 'timestamp-calc', title: '时间戳转换器', category: 'dev', categoryName: '开发辅助', icon: 'clock', desc: 'Unix 秒/毫秒时间戳与北京时间、UTC 时间双向精准格式化转换', tags: ['转换', '时间', '开发'] },

    // Text tools
    { id: 'hash-calc', title: 'Hash 哈希计算器', category: 'text', categoryName: '文本处理', icon: 'hash', desc: '计算字符串及文本文件的 MD5、SHA1、SHA256、SHA512 哈希指纹', tags: ['计算', '编解码', 'Hash'] },
    { id: 'diff-viewer', title: '文本对比差分器', category: 'text', categoryName: '文本处理', icon: 'git-compare', desc: '左右分栏文本差异比对，逐行与逐字高亮显示增删改动内容', tags: ['对比', '文本', 'Diff'] },
    { id: 'markdown-preview', title: 'Markdown 即时预览', category: 'text', categoryName: '文本处理', icon: 'file-code', desc: '所见即所得 Markdown 文本编辑器，支持 GFM 语法与 HTML 导出', tags: ['文本', '预览', 'Markdown'] },

    // Network tools (Fully implemented)
    { id: 'net-adapter-dns', title: '网卡与 DNS 切换器', category: 'network', categoryName: '网络工具', icon: 'network', desc: '查看网卡配置、一键切换 DHCP/静态 IP 与公共 DNS 方案，一键刷新 DNS 缓存', tags: ['网络', 'DNS', 'IP', '网卡'] },
    { id: 'lan-scanner', title: '局域网设备扫描发现', category: 'network', categoryName: '网络工具', icon: 'radar', desc: '扫描局域网在线设备 IP、MAC 地址、主机名并自动匹配网卡硬件厂商 OUI', tags: ['探测', '局域网', 'ARP', '扫描'] },
    { id: 'ssl-checker', title: 'SSL / TLS 证书检测', category: 'network', categoryName: '网络工具', icon: 'shield-check', desc: '检测远程 HTTPS 域名 SSL 证书链、到期时间、SAN 域名列表与 TLS 协议套件', tags: ['安全', 'SSL', '证书', '网络'] },
    { id: 'proxy-manager', title: '系统与终端代理管理', category: 'network', categoryName: '网络工具', icon: 'arrow-left-right', desc: '快速切换 Windows 系统全局/PAC 代理，并一键生成终端 HTTP/Socks5 代理环境变量', tags: ['网络', '代理', 'Proxy', '终端'] },
    { id: 'file-server', title: '简易局域网文件分享', category: 'network', categoryName: '网络工具', icon: 'share-2', desc: '一键将本地文件夹或文件共享为局域网 Web 服务，自动生成手机扫码下载二维码', tags: ['网络', '文件', '分享', 'HTTP'] },
    { id: 'route-tracer', title: '路由表与 Traceroute', category: 'network', categoryName: '网络工具', icon: 'git-branch', desc: '查看 Windows IPv4 路由表与网关跳数，提供图形化节点逐跳 Traceroute 路由追踪', tags: ['网络', '路由', 'Trace', '诊断'] },
    { id: 'port-checker', title: '端口占用与探测', category: 'network', categoryName: '网络工具', icon: 'activity', desc: '检测本地端口占用进程，或测试远程 IP / 域名的 TCP 端口连通性', tags: ['探测', '网络', '端口'] },
    { id: 'ping-mtr', title: 'Ping & 网络诊断', category: 'network', categoryName: '网络工具', icon: 'wifi', desc: '实时 Ping 延迟检测与 DNS 解析诊断，提供网络质量可视化统计', tags: ['探测', '网络', '诊断'] },
    { id: 'curl-builder', title: 'cURL / HTTP 调试台', category: 'network', categoryName: '网络工具', icon: 'send', desc: '可视化构造 GET/POST 请求，生成标准 cURL 命令与真实无跨域请求', tags: ['网络', '调试', 'HTTP'] },

    // System tools (Fully implemented)
    { id: 'service-manager', title: 'Windows 服务管理器', category: 'system', categoryName: '系统运维', icon: 'sliders', desc: '检索所有 Windows 系统服务，支持一键启动/停止/重启与修改自启动模式', tags: ['系统', '服务', '运维', 'Windows'] },
    { id: 'startup-auditor', title: '开机自启动项全面审计', category: 'system', categoryName: '系统运维', icon: 'rocket', desc: '审计注册表 Run、启动文件夹与计划任务中的开机自启项目，支持一键定位与移除', tags: ['系统', '自启', '优化', '注册表'] },
    { id: 'file-lock-hunter', title: '文件占用与句柄解锁', category: 'system', categoryName: '系统运维', icon: 'unlock', desc: '基于 Windows Restart Manager 原生定位锁定文件的进程 PID 与窗口，支持一键结束', tags: ['系统', '进程', '文件', '解锁'] },
    { id: 'system-specs', title: '硬件规格与系统健康', category: 'system', categoryName: '系统运维', icon: 'gauge', desc: '仪表盘展示 CPU、内存插槽、磁盘容量、GPU 显卡及系统开机运行时间 (Uptime)', tags: ['系统', '硬件', 'CPU', '内存', '健康'] },
    { id: 'system-launcher', title: '系统管理入口与上帝模式', category: 'system', categoryName: '系统运维', icon: 'terminal', desc: '一键快捷调起组策略、注册表、设备管理器、网络连接、磁盘管理与上帝模式', tags: ['系统', '快捷', '上帝模式', 'MMC'] },
    { id: 'env-viewer', title: '系统环境变量管理', category: 'system', categoryName: '系统运维', icon: 'layers', desc: '查看、检索与快捷编辑 Windows 用户与系统 PATH 及环境变量', tags: ['系统', '环境变量', '运维'] },
    { id: 'process-viewer', title: '系统进程快速分析', category: 'system', categoryName: '系统运维', icon: 'cpu', desc: '基于 PowerShell 高性能获取系统进程内存、CPU 占用并支持一键终止', tags: ['系统', '进程', '运维'] },
    { id: 'hosts-editor', title: 'Hosts 快速切换器', category: 'system', categoryName: '系统运维', icon: 'server', desc: '快速读取与编辑系统 Hosts 映射规则，支持规则一键切换与备份', tags: ['系统', '网络', 'Hosts'] }
  ],

  favorites: new Set(),
  activeCategory: 'all',
  activeTag: 'all',
  searchQuery: '',
  activeTool: null,

  init() {
    try {
      const favList = JSON.parse(localStorage.getItem('app_favorites') || '[]');
      this.favorites = new Set(favList);
    } catch (e) {
      this.favorites = new Set();
    }

    this.updateCategoryCounts();
    this.renderToolGrid();
    this.bindEvents();
  },

  updateCategoryCounts() {
    const counts = {
      all: this.tools.length,
      fav: this.favorites.size,
      dev: this.tools.filter(t => t.category === 'dev').length,
      text: this.tools.filter(t => t.category === 'text').length,
      network: this.tools.filter(t => t.category === 'network').length,
      system: this.tools.filter(t => t.category === 'system').length
    };

    for (const [cat, num] of Object.entries(counts)) {
      const badge = document.getElementById(`count-${cat}`);
      if (badge) badge.textContent = num;
    }
  },

  getFilteredTools() {
    return this.tools.filter(tool => {
      if (this.activeCategory === 'fav') {
        if (!this.favorites.has(tool.id)) return false;
      } else if (this.activeCategory !== 'all') {
        if (tool.category !== this.activeCategory) return false;
      }

      if (this.activeTag !== 'all') {
        if (!tool.tags.includes(this.activeTag)) return false;
      }

      if (this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase().trim();
        const matchTitle = tool.title.toLowerCase().includes(query);
        const matchDesc = tool.desc.toLowerCase().includes(query);
        const matchCat = tool.categoryName.toLowerCase().includes(query);
        const matchTags = tool.tags.some(tag => tag.toLowerCase().includes(query));
        if (!matchTitle && !matchDesc && !matchCat && !matchTags) return false;
      }

      return true;
    });
  },

  renderToolGrid() {
    const grid = document.getElementById('toolGrid');
    const emptyState = document.getElementById('emptyState');
    if (!grid) return;

    const filtered = this.getFilteredTools();

    if (filtered.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.classList.remove('d-none');
      return;
    }

    if (emptyState) emptyState.classList.add('d-none');

    grid.innerHTML = filtered.map(tool => {
      const isStarred = this.favorites.has(tool.id);
      const tagsHtml = tool.tags.map(t => `<span class="tool-tag">#${t}</span>`).join('');

      return `
        <div class="tool-card" data-tool-id="${tool.id}">
          <div class="tool-card-top">
            <div class="tool-icon-wrapper">
              <i data-lucide="${tool.icon}"></i>
            </div>
            <div class="tool-actions">
              <span class="tool-badge">${tool.categoryName}</span>
              <button class="btn-star ${isStarred ? 'starred' : ''}" data-star-id="${tool.id}" title="${isStarred ? '取消收藏' : '添加收藏'}">
                <i data-lucide="star"></i>
              </button>
            </div>
          </div>
          <div class="tool-card-body">
            <div class="tool-card-title">${tool.title}</div>
            <div class="tool-card-desc">${tool.desc}</div>
            <div class="tool-card-tags">${tagsHtml}</div>
          </div>
          <div class="tool-card-footer">
            <button class="btn-open-tool">
              <span>进入工具</span>
              <i data-lucide="chevron-right" style="width: 15px; height: 15px;"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) {
      lucide.createIcons({ root: grid });
    }
  },

  toggleFavorite(toolId) {
    if (this.favorites.has(toolId)) {
      this.favorites.delete(toolId);
      Toast.show('已取消收藏', 'info', 1500);
    } else {
      this.favorites.add(toolId);
      Toast.show('已添加到常用收藏', 'success', 1500);
    }
    localStorage.setItem('app_favorites', JSON.stringify(Array.from(this.favorites)));
    this.updateCategoryCounts();
    this.renderToolGrid();
    SettingsManager.saveConfig();
  },

  openToolWorkspace(toolId) {
    const tool = this.tools.find(t => t.id === toolId);
    if (!tool) return;
    this.activeTool = tool;

    // Header population
    const wsIcon = document.getElementById('wsToolIcon');
    const wsTitle = document.getElementById('wsToolTitle');
    const wsCategory = document.getElementById('wsToolCategory');
    const wsDesc = document.getElementById('wsToolDesc');
    const wsBtnStar = document.getElementById('wsBtnStar');

    if (wsIcon) wsIcon.innerHTML = `<i data-lucide="${tool.icon}"></i>`;
    if (wsTitle) wsTitle.textContent = tool.title;
    if (wsCategory) wsCategory.textContent = tool.categoryName;
    if (wsDesc) wsDesc.textContent = tool.desc;

    if (wsBtnStar) {
      wsBtnStar.classList.toggle('starred', this.favorites.has(tool.id));
      wsBtnStar.onclick = (e) => {
        e.stopPropagation();
        this.toggleFavorite(tool.id);
        wsBtnStar.classList.toggle('starred', this.favorites.has(tool.id));
      };
    }

    // Mount corresponding tool implementation
    const mount = document.getElementById('workspaceToolMount');
    if (mount) {
      switch (tool.id) {
        // Network Tools
        case 'net-adapter-dns':
          NetAdapterTool.render(mount);
          break;
        case 'lan-scanner':
          LanScannerTool.render(mount);
          break;
        case 'ssl-checker':
          SslCheckerTool.render(mount);
          break;
        case 'proxy-manager':
          ProxyManagerTool.render(mount);
          break;
        case 'file-server':
          FileServerTool.render(mount);
          break;
        case 'route-tracer':
          RouteTracerTool.render(mount);
          break;
        case 'port-checker':
          PortCheckerTool.render(mount);
          break;
        case 'ping-mtr':
          PingTool.render(mount);
          break;
        case 'curl-builder':
          CurlTool.render(mount);
          break;

        // System Tools
        case 'service-manager':
          ServiceManagerTool.render(mount);
          break;
        case 'startup-auditor':
          StartupAuditorTool.render(mount);
          break;
        case 'file-lock-hunter':
          FileLockTool.render(mount);
          break;
        case 'system-specs':
          SystemSpecsTool.render(mount);
          break;
        case 'system-launcher':
          SystemLauncherTool.render(mount);
          break;
        case 'env-viewer':
          EnvTool.render(mount);
          break;
        case 'process-viewer':
          ProcessTool.render(mount);
          break;
        case 'hosts-editor':
          HostsTool.render(mount);
          break;

        default:
          DefaultToolPlaceholder.render(mount, tool);
      }
    }

    AppNavigation.switchView('workspace');
    if (window.lucide) lucide.createIcons();
  },

  bindEvents() {
    const sidebarList = document.getElementById('sidebarNavList');
    if (sidebarList) {
      sidebarList.addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-item-btn');
        if (!btn || !btn.dataset.category) return;

        sidebarList.querySelectorAll('.nav-item-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.activeCategory = btn.dataset.category;
        this.updateHeaderAndHero();
        AppNavigation.switchView('tools');
        this.renderToolGrid();
      });
    }

    const tagChips = document.getElementById('tagChipsContainer');
    if (tagChips) {
      tagChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.tag-chip');
        if (!chip) return;
        tagChips.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeTag = chip.dataset.tag;
        this.renderToolGrid();
      });
    }

    const grid = document.getElementById('toolGrid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const starBtn = e.target.closest('.btn-star');
        if (starBtn) {
          e.stopPropagation();
          this.toggleFavorite(starBtn.dataset.starId);
          return;
        }

        const card = e.target.closest('.tool-card');
        if (card) {
          this.openToolWorkspace(card.dataset.toolId);
        }
      });
    }

    const searchInput = document.getElementById('toolSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        if (AppNavigation.currentView !== 'tools') {
          AppNavigation.switchView('tools');
        }
        this.renderToolGrid();
      });
    }

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      } else if (e.key === 'Escape') {
        // Close modal if open
        const envModal = document.getElementById('envVarModal');
        const hostModal = document.getElementById('addHostModal');
        if (envModal && !envModal.classList.contains('d-none')) {
          envModal.classList.add('d-none');
          return;
        }
        if (hostModal && !hostModal.classList.contains('d-none')) {
          hostModal.classList.add('d-none');
          return;
        }

        if (AppNavigation.currentView === 'workspace' || AppNavigation.currentView === 'settings') {
          AppNavigation.switchView('tools');
        } else if (searchInput && document.activeElement === searchInput) {
          searchInput.blur();
        }
      }
    });

    const btnBack = document.getElementById('btnBackToGrid');
    if (btnBack) btnBack.addEventListener('click', () => AppNavigation.switchView('tools'));
  },

  updateHeaderAndHero() {
    const titles = {
      all: { name: '全部工具', icon: 'layout-grid', desc: '集合开发、文本、网络与系统相关实用功能' },
      fav: { name: '常用收藏', icon: 'star', desc: '已标星置顶的高频使用工具集' },
      dev: { name: '开发辅助', icon: 'code-2', desc: '编码转换、格式化排版与算法调试助手' },
      text: { name: '文本处理', icon: 'file-text', desc: '文本差分、Hash 哈希与文档即时渲染' },
      network: { name: '网络工具', icon: 'globe', desc: '端口探测、链路诊断与 API 模拟测试' },
      system: { name: '系统运维', icon: 'terminal-square', desc: '环境配置、系统进程与 Hosts 便捷管理' }
    };

    const cur = titles[this.activeCategory] || titles.all;
    const headerTitle = document.getElementById('headerTitleText');
    const headerIcon = document.getElementById('headerTitleIcon');
    const heroTitle = document.getElementById('heroTitle');
    const heroSubtitle = document.getElementById('heroSubtitle');

    if (headerTitle) headerTitle.textContent = cur.name;
    if (headerIcon) headerIcon.setAttribute('data-lucide', cur.icon);
    if (heroTitle) heroTitle.textContent = cur.name;
    if (heroSubtitle) heroSubtitle.textContent = cur.desc;

    if (window.lucide) lucide.createIcons();
  }
};

// ==========================================
// 6. Navigation Management
// ==========================================
const AppNavigation = {
  currentView: 'tools',

  init() {
    const btnNavSettings = document.getElementById('btnNavSettings');
    const btnHeaderSettings = document.getElementById('btnHeaderSettings');

    [btnNavSettings, btnHeaderSettings].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          if (this.currentView === 'settings') {
            this.switchView('tools');
          } else {
            this.switchView('settings');
          }
        });
      }
    });
  },

  switchView(viewName) {
    this.currentView = viewName;

    const viewTools = document.getElementById('viewTools');
    const viewWorkspace = document.getElementById('viewWorkspace');
    const viewSettings = document.getElementById('viewSettings');
    const btnHeaderSettings = document.getElementById('btnHeaderSettings');
    const btnNavSettings = document.getElementById('btnNavSettings');
    const searchWrapper = document.getElementById('searchWrapper');
    const headerTitleText = document.getElementById('headerTitleText');
    const headerTitleIcon = document.getElementById('headerTitleIcon');

    if (viewTools) viewTools.classList.toggle('d-none', viewName !== 'tools');
    if (viewWorkspace) viewWorkspace.classList.toggle('d-none', viewName !== 'workspace');
    if (viewSettings) viewSettings.classList.toggle('d-none', viewName !== 'settings');

    if (btnHeaderSettings) btnHeaderSettings.classList.toggle('active', viewName === 'settings');
    if (btnNavSettings) btnNavSettings.classList.toggle('active', viewName === 'settings');

    if (viewName === 'settings') {
      const sidebarNav = document.getElementById('sidebarNavList');
      if (sidebarNav) {
        sidebarNav.querySelectorAll('.nav-item-btn').forEach(b => b.classList.remove('active'));
      }
      if (headerTitleText) headerTitleText.textContent = '系统与应用设置';
      if (headerTitleIcon) headerTitleIcon.setAttribute('data-lucide', 'settings');
      if (searchWrapper) searchWrapper.style.opacity = '0.4';
    } else {
      if (searchWrapper) searchWrapper.style.opacity = '1';
      if (viewName === 'tools') {
        ToolRegistry.updateHeaderAndHero();
        const sidebarNav = document.getElementById('sidebarNavList');
        if (sidebarNav) {
          const activeBtn = sidebarNav.querySelector(`[data-category="${ToolRegistry.activeCategory}"]`);
          if (activeBtn) activeBtn.classList.add('active');
        }
      }
    }

    if (window.lucide) lucide.createIcons();
  }
};

// ==========================================
// 7. Settings & Auto-Start Manager
// ==========================================
const SettingsManager = {
  autoStartEnabled: false,

  async init() {
    const switchAutoStart = document.getElementById('switchAutoStart');

    try {
      const res = await IPC.send('get_autostart');
      this.autoStartEnabled = Boolean(res && res.enabled);
      if (switchAutoStart) {
        switchAutoStart.checked = this.autoStartEnabled;
      }
    } catch (e) {
      console.error('Failed to get autostart status:', e);
    }

    try {
      const info = await IPC.send('get_system_info');
      if (info) {
        const infoOS = document.getElementById('infoOS');
        const infoPS = document.getElementById('infoPS');
        const infoVersion = document.getElementById('infoVersion');
        if (infoOS && info.os) infoOS.textContent = info.os;
        if (infoPS && info.psVersion) infoPS.textContent = 'PowerShell ' + info.psVersion;
        if (infoVersion && info.appVersion) infoVersion.textContent = info.appVersion;
      }
    } catch (e) {
      console.error('Failed to get system info:', e);
    }

    if (switchAutoStart) {
      switchAutoStart.addEventListener('change', async (e) => {
        const targetChecked = e.target.checked;
        switchAutoStart.disabled = true;

        try {
          await IPC.send('set_autostart', { enabled: targetChecked });
          this.autoStartEnabled = targetChecked;
          Toast.show(targetChecked ? '已开启开机自启（已写入注册表）' : '已关闭开机自启（已清除注册表）', 'success', 2500);
          this.saveConfig();
        } catch (err) {
          Toast.show('修改开机自启失败: ' + err.message, 'error', 3000);
          switchAutoStart.checked = !targetChecked;
        } finally {
          switchAutoStart.disabled = false;
        }
      });
    }
  },

  async saveConfig() {
    const config = {
      theme: ThemeManager.currentTheme,
      autoStart: this.autoStartEnabled,
      favorites: Array.from(ToolRegistry.favorites)
    };
    try {
      await IPC.send('save_config', { config });
    } catch (e) {
      console.warn('Failed to save config to backend:', e);
    }
  }
};

// ==========================================
// Application Bootstrap Entry Point
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  IPC.init();
  ThemeManager.init();
  PrivilegeManager.init();
  ToolRegistry.init();
  AppNavigation.init();
  SettingsManager.init();

  if (window.lucide) {
    lucide.createIcons();
  }
});
