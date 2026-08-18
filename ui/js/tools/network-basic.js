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

