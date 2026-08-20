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

