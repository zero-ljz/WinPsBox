/**
 * WinPsBox - Lightweight Desktop Toolbox
 * Modules: IPC Bridge, ThemeManager, ToolRegistry, Tool Workspace Renderers, SettingsManager, Toast
 */

// ==========================================
// 1. IPC Communication Bridge
// ==========================================
const IPC = {
  callbacks: new Map(),
  mockTasks: new Map(),
  mockTcpSessions: new Map(),
  mockPortProxyRules: [
    { listenAddress: '0.0.0.0', listenPort: 13389, connectAddress: '172.31.220.80', connectPort: 3389 }
  ],
  reqCounter: 0,
  isWebView: Boolean(window.chrome && window.chrome.webview),
  backgroundActions: new Set([
    'net_check_remote_port', 'net_ping', 'remote_test_profile', 'net_dns_deep_diagnostic', 'net_intel_lookup',
    'diag_run', 'ssh_get_status', 'ssh_install_capability', 'wsl_get_status',
    'wsl_get_online', 'net_get_portproxy_targets', 'net_scan_lan', 'net_check_ssl',
    'net_trace_route', 'net_wifi_analyze', 'net_http_redirect_trace'
  ]),

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
        if (!msg || !msg.id || !this.callbacks.has(msg.id)) return;

        const callback = this.callbacks.get(msg.id);
        if (msg.event === 'started' || msg.event === 'progress') {
          callback.started = true;
          callback.taskId = msg.taskId || msg.id;
          const progress = msg.progress || {};
          if (typeof callback.onProgress === 'function') callback.onProgress(progress);
          if (window.TaskActivity) {
            if (msg.event === 'started') window.TaskActivity.start(callback.taskId, callback.action, progress);
            else window.TaskActivity.update(callback.taskId, progress);
          }
          return;
        }

        this.callbacks.delete(msg.id);
        clearTimeout(callback.timeoutId);
        if (callback.started && window.TaskActivity) {
          window.TaskActivity.finish(callback.taskId || msg.id, Boolean(msg.success), Boolean(msg.cancelled));
        }
        if (msg.success) {
          callback.resolve(msg.data);
        } else {
          const error = new Error(msg.error || 'IPC call failed');
          error.cancelled = Boolean(msg.cancelled);
          error.data = msg.data || null;
          error.needsAdmin = Boolean(msg.data && msg.data.needsAdmin);
          callback.reject(error);
        }
      });
    } else {
      console.warn('Running outside WebView2. Using mock handlers for standalone browser preview.');
    }
  },

  isBackgroundAction(action) {
    return action.startsWith('winget_') || this.backgroundActions.has(action);
  },

  getTimeoutMs(action, payload = {}, options = {}) {
    const requestedTimeout = Number(options.requestTimeoutMs);
    if (Number.isFinite(requestedTimeout) && requestedTimeout > 0) {
      return Math.max(1000, requestedTimeout);
    }

    if (action === 'winget_batch_action') {
      const packageCount = Math.max(1, Number(payload.packageIds?.length || 0));
      return Math.max(15 * 60 * 1000, Math.min(packageCount * 3 * 60 * 1000, 2 * 60 * 60 * 1000));
    }
    if (action === 'winget_package_action') return 30 * 60 * 1000;
    if (action === 'winget_get_packages' || action === 'winget_search') return 5 * 60 * 1000;
    if (action === 'winget_get_status') return 2 * 60 * 1000;
    if (action === 'ssh_install_capability') return 30 * 60 * 1000;
    if (action === 'net_dns_deep_diagnostic') return 3 * 60 * 1000;
    if (action === 'net_intel_lookup' || action === 'diag_run') return 2 * 60 * 1000;
    if (action === 'net_ping') {
      const count = Math.max(1, Number(payload.count) || 4);
      const operationTimeout = Math.max(250, Number(payload.timeoutMs) || 2000);
      return Math.min(5 * 60 * 1000, Math.max(60 * 1000, count * operationTimeout + 30 * 1000));
    }
    if (action === 'net_trace_route') {
      const maxHops = Math.max(1, Number(payload.maxHops) || 20);
      const operationTimeout = Math.max(250, Number(payload.timeoutMs) || 1500);
      return Math.min(10 * 60 * 1000, Math.max(90 * 1000, maxHops * operationTimeout + 30 * 1000));
    }
    if (action === 'net_check_ssl') return 30 * 1000;
    if (action === 'net_wifi_analyze') return 60 * 1000;
    if (action === 'net_http_redirect_trace') {
      const redirects = Math.max(1, Math.min(20, Number(payload.maxRedirects) || 10));
      const operationTimeout = Math.max(1000, Math.min(30000, Number(payload.timeoutMs) || 10000));
      return Math.min(10 * 60 * 1000, Math.max(90 * 1000, (redirects + 1) * operationTimeout + 30 * 1000));
    }
    if (this.isBackgroundAction(action)) return 2 * 60 * 1000;
    if (action.startsWith('cert_') || action === 'sys_elevate_app' || action === 'smb_operate') return 5 * 60 * 1000;
    if (action.startsWith('sys_set_') || action === 'sys_save_hosts' || action.startsWith('net_set_') || action.startsWith('net_add_') || action.startsWith('net_remove_')) {
      return 2 * 60 * 1000;
    }
    return 30 * 1000;
  },

  send(action, payload = {}, options = {}) {
    const id = 'req_' + (++this.reqCounter) + '_' + Date.now();
    const promise = new Promise((resolve, reject) => {
      if (!this.isWebView) {
        const isBackground = this.isBackgroundAction(action);
        const finishMock = (success, value) => {
          this.mockTasks.delete(id);
          if (isBackground && window.TaskActivity) window.TaskActivity.finish(id, success, false);
          if (success) resolve(value);
          else reject(value);
        };
        if (isBackground && window.TaskActivity) {
          window.TaskActivity.start(id, action, { percent: 5, message: '正在准备模拟任务', detail: '' });
        }
        const timer = this.mockHandle(
          action,
          payload,
          value => finishMock(true, value),
          error => finishMock(false, error),
          options
        );
        if (isBackground) this.mockTasks.set(id, { timer, reject });
        return;
      }

      const callback = {
        resolve,
        reject,
        action,
        onProgress: options.onProgress,
        started: false,
        taskId: id,
        timeoutId: null
      };
      this.callbacks.set(id, callback);
      try {
        window.chrome.webview.postMessage({ id, action, payload });
      } catch (error) {
        this.callbacks.delete(id);
        reject(error);
        return;
      }

      const timeoutMs = this.getTimeoutMs(action, payload, options);
      callback.timeoutId = setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          if (callback.started) {
            if (window.TaskActivity) window.TaskActivity.finish(callback.taskId, false, false);
            this.cancel(callback.taskId).catch(() => {});
          }
          reject(new Error(`IPC Timeout for action: ${action}`));
        }
      }, timeoutMs);
    });

    promise.requestId = id;
    promise.cancel = () => this.cancel(id);
    return promise;
  },

  cancel(taskId) {
    if (!taskId) return Promise.reject(new Error('Task ID is required.'));
    if (!this.isWebView) {
      const task = this.mockTasks.get(taskId);
      if (!task) return Promise.resolve({ success: false, taskId });
      clearTimeout(task.timer);
      this.mockTasks.delete(taskId);
      const error = new Error('任务已取消。');
      error.cancelled = true;
      task.reject(error);
      if (window.TaskActivity) window.TaskActivity.finish(taskId, false, true);
      return Promise.resolve({ success: true, taskId });
    }
    return this.send('task_cancel', { taskId });
  },

  mockHandle(action, payload, resolve, reject, options = {}) {
    if (this.isBackgroundAction(action) && typeof options.onProgress === 'function') {
      options.onProgress({ percent: 25, message: '正在处理', detail: '' });
    }
    return setTimeout(() => {
      switch (action) {
        case 'task_cancel':
          resolve({ success: true, taskId: payload.taskId });
          break;
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

        case 'remote_get_profiles':
          resolve(JSON.parse(localStorage.getItem('mock_remote_profiles') || '[]'));
          break;
        case 'remote_save_profile': {
          const profiles = JSON.parse(localStorage.getItem('mock_remote_profiles') || '[]');
          const profile = { ...payload.profile, id: payload.profile.id || crypto.randomUUID(), updatedAt: new Date().toISOString() };
          localStorage.setItem('mock_remote_profiles', JSON.stringify([...profiles.filter(item => item.id !== profile.id), profile]));
          resolve({ success: true, profile });
          break;
        }
        case 'remote_remove_profile': {
          const profiles = JSON.parse(localStorage.getItem('mock_remote_profiles') || '[]');
          localStorage.setItem('mock_remote_profiles', JSON.stringify(profiles.filter(item => item.id !== payload.id)));
          resolve({ success: true, id: payload.id });
          break;
        }
        case 'remote_test_profile':
          resolve({ success: true, reachable: true, host: payload.profile.host, port: payload.profile.port, addresses: ['192.168.1.20'], latencyMs: 12.4 });
          break;
        case 'remote_open_profile':
          resolve({ success: true, launched: true, type: payload.profile.type, target: payload.profile.type === 'smb' ? `\\\\${payload.profile.host}\\${payload.profile.shareName}` : `${payload.profile.host}:${payload.profile.port}` });
          break;
        case 'smb_get_state':
          resolve({
            available: true, isAdmin: false, computerName: 'DEV-WORKSTATION', currentUser: 'WORKGROUP\\DevUser', sessionError: '', openFileError: '',
            shares: [
              { name: 'Projects', path: 'D:\\Projects', description: '开发项目', currentUsers: 1, special: false, uncPath: '\\\\DEV-WORKSTATION\\Projects', access: [{ accountName: 'WORKGROUP\\DevUser', accessControlType: 'Allow', accessRight: 'Full' }] },
              { name: 'C$', path: 'C:\\', description: '默认共享', currentUsers: 0, special: true, uncPath: '\\\\DEV-WORKSTATION\\C$', access: [] }
            ],
            sessions: [{ sessionId: '101', clientComputerName: '192.168.1.30', clientUserName: 'WORKGROUP\\User', numOpens: 1, secondsIdle: 42 }],
            openFiles: [{ fileId: '201', sessionId: '101', clientComputerName: '192.168.1.30', clientUserName: 'WORKGROUP\\User', path: 'D:\\Projects\\README.md', shareRelativePath: 'README.md', locks: 0 }]
          });
          break;
        case 'smb_operate':
          resolve({ success: true, message: '模拟 SMB 操作已完成' });
          break;
        case 'smb_select_folder':
          resolve({ success: true, cancelled: false, path: 'D:\\Projects' });
          break;
        case 'smb_open_location':
          resolve({ success: true, path: payload.path });
          break;

        case 'diag_run': {
          const checks = [
            { id: 'system', name: 'Windows system', status: 'pass', summary: 'Windows 11 Pro build 26100', detail: 'Uptime: 3d 8h; PowerShell: 5.1; Admin: False' },
            { id: 'disk', name: 'System drive', status: 'pass', summary: '186.4 GB free of 476.8 GB', detail: '39.1% available on C:' },
            { id: 'adapter', name: 'Network adapters', status: 'pass', summary: '1 connected adapter(s)', detail: 'Ethernet: 192.168.1.108' },
            { id: 'route', name: 'Default route', status: 'pass', summary: 'Gateway 192.168.1.1', detail: 'Interface: Ethernet; metric: 25' },
            { id: 'dns', name: 'DNS resolution', status: 'pass', summary: `${payload.target || 'www.microsoft.com'} resolved`, detail: '23.46.120.12, 2600:140b:2::17d8:1198' },
            { id: 'ping', name: 'Network reachability', status: 'warn', summary: 'Ping status: TimedOut', detail: 'ICMP may be blocked even when the target is reachable.' },
            { id: 'proxy', name: 'Windows proxy', status: 'pass', summary: 'Direct connection', detail: 'No PAC URL configured' },
            { id: 'services', name: 'Core services', status: 'pass', summary: 'Windows network services checked', detail: 'Dnscache=Running; Dhcp=Running; W32Time=Running' },
            { id: 'reboot', name: 'Pending reboot', status: 'pass', summary: 'No restart marker found', detail: '' }
          ];
          resolve({
            generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }), computerName: 'DEV-WORKSTATION',
            target: payload.target || 'www.microsoft.com', durationMs: 438,
            summary: { pass: 8, warn: 1, error: 0, total: 9 }, checks
          });
          break;
        }
        case 'diag_export':
          resolve({ success: true, filePath: `C:\\WinPsBox\\data\\reports\\WinPsBox-Diagnostic-demo.${payload.format === 'json' ? 'json' : 'md'}`, folder: 'C:\\WinPsBox\\data\\reports' });
          break;
        case 'ssh_get_status':
          resolve({
            clientState: 'Installed', serverState: 'NotPresent', sshAvailable: true, keygenAvailable: true,
            sshPath: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe', serviceInstalled: false,
            serviceStatus: 'NotInstalled', serviceStartType: '', sshFolder: 'C:\\Users\\DevUser\\.ssh', isAdmin: false,
            keys: [
              { name: 'id_ed25519', publicPath: 'C:\\Users\\DevUser\\.ssh\\id_ed25519.pub', privateExists: true, fingerprint: '256 SHA256:7wM8QqZb4Q3jslLcN9h5fMkrJh3A8zYp dev@workstation (ED25519)', modifiedAt: '2026-08-18 09:21:04' },
              { name: 'work_gitlab', publicPath: 'C:\\Users\\DevUser\\.ssh\\work_gitlab.pub', privateExists: true, fingerprint: '256 SHA256:E4BhvH9Gm2p8NaJX0khRtP2w4kfeM8zs dev@workstation (ED25519)', modifiedAt: '2026-07-02 15:44:28' }
            ]
          });
          break;
        case 'ssh_install_capability':
          resolve({ success: true, state: 'Installed', restartNeeded: false });
          break;
        case 'ssh_service_action':
          resolve({ success: true, status: payload.serviceAction === 'stop' ? 'Stopped' : 'Running', startType: 'Automatic' });
          break;
        case 'ssh_generate_key':
          resolve({ success: true, publicPath: `C:\\Users\\DevUser\\.ssh\\${payload.keyName}.pub`, fingerprint: '256 SHA256:MockGeneratedFingerprint' });
          break;
        case 'ssh_read_public_key':
          resolve({ success: true, content: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockPublicKey ${payload.keyName}@WinPsBox`, path: `C:\\Users\\DevUser\\.ssh\\${payload.keyName}.pub` });
          break;
        case 'ssh_test_endpoint':
          resolve({ success: true, reachable: true, latencyMs: 18.6, effective: { hostname: payload.host, user: payload.user || 'git', port: String(payload.port || 22), identityfile: '~/.ssh/id_ed25519' } });
          break;
        case 'ssh_open_folder':
          resolve({ success: true, path: 'C:\\Users\\DevUser\\.ssh' });
          break;
        case 'wsl_get_status':
          resolve({
            installed: true, executable: 'C:\\Windows\\System32\\wsl.exe', defaultVersion: 2, virtualization: true, isAdmin: false,
            distros: [
              { id: 'ubuntu-id', name: 'Ubuntu-24.04', version: 2, state: 'Running', isDefault: true, basePath: 'C:\\Users\\DevUser\\AppData\\Local\\Packages\\Ubuntu\\LocalState' },
              { id: 'debian-id', name: 'Debian', version: 2, state: 'Stopped', isDefault: false, basePath: 'D:\\WSL\\Debian' }
            ]
          });
          break;
        case 'wsl_action':
          resolve({ success: true, launched: ['open', 'update', 'install'].includes(payload.wslAction) });
          break;
        case 'wsl_get_online':
          resolve({ success: true, items: [
            { name: 'Ubuntu-24.04', friendlyName: 'Ubuntu 24.04 LTS' },
            { name: 'Debian', friendlyName: 'Debian GNU/Linux' },
            { name: 'kali-linux', friendlyName: 'Kali Linux Rolling' },
            { name: 'openSUSE-Tumbleweed', friendlyName: 'openSUSE Tumbleweed' }
          ] });
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
        case 'net_tcp_connect': {
          const sessionId = `mock_tcp_${Date.now()}`;
          this.mockTcpSessions.set(sessionId, []);
          resolve({
            success: true,
            sessionId,
            localEndpoint: '127.0.0.1:51820',
            remoteEndpoint: `${payload.host}:${payload.port}`,
            connectedAt: new Date().toISOString()
          });
          break;
        }
        case 'net_tcp_send': {
          const queue = this.mockTcpSessions.get(payload.sessionId);
          if (!queue) {
            reject(new Error('TCP session was not found.'));
            break;
          }
          queue.push(payload.dataBase64 || '');
          resolve({ success: true, bytes: atob(payload.dataBase64 || '').length });
          break;
        }
        case 'net_tcp_receive': {
          const queue = this.mockTcpSessions.get(payload.sessionId);
          if (!queue) {
            resolve({ success: true, connected: false, closed: true, bytes: 0, dataBase64: '' });
            break;
          }
          const dataBase64 = queue.shift() || '';
          resolve({ success: true, connected: true, closed: false, bytes: dataBase64 ? atob(dataBase64).length : 0, dataBase64 });
          break;
        }
        case 'net_tcp_disconnect':
          this.mockTcpSessions.delete(payload.sessionId);
          resolve({ success: true, connected: false });
          break;
        case 'cert_get_defaults':
          resolve({
            computerName: 'DEV-WORKSTATION',
            sans: ['localhost', '127.0.0.1', '::1', 'dev-workstation', '192.168.1.108'],
            outputDirectory: 'C:\\WinPsBox\\data\\certificates'
          });
          break;
        case 'cert_get_ca_status': {
          const exists = localStorage.getItem('mock_ca_exists') === 'true';
          resolve({
            exists,
            subject: 'CN=WinPsBox Local Root CA',
            thumbprint: exists ? '8F42C1A07E54D56D2D408A925F97C40A21B90077' : '',
            validFrom: exists ? '2026-08-18 19:40:00' : '',
            validTo: exists ? '2036-08-18 19:40:00' : '',
            trustedCurrentUser: exists,
            trustedLocalMachine: false,
            outputDirectory: 'C:\\WinPsBox\\data\\certificates',
            isAdmin: false
          });
          break;
        }
        case 'cert_create_root_ca': {
          localStorage.setItem('mock_ca_exists', 'true');
          resolve({
            success: true,
            trustScope: payload.trustScope,
            cerPath: 'C:\\WinPsBox\\data\\certificates\\winpsbox-local-root-ca.cer',
            pemPath: 'C:\\WinPsBox\\data\\certificates\\winpsbox-local-root-ca.pem',
            status: {
              exists: true,
              subject: 'CN=WinPsBox Local Root CA',
              thumbprint: '8F42C1A07E54D56D2D408A925F97C40A21B90077',
              validFrom: '2026-08-18 19:40:00',
              validTo: '2036-08-18 19:40:00',
              trustedCurrentUser: payload.trustScope !== 'LocalMachine',
              trustedLocalMachine: payload.trustScope === 'LocalMachine',
              outputDirectory: 'C:\\WinPsBox\\data\\certificates',
              isAdmin: false
            }
          });
          break;
        }
        case 'cert_generate_server': {
          const commonName = payload.commonName || 'localhost';
          const folder = `C:\\WinPsBox\\data\\certificates\\${commonName}-20260818-194200`;
          resolve({
            success: true,
            commonName,
            thumbprint: '73F7B850B2A36C624E024FE4541EA68AE51ECF09',
            issuer: 'CN=WinPsBox Local Root CA',
            validFrom: '2026-08-18 19:42:00',
            validTo: '2027-09-20 19:42:00',
            sans: (payload.sans || []).map(value => ({ type: /^\d|:/.test(value) ? 'IP' : 'DNS', value })),
            folder,
            pfxPath: `${folder}\\${commonName}.pfx`,
            cerPath: `${folder}\\${commonName}.cer`,
            pemPath: `${folder}\\${commonName}.pem`,
            chainPath: `${folder}\\${commonName}-chain.pem`
          });
          break;
        }
        case 'cert_open_folder':
          resolve({ success: true, path: payload.path });
          break;
        case 'net_dns_deep_diagnostic':
          resolve({
            success: true,
            name: payload.name || 'example.com',
            recordType: payload.recordType || 'A',
            records: [
              { name: payload.name || 'example.com', type: 'A', ttl: 248, section: 'Answer', value: '104.20.34.220' },
              { name: payload.name || 'example.com', type: 'A', ttl: 248, section: 'Answer', value: '172.66.144.113' },
              { name: payload.name || 'example.com', type: 'AAAA', ttl: 248, section: 'Answer', value: '2606:4700:10::6814:22dc' },
              { name: payload.name || 'example.com', type: 'MX', ttl: 3600, section: 'Answer', value: '10 mail.example.com' },
              { name: payload.name || 'example.com', type: 'TXT', ttl: 3600, section: 'Answer', value: 'v=spf1 -all' }
            ],
            recordErrors: [],
            comparison: {
              mismatch: false,
              consensusAnswers: ['104.20.34.220', '172.66.144.113'],
              consensusCount: 4,
              respondingCount: 4,
              providers: [
                { name: '114 DNS', server: '114.114.114.114', success: true, latencyMs: 12.4, answers: ['104.20.34.220', '172.66.144.113'], error: '' },
                { name: 'AliDNS', server: '223.5.5.5', success: true, latencyMs: 6.8, answers: ['104.20.34.220', '172.66.144.113'], error: '' },
                { name: 'Google', server: '8.8.8.8', success: true, latencyMs: 28.3, answers: ['104.20.34.220', '172.66.144.113'], error: '' },
                { name: 'Cloudflare', server: '1.1.1.1', success: true, latencyMs: 21.7, answers: ['104.20.34.220', '172.66.144.113'], error: '' }
              ]
            },
            doh: [
              { name: 'Cloudflare DoH', endpoint: 'https://cloudflare-dns.com/dns-query', success: true, status: 0, latencyMs: 96.2, answers: [{ name: 'example.com.', type: 'A', ttl: 248, value: '104.20.34.220' }], error: '' },
              { name: 'Google DoH', endpoint: 'https://dns.google/resolve', success: true, status: 0, latencyMs: 132.5, answers: [{ name: 'example.com.', type: 'A', ttl: 248, value: '104.20.34.220' }], error: '' },
              { name: 'AliDNS DoH', endpoint: 'https://dns.alidns.com/resolve', success: true, status: 0, latencyMs: 48.6, answers: [{ name: 'example.com.', type: 'A', ttl: 248, value: '104.20.34.220' }], error: '' }
            ],
            diagnosedAt: new Date().toLocaleString('zh-CN', { hour12: false })
          });
          break;
        case 'net_wifi_analyze':
          resolve({
            success: true,
            scannedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
            interfaces: [{ id: 'mock-wifi', name: 'Intel(R) Wi-Fi 6E AX211 160MHz', state: 'Connected' }],
            networks: [
              { interfaceName: 'Intel(R) Wi-Fi 6E AX211 160MHz', ssid: 'Studio-5G', bssid: '34:60:F9:20:18:A1', signalQuality: 94, rssi: -33, frequencyMHz: 5180, channel: 36, band: '5 GHz', radioType: '802.11ax', authentication: 'WPA3 Personal', cipher: 'CCMP', profileName: 'Studio-5G', securityEnabled: true, connected: true, connectable: true },
              { interfaceName: 'Intel(R) Wi-Fi 6E AX211 160MHz', ssid: 'Workshop', bssid: '68:7D:B4:11:82:20', signalQuality: 78, rssi: -58, frequencyMHz: 2437, channel: 6, band: '2.4 GHz', radioType: '802.11n', authentication: 'WPA2 Personal', cipher: 'CCMP', profileName: '', securityEnabled: true, connected: false, connectable: true },
              { interfaceName: 'Intel(R) Wi-Fi 6E AX211 160MHz', ssid: 'Guest', bssid: '18:31:BF:AA:72:09', signalQuality: 65, rssi: -67, frequencyMHz: 5220, channel: 44, band: '5 GHz', radioType: '802.11ac', authentication: 'Open', cipher: 'None', profileName: '', securityEnabled: false, connected: false, connectable: true },
              { interfaceName: 'Intel(R) Wi-Fi 6E AX211 160MHz', ssid: 'Office-IoT', bssid: '80:8A:8B:10:43:77', signalQuality: 51, rssi: -74, frequencyMHz: 2462, channel: 11, band: '2.4 GHz', radioType: '802.11n', authentication: 'WPA2 Personal', cipher: 'CCMP', profileName: '', securityEnabled: true, connected: false, connectable: true },
              { interfaceName: 'Intel(R) Wi-Fi 6E AX211 160MHz', ssid: '', bssid: '92:5A:7C:08:91:ED', signalQuality: 38, rssi: -81, frequencyMHz: 2412, channel: 1, band: '2.4 GHz', radioType: '802.11ax', authentication: 'WPA3 Personal', cipher: 'CCMP', profileName: '', securityEnabled: true, connected: false, connectable: true }
            ],
            channels: [
              { band: '2.4 GHz', channel: 1, accessPoints: 1, networks: 1, strongestSignal: 38 },
              { band: '2.4 GHz', channel: 6, accessPoints: 3, networks: 2, strongestSignal: 78 },
              { band: '2.4 GHz', channel: 11, accessPoints: 2, networks: 2, strongestSignal: 51 },
              { band: '5 GHz', channel: 36, accessPoints: 1, networks: 1, strongestSignal: 94 },
              { band: '5 GHz', channel: 44, accessPoints: 2, networks: 2, strongestSignal: 65 }
            ]
          });
          break;
        case 'net_http_redirect_trace':
          resolve({
            success: true,
            inputUrl: payload.url,
            finalUrl: 'https://www.example.com/docs',
            redirectCount: 2,
            totalElapsedMs: 184.6,
            completed: true,
            loopDetected: false,
            limitReached: false,
            downgradeDetected: false,
            tracedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
            hops: [
              { index: 1, url: payload.url, method: payload.method || 'HEAD', statusCode: 301, reasonPhrase: 'Moved Permanently', elapsedMs: 42.3, location: 'https://example.com/', nextMethod: payload.method || 'HEAD', hostChanged: false, schemeDowngrade: false, contentLength: 0, contentType: 'text/html', server: 'cloudflare', headers: { Location: 'https://example.com/', Server: 'cloudflare', 'Strict-Transport-Security': 'max-age=31536000' } },
              { index: 2, url: 'https://example.com/', method: payload.method || 'HEAD', statusCode: 302, reasonPhrase: 'Found', elapsedMs: 58.1, location: 'https://www.example.com/docs', nextMethod: payload.method || 'HEAD', hostChanged: true, schemeDowngrade: false, contentLength: 0, contentType: 'text/html', server: 'nginx', headers: { Location: 'https://www.example.com/docs', Server: 'nginx', 'Cache-Control': 'no-cache' } },
              { index: 3, url: 'https://www.example.com/docs', method: payload.method || 'HEAD', statusCode: 200, reasonPhrase: 'OK', elapsedMs: 84.2, location: '', nextMethod: payload.method || 'HEAD', hostChanged: false, schemeDowngrade: false, contentLength: 12580, contentType: 'text/html; charset=utf-8', server: 'nginx', headers: { Server: 'nginx', 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '12580' } }
            ]
          });
          break;
        case 'net_intel_lookup': {
          const isDomain = /[a-z]/i.test(payload.target || '');
          resolve({
            success: true,
            query: payload.target,
            queryType: isDomain ? 'domain' : 'ip',
            domain: isDomain ? payload.target : '',
            primaryIp: '1.1.1.1',
            resolvedIps: ['1.1.1.1', '1.0.0.1'],
            geo: { country: 'Australia', countryCode: 'AU', region: 'Queensland', city: 'South Brisbane', postal: '4101', latitude: -27.4766, longitude: 153.0166, timezone: 'Australia/Brisbane' },
            network: { asn: 13335, organization: 'Cloudflare, Inc.', isp: 'Cloudflare', domain: 'cloudflare.com', prefix: '1.1.1.0/24', holder: 'CLOUDFLARENET', announced: true },
            classification: { code: 'cdn', confidence: 'high', reasons: ['ASN or organization matches a known CDN'] },
            domainRdap: isDomain ? { kind: 'domain', handle: 'EXAMPLE-COM', name: payload.target, status: ['active'], registrar: 'Example Registrar, Inc.', registeredAt: '1995-08-14T04:00:00Z', expiresAt: '2027-08-13T04:00:00Z', changedAt: '2025-08-14T07:01:39Z', nameservers: ['A.IANA-SERVERS.NET', 'B.IANA-SERVERS.NET'], dnssec: true, entities: [] } : null,
            networkRdap: { kind: 'network', handle: 'APNIC-LABS', name: 'APNIC-LABS', type: 'ASSIGNED PORTABLE', country: 'AU', startAddress: '1.1.1.0', endAddress: '1.1.1.255', status: ['active'], changedAt: '2023-04-26T05:41:02Z', entities: [] },
            sourceErrors: [],
            queriedAt: new Date().toLocaleString('zh-CN', { hour12: false })
          });
          break;
        }

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
        case 'net_get_portproxy_rules':
          resolve({
            success: true,
            rules: this.mockPortProxyRules.map(rule => ({ ...rule })),
            isAdmin: localStorage.getItem('mock_admin') === 'true',
            serviceRunning: true,
            serviceStatus: 'Running'
          });
          break;
        case 'net_get_portproxy_targets': {
          const currentTargets = this.mockPortProxyRules.map(rule => ({
            address: rule.connectAddress,
            source: 'PortProxy',
            name: '现有规则目标'
          }));
          const discoveredTargets = [
            { address: '172.31.220.80', source: 'WSL', name: 'Ubuntu-24.04' },
            { address: '192.168.1.108', source: '本机网卡', name: '以太网' },
            { address: '192.168.1.120', source: '邻居设备', name: '以太网' }
          ];
          const uniqueTargets = [...discoveredTargets, ...currentTargets].filter((item, index, list) =>
            list.findIndex(candidate => candidate.address === item.address) === index
          );
          resolve({ success: true, candidates: uniqueTargets });
          break;
        }
        case 'net_add_portproxy_rule': {
          const rule = {
            listenAddress: payload.listenAddress,
            listenPort: Number(payload.listenPort),
            connectAddress: payload.connectAddress,
            connectPort: Number(payload.connectPort)
          };
          const existingIndex = this.mockPortProxyRules.findIndex(item =>
            item.listenAddress === rule.listenAddress && item.listenPort === rule.listenPort
          );
          if (existingIndex >= 0) this.mockPortProxyRules.splice(existingIndex, 1);
          this.mockPortProxyRules.push(rule);
          resolve({ success: true, message: `端口代理规则已添加：${rule.listenAddress}:${rule.listenPort} -> ${rule.connectAddress}:${rule.connectPort}` });
          break;
        }
        case 'net_remove_portproxy_rule':
          this.mockPortProxyRules = this.mockPortProxyRules.filter(item =>
            !(item.listenAddress === payload.listenAddress && item.listenPort === Number(payload.listenPort))
          );
          resolve({ success: true, message: `端口代理规则已删除：${payload.listenAddress}:${payload.listenPort}` });
          break;
        case 'net_start_portproxy_service':
          resolve({ success: true, message: 'IP Helper 服务已启动 (Mock)' });
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
        case 'sys_get_file_locks':
          resolve({
            success: true,
            path: payload.path || 'C:\\Test\\example.db',
            locked: true,
            lockCount: 1,
            processes: [
              { pid: 3820, name: 'Code.exe', title: 'WinPsBox - Visual Studio Code', path: 'C:\\Users\\User\\AppData\\Local\\Programs\\VSCode\\Code.exe', memoryMB: 320.5 }
            ]
          });
          break;
        case 'sys_get_scheduled_tasks': {
          const saved = localStorage.getItem('mock_scheduled_tasks');
          const defaults = [
            { id: 'WinPsBox_EveningLock_demo01', name: '下班后锁屏', action: 'lock', execute: 'rundll32.exe', arguments: 'user32.dll,LockWorkStation', scheduleType: 'daily', nextRun: '2026-08-18 22:30:00', lastRun: '2026-08-17 22:30:00', lastResult: 0, enabled: true, state: 'Ready' },
            { id: 'WinPsBox_Backup_demo02', name: '每晚备份项目', action: 'program', execute: 'C:\\Tools\\backup.ps1', arguments: '', scheduleType: 'daily', nextRun: '2026-08-19 01:00:00', lastRun: '', lastResult: 0, enabled: false, state: 'Disabled' }
          ];
          if (!saved) localStorage.setItem('mock_scheduled_tasks', JSON.stringify(defaults));
          resolve(saved ? JSON.parse(saved) : defaults);
          break;
        }
        case 'sys_create_scheduled_task': {
          const tasks = JSON.parse(localStorage.getItem('mock_scheduled_tasks') || '[]');
          const id = `WinPsBox_${payload.taskAction}_${Date.now()}`;
          const actionExecute = {
            shutdown: 'shutdown.exe', restart: 'shutdown.exe', sleep: 'rundll32.exe', lock: 'rundll32.exe'
          }[payload.taskAction] || payload.programPath;
          tasks.push({
            id,
            name: payload.name,
            action: payload.taskAction,
            execute: actionExecute,
            arguments: payload.arguments || '',
            scheduleType: payload.scheduleType,
            nextRun: payload.runAt,
            lastRun: '',
            lastResult: 0,
            enabled: true,
            state: 'Ready'
          });
          localStorage.setItem('mock_scheduled_tasks', JSON.stringify(tasks));
          resolve({ success: true, id, message: '定时任务已创建 (Mock)' });
          break;
        }
        case 'sys_set_scheduled_task_state': {
          const tasks = JSON.parse(localStorage.getItem('mock_scheduled_tasks') || '[]');
          tasks.forEach(task => {
            if (task.id === payload.id) {
              task.enabled = payload.enabled;
              task.state = payload.enabled ? 'Ready' : 'Disabled';
            }
          });
          localStorage.setItem('mock_scheduled_tasks', JSON.stringify(tasks));
          resolve({ success: true, message: payload.enabled ? '任务已启用 (Mock)' : '任务已暂停 (Mock)' });
          break;
        }
        case 'sys_remove_scheduled_task': {
          const tasks = JSON.parse(localStorage.getItem('mock_scheduled_tasks') || '[]').filter(task => task.id !== payload.id);
          localStorage.setItem('mock_scheduled_tasks', JSON.stringify(tasks));
          resolve({ success: true, message: '任务已删除 (Mock)' });
          break;
        }
        case 'sys_get_context_menu_items': {
          const disabled = JSON.parse(localStorage.getItem('mock_context_disabled') || '[]');
          const items = [
            { id: 'verb|open-code', name: 'Open with Code', keyName: 'VSCode', type: 'verb', typeName: '命令菜单', target: 'folder', targetName: '文件夹', scope: 'User', command: '"C:\\Program Files\\Microsoft VS Code\\Code.exe" "%V"', registryPath: 'HKCU:\\Software\\Classes\\Directory\\shell\\VSCode', clsid: '', policyLocked: false },
            { id: 'verb|terminal', name: '在终端中打开', keyName: 'WindowsTerminal', type: 'verb', typeName: '命令菜单', target: 'background', targetName: '目录背景', scope: 'Machine', command: 'wt.exe -d "%V"', registryPath: 'HKLM:\\Software\\Classes\\Directory\\Background\\shell\\WindowsTerminal', clsid: '', policyLocked: false },
            { id: 'verb|scan', name: '使用 Microsoft Defender 扫描', keyName: 'WindowsDefender', type: 'verb', typeName: '命令菜单', target: 'file', targetName: '文件', scope: 'Machine', command: 'MpCmdRun.exe -Scan -ScanType 3 -File "%1"', registryPath: 'HKLM:\\Software\\Classes\\*\\shell\\WindowsDefender', clsid: '', policyLocked: false },
            { id: 'handler|7zip', name: '7-Zip Shell Extension', keyName: '7-Zip', type: 'handler', typeName: '扩展处理器', target: 'file', targetName: '文件', scope: 'Machine', command: '{23170F69-40C1-278A-1000-000100020000}', registryPath: 'HKLM:\\Software\\Classes\\*\\shellex\\ContextMenuHandlers\\7-Zip', clsid: '{23170F69-40C1-278A-1000-000100020000}', policyLocked: false },
            { id: 'handler|sharing', name: 'ModernSharing', keyName: 'ModernSharing', type: 'handler', typeName: '扩展处理器', target: 'folder', targetName: '文件夹', scope: 'Machine', command: '{E2BF9676-5F8F-435C-97EB-11607A5BEDF7}', registryPath: 'HKLM:\\Software\\Classes\\Directory\\shellex\\ContextMenuHandlers\\ModernSharing', clsid: '{E2BF9676-5F8F-435C-97EB-11607A5BEDF7}', policyLocked: false },
            { id: 'verb|encrypt', name: '启用 BitLocker', keyName: 'manage-bde', type: 'verb', typeName: '命令菜单', target: 'drive', targetName: '磁盘', scope: 'Machine', command: 'manage-bde.exe', registryPath: 'HKLM:\\Software\\Classes\\Drive\\shell\\manage-bde', clsid: '', policyLocked: false }
          ];
          items.forEach(item => { item.enabled = !disabled.includes(item.id); });
          resolve(items);
          break;
        }
        case 'sys_set_context_menu_item_state': {
          const items = [
            ['verb', 'HKCU:\\Software\\Classes\\Directory\\shell\\VSCode', '', 'verb|open-code'],
            ['verb', 'HKLM:\\Software\\Classes\\Directory\\Background\\shell\\WindowsTerminal', '', 'verb|terminal'],
            ['verb', 'HKLM:\\Software\\Classes\\*\\shell\\WindowsDefender', '', 'verb|scan'],
            ['handler', 'HKLM:\\Software\\Classes\\*\\shellex\\ContextMenuHandlers\\7-Zip', '{23170F69-40C1-278A-1000-000100020000}', 'handler|7zip'],
            ['handler', 'HKLM:\\Software\\Classes\\Directory\\shellex\\ContextMenuHandlers\\ModernSharing', '{E2BF9676-5F8F-435C-97EB-11607A5BEDF7}', 'handler|sharing'],
            ['verb', 'HKLM:\\Software\\Classes\\Drive\\shell\\manage-bde', '', 'verb|encrypt']
          ];
          const match = items.find(item => item[0] === payload.type && (item[1] === payload.registryPath || item[2] === payload.clsid));
          let disabled = JSON.parse(localStorage.getItem('mock_context_disabled') || '[]');
          if (match) disabled = payload.enabled ? disabled.filter(id => id !== match[3]) : [...new Set([...disabled, match[3]])];
          localStorage.setItem('mock_context_disabled', JSON.stringify(disabled));
          resolve({ success: true, restartRequired: true, message: `菜单项已${payload.enabled ? '启用' : '禁用'} (Mock)` });
          break;
        }
        case 'sys_open_context_menu_registry':
          resolve({ success: true });
          break;
        case 'winget_get_status':
          resolve({ available: true, version: 'v1.29.280', error: null });
          break;
        case 'winget_get_packages': {
          const installed = [
            { name: '7-Zip', id: '7zip.7zip', version: '23.01', availableVersion: '26.02', source: 'winget' },
            { name: 'Git', id: 'Git.Git', version: '2.45.0', availableVersion: '2.55.0.3', source: 'winget' },
            { name: 'Microsoft PowerShell', id: 'Microsoft.PowerShell', version: '7.5.2.0', availableVersion: '', source: 'winget' },
            { name: 'Visual Studio Code', id: 'Microsoft.VisualStudioCode', version: '1.103.1', availableVersion: '', source: 'winget' },
            { name: 'Windows Terminal', id: 'Microsoft.WindowsTerminal', version: '1.22.11141.0', availableVersion: '', source: 'winget' }
          ];
          const items = payload.mode === 'updates' ? installed.filter(item => item.availableVersion) : installed;
          resolve({ success: true, items, count: items.length, mode: payload.mode || 'installed' });
          break;
        }
        case 'winget_search':
          resolve({
            success: true,
            query: payload.query,
            count: 4,
            items: [
              { name: 'PowerShell', id: 'Microsoft.PowerShell', version: '7.6.5.0', source: 'winget', match: '' },
              { name: 'WinPaletter', id: 'Abdelrhman-AK.WinPaletter', version: '1.0.9.9', source: 'winget', match: 'Tag: powershell' },
              { name: 'Atuin', id: 'Atuinsh.Atuin', version: '18.19.0', source: 'winget', match: 'Tag: powershell' },
              { name: 'Chocolatey', id: 'Chocolatey.Chocolatey', version: '2.7.3.0', source: 'winget', match: 'Tag: powershell' }
            ]
          });
          break;
        case 'winget_package_action':
          resolve({ success: true, operation: payload.operation, packageId: payload.packageId || '', message: '操作已完成 (Mock)' });
          break;
        case 'winget_batch_action':
          resolve({
            operation: payload.operation,
            total: (payload.packageIds || []).length,
            succeeded: (payload.packageIds || []).length,
            failed: 0,
            results: (payload.packageIds || []).map(packageId => ({ success: true, packageId, error: null }))
          });
          break;

        default:
          resolve({ success: true });
      }
    }, this.isBackgroundAction(action) ? 3000 : 60);
  }
};

