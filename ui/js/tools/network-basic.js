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
      const cancelled = Boolean(e.cancelled);
      tbody.innerHTML = `<tr><td colspan="4" class="text-center ${cancelled ? 'text-muted' : 'text-danger'} py-4">${cancelled ? '端口探测已取消' : `探测失败: ${e.message}`}</td></tr>`;
      Toast.show(cancelled ? '端口探测已取消' : '探测失败: ' + e.message, cancelled ? 'info' : 'error', 3000);
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
      const cancelled = Boolean(e.cancelled);
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center ${cancelled ? 'text-muted' : 'text-danger'} py-4">${cancelled ? 'Ping 探测已取消' : `诊断失败: ${e.message}`}</td></tr>`;
      Toast.show(cancelled ? 'Ping 探测已取消' : 'Ping 探测失败: ' + e.message, cancelled ? 'info' : 'error', 3000);
    } finally {
      btn.disabled = false;
    }
  }
};
