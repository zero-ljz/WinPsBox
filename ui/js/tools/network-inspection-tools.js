const WifiAnalyzerTool = {
  root: null,
  result: null,
  activeBand: 'all',
  query: '',
  operationId: 0,

  render(container) {
    this.root = container;
    this.result = null;
    this.operationId += 1;
    this.activeBand = 'all';
    this.query = '';
    container.innerHTML = `
      <div class="inspection-shell wifi-analyzer-shell">
        <div class="inspection-toolbar">
          <div class="inspection-status" id="wifiAdapterStatus">
            <span class="inspection-status-icon"><i data-lucide="wifi"></i></span>
            <div><strong>无线网络</strong><span>正在读取 WLAN 接口</span></div>
          </div>
          <div class="inspection-toolbar-actions">
            <div class="inspection-search"><i data-lucide="search"></i><input id="wifiSearch" placeholder="SSID、BSSID 或认证方式" spellcheck="false"></div>
            <button class="inspection-icon-button" id="wifiRefresh" title="重新扫描"><i data-lucide="refresh-cw"></i></button>
          </div>
        </div>

        <div class="inspection-summary" id="wifiSummary">
          <div><span>网络</span><b>-</b></div><div><span>接入点</span><b>-</b></div><div><span>最强信号</span><b>-</b></div><div><span>扫描时间</span><b>-</b></div>
        </div>

        <div class="wifi-content-grid">
          <section class="inspection-panel wifi-channel-panel">
            <header class="inspection-panel-header">
              <div><i data-lucide="chart-no-axes-column-increasing"></i><strong>信道占用</strong></div>
              <div class="inspection-segments" id="wifiBandFilter" aria-label="频段筛选">
                <button class="active" data-wifi-band="all">全部</button>
                <button data-wifi-band="2.4 GHz">2.4 GHz</button>
                <button data-wifi-band="5 GHz">5 GHz</button>
                <button data-wifi-band="6 GHz">6 GHz</button>
              </div>
            </header>
            <div class="wifi-channel-chart" id="wifiChannelChart">${NetworkDevUi.loading('正在扫描信道')}</div>
          </section>

          <section class="inspection-panel wifi-network-panel">
            <header class="inspection-panel-header">
              <div><i data-lucide="radio-tower"></i><strong>附近接入点</strong></div>
              <span class="inspection-count" id="wifiVisibleCount">0</span>
            </header>
            <div class="wifi-network-list" id="wifiNetworkList">${NetworkDevUi.loading('正在扫描无线网络')}</div>
          </section>
        </div>
      </div>`;

    this.root.querySelector('#wifiRefresh').onclick = () => this.refresh();
    this.root.querySelector('#wifiSearch').oninput = event => {
      this.query = event.target.value.trim().toLowerCase();
      this.renderNetworks();
    };
    this.root.querySelectorAll('[data-wifi-band]').forEach(button => {
      button.onclick = () => {
        this.activeBand = button.dataset.wifiBand;
        this.root.querySelectorAll('[data-wifi-band]').forEach(item => item.classList.toggle('active', item === button));
        this.renderChannels();
        this.renderNetworks();
      };
    });
    if (window.lucide) lucide.createIcons({ root: container });
    this.refresh();
  },

  async refresh() {
    const root = this.root;
    const operationId = ++this.operationId;
    const isCurrent = () => this.operationId === operationId && Boolean(root.querySelector('.wifi-analyzer-shell'));
    const button = root.querySelector('#wifiRefresh');
    button.disabled = true;
    button.classList.add('is-spinning');
    this.root.querySelector('#wifiChannelChart').innerHTML = NetworkDevUi.loading('正在扫描信道');
    this.root.querySelector('#wifiNetworkList').innerHTML = NetworkDevUi.loading('正在扫描无线网络');
    try {
      const result = await IPC.send('net_wifi_analyze');
      if (!isCurrent()) return;
      this.result = result;
      this.renderStatus();
      this.renderSummary();
      this.renderChannels();
      this.renderNetworks();
    } catch (error) {
      if (!isCurrent()) return;
      this.result = null;
      const cancelled = Boolean(error.cancelled);
      const title = cancelled ? 'Wi-Fi 扫描已取消' : 'Wi-Fi 扫描失败';
      const icon = cancelled ? 'circle-slash-2' : 'wifi-off';
      this.root.querySelector('#wifiChannelChart').innerHTML = NetworkDevUi.empty(icon, title, cancelled ? '' : error.message);
      this.root.querySelector('#wifiNetworkList').innerHTML = NetworkDevUi.empty(icon, title);
      Toast.show(cancelled ? title : `${title}: ${error.message}`, cancelled ? 'info' : 'error');
    } finally {
      if (isCurrent()) {
        button.disabled = false;
        button.classList.remove('is-spinning');
        if (window.lucide) lucide.createIcons({ root });
      }
    }
  },

  renderStatus() {
    const interfaces = this.result?.interfaces || [];
    const connected = interfaces.find(item => String(item.state).toLowerCase() === 'connected');
    const status = this.root.querySelector('#wifiAdapterStatus');
    status.classList.toggle('is-connected', Boolean(connected));
    status.querySelector('strong').textContent = connected ? 'WLAN 已连接' : interfaces.length ? 'WLAN 未连接' : '未发现 WLAN 接口';
    status.querySelector('span:last-child').textContent = connected?.name || interfaces[0]?.name || '请检查无线网卡和 WLAN 服务';
  },

  renderSummary() {
    const networks = this.result.networks || [];
    const uniqueSsids = new Set(networks.map(item => item.ssid).filter(Boolean));
    const strongest = networks.reduce((max, item) => Math.max(max, Number(item.signalQuality) || 0), 0);
    this.root.querySelector('#wifiSummary').innerHTML = `
      <div><span>网络</span><b>${uniqueSsids.size}</b></div>
      <div><span>接入点</span><b>${networks.length}</b></div>
      <div><span>最强信号</span><b>${networks.length ? `${strongest}%` : '-'}</b></div>
      <div><span>扫描时间</span><b>${NetworkDevUi.escape((this.result.scannedAt || '').split(' ').pop() || '-')}</b></div>`;
  },

  renderChannels() {
    if (!this.result) return;
    const channels = (this.result.channels || []).filter(item => this.activeBand === 'all' || item.band === this.activeBand);
    const mount = this.root.querySelector('#wifiChannelChart');
    if (!channels.length) {
      mount.innerHTML = NetworkDevUi.empty('chart-no-axes-column', '当前频段没有信道数据');
      return;
    }
    const groups = ['2.4 GHz', '5 GHz', '6 GHz']
      .map(band => ({ band, items: channels.filter(item => item.band === band) }))
      .filter(group => group.items.length);
    const maxLoad = Math.max(...channels.map(item => Number(item.accessPoints) || 0), 1);
    mount.innerHTML = groups.map(group => `
      <div class="wifi-band-row">
        <span class="wifi-band-label">${NetworkDevUi.escape(group.band)}</span>
        <div class="wifi-channel-bars">
          ${group.items.map(item => {
            const load = Math.max(12, Math.round((Number(item.accessPoints) || 0) / maxLoad * 100));
            const level = item.accessPoints >= 4 ? 'busy' : item.accessPoints >= 2 ? 'medium' : 'clear';
            return `<div class="wifi-channel-item ${level}" title="信道 ${item.channel} · ${item.accessPoints} 个接入点">
              <div class="wifi-channel-meter"><span style="height:${load}%"></span><b>${item.accessPoints}</b></div>
              <em>${item.channel}</em>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('');
  },

  filteredNetworks() {
    return (this.result?.networks || []).filter(item => {
      if (this.activeBand !== 'all' && item.band !== this.activeBand) return false;
      if (!this.query) return true;
      return [item.ssid, item.bssid, item.authentication, item.radioType, item.interfaceName]
        .some(value => String(value || '').toLowerCase().includes(this.query));
    });
  },

  signalClass(value) {
    const signal = Number(value) || 0;
    return signal >= 75 ? 'strong' : signal >= 50 ? 'medium' : 'weak';
  },

  renderNetworks() {
    if (!this.result) return;
    const networks = this.filteredNetworks();
    this.root.querySelector('#wifiVisibleCount').textContent = networks.length;
    const mount = this.root.querySelector('#wifiNetworkList');
    if (!networks.length) {
      mount.innerHTML = NetworkDevUi.empty('search-x', '没有匹配的接入点');
      return;
    }
    mount.innerHTML = `<div class="inspection-table-wrap"><table class="inspection-table wifi-table">
      <thead><tr><th>网络</th><th>信号</th><th>频段 / 信道</th><th>安全</th><th>无线电</th><th>BSSID</th></tr></thead>
      <tbody>${networks.map(item => {
        const signalClass = this.signalClass(item.signalQuality);
        const ssid = item.ssid || '隐藏网络';
        return `<tr class="${item.connected ? 'is-connected' : ''}">
          <td><div class="wifi-ssid-cell"><span class="wifi-row-icon ${item.connected ? 'connected' : ''}"><i data-lucide="${item.connected ? 'wifi' : item.securityEnabled ? 'lock' : 'lock-open'}"></i></span><div><strong>${NetworkDevUi.escape(ssid)}</strong>${item.connected ? '<em>当前连接</em>' : item.profileName ? '<em>已保存</em>' : ''}</div></div></td>
          <td><div class="wifi-signal-cell"><span class="wifi-signal-track"><i class="${signalClass}" style="width:${Math.max(0, Math.min(100, Number(item.signalQuality) || 0))}%"></i></span><b>${item.signalQuality}%</b><em>${item.rssi} dBm</em></div></td>
          <td><div class="wifi-detail-pair"><strong>${NetworkDevUi.escape(item.band)}</strong><span>信道 ${item.channel || '-'}</span></div></td>
          <td><div class="wifi-detail-pair"><strong class="${item.securityEnabled ? '' : 'wifi-open-network'}">${NetworkDevUi.escape(item.authentication || '-')}</strong><span>${NetworkDevUi.escape(item.cipher || '-')}</span></div></td>
          <td><div class="wifi-detail-pair"><strong>${NetworkDevUi.escape(item.radioType || '-')}</strong><span>${item.frequencyMHz || '-'} MHz</span></div></td>
          <td class="font-mono wifi-bssid">${NetworkDevUi.escape(item.bssid || '-')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
    if (window.lucide) lucide.createIcons({ root: mount });
  }
};

const HttpRedirectTracerTool = {
  root: null,
  result: null,
  operationId: 0,

  render(container) {
    this.root = container;
    this.result = null;
    this.operationId += 1;
    container.innerHTML = `
      <div class="inspection-shell redirect-tracer-shell">
        <div class="redirect-querybar">
          <div class="redirect-url-input"><i data-lucide="link-2"></i><input id="redirectUrl" class="font-mono" value="http://example.com" placeholder="https://example.com/path" spellcheck="false"></div>
          <select id="redirectMethod" aria-label="请求方法"><option value="HEAD">HEAD</option><option value="GET">GET</option></select>
          <label class="redirect-number-field"><span>最大跳数</span><input id="redirectMaxHops" type="number" min="1" max="20" value="10"></label>
          <label class="redirect-number-field"><span>超时</span><select id="redirectTimeout"><option value="5000">5 秒</option><option value="10000" selected>10 秒</option><option value="20000">20 秒</option><option value="30000">30 秒</option></select></label>
          <button class="inspection-primary-button" id="redirectRun"><i data-lucide="route"></i><span>开始追踪</span></button>
        </div>

        <div class="inspection-summary redirect-summary" id="redirectSummary">
          <div><span>重定向</span><b>-</b></div><div><span>最终状态</span><b>-</b></div><div><span>总耗时</span><b>-</b></div><div><span>最终主机</span><b>-</b></div>
        </div>

        <section class="inspection-panel redirect-result-panel">
          <header class="inspection-panel-header">
            <div><i data-lucide="git-commit-horizontal"></i><strong>请求链</strong></div>
            <span class="inspection-muted" id="redirectTracedAt">尚未追踪</span>
          </header>
          <div class="redirect-result" id="redirectResult">${NetworkDevUi.empty('route', '等待追踪')}</div>
        </section>
      </div>`;
    this.root.querySelector('#redirectRun').onclick = () => this.run();
    this.root.querySelector('#redirectUrl').onkeydown = event => { if (event.key === 'Enter') this.run(); };
    if (window.lucide) lucide.createIcons({ root: container });
  },

  async run() {
    const root = this.root;
    const operationId = ++this.operationId;
    const isCurrent = () => this.operationId === operationId && Boolean(root.querySelector('.redirect-tracer-shell'));
    const url = root.querySelector('#redirectUrl').value.trim();
    let parsed;
    try { parsed = new URL(url); } catch (_) { parsed = null; }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      Toast.show('请输入完整的 HTTP 或 HTTPS 地址', 'warning');
      return;
    }
    if (parsed.username || parsed.password) {
      Toast.show('不支持地址中嵌入凭据', 'warning');
      return;
    }
    const method = this.root.querySelector('#redirectMethod').value;
    const maxRedirects = Math.max(1, Math.min(20, Number(this.root.querySelector('#redirectMaxHops').value) || 10));
    const timeoutMs = Number(this.root.querySelector('#redirectTimeout').value) || 10000;
    const button = this.root.querySelector('#redirectRun');
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>追踪中</span>';
    this.root.querySelector('#redirectResult').innerHTML = NetworkDevUi.loading(`正在请求 ${parsed.host}`);
    try {
      const result = await IPC.send('net_http_redirect_trace', { url: parsed.href, method, maxRedirects, timeoutMs });
      if (!isCurrent()) return;
      this.result = result;
      this.renderSummary();
      this.renderResult();
    } catch (error) {
      if (!isCurrent()) return;
      this.result = null;
      const cancelled = Boolean(error.cancelled);
      this.root.querySelector('#redirectResult').innerHTML = NetworkDevUi.empty(cancelled ? 'circle-slash-2' : 'circle-x', cancelled ? '重定向追踪已取消' : '重定向追踪失败', cancelled ? '' : error.message);
      Toast.show(cancelled ? '重定向追踪已取消' : `追踪失败: ${error.message}`, cancelled ? 'info' : 'error');
    } finally {
      if (isCurrent()) {
        button.disabled = false;
        button.innerHTML = '<i data-lucide="route"></i><span>开始追踪</span>';
        if (window.lucide) lucide.createIcons({ root });
      }
    }
  },

  statusClass(code) {
    if (code >= 200 && code < 300) return 'success';
    if (code >= 300 && code < 400) return 'redirect';
    if (code >= 400 && code < 500) return 'warning';
    return 'danger';
  },

  formatBytes(value) {
    if (value === null || value === undefined) return '-';
    const bytes = Number(value);
    if (!Number.isFinite(bytes)) return '-';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  },

  renderSummary() {
    const result = this.result;
    const hops = result.hops || [];
    const last = hops[hops.length - 1];
    let finalHost = '-';
    try { finalHost = new URL(result.finalUrl).host; } catch (_) {}
    this.root.querySelector('#redirectSummary').innerHTML = `
      <div><span>重定向</span><b>${result.redirectCount}</b></div>
      <div><span>最终状态</span><b class="redirect-summary-status ${this.statusClass(last?.statusCode || 0)}">${last?.statusCode || '-'}</b></div>
      <div><span>总耗时</span><b>${result.totalElapsedMs} ms</b></div>
      <div><span>最终主机</span><b title="${NetworkDevUi.escape(finalHost)}">${NetworkDevUi.escape(finalHost)}</b></div>`;
    this.root.querySelector('#redirectTracedAt').textContent = result.tracedAt || '';
  },

  renderResult() {
    const result = this.result;
    const hops = result.hops || [];
    const state = result.loopDetected ? { type: 'danger', icon: 'repeat-2', title: '检测到重定向循环' }
      : result.limitReached ? { type: 'warning', icon: 'octagon-alert', title: '已达到最大跳数' }
        : result.downgradeDetected ? { type: 'warning', icon: 'shield-alert', title: '链路包含 HTTPS 降级' }
          : { type: 'success', icon: 'circle-check', title: '已到达最终响应' };
    const mount = this.root.querySelector('#redirectResult');
    mount.innerHTML = `
      <div class="redirect-state-banner ${state.type}"><i data-lucide="${state.icon}"></i><strong>${state.title}</strong><span class="font-mono">${NetworkDevUi.escape(result.finalUrl)}</span><button class="inspection-icon-button" data-copy-redirect="${NetworkDevUi.escape(result.finalUrl)}" title="复制最终地址"><i data-lucide="copy"></i></button></div>
      <div class="redirect-hop-list">
        ${hops.map((hop, index) => `
          <article class="redirect-hop ${hop.schemeDowngrade ? 'has-warning' : ''}">
            <div class="redirect-hop-rail"><span>${hop.index}</span>${index < hops.length - 1 ? '<i></i>' : ''}</div>
            <div class="redirect-hop-body">
              <div class="redirect-hop-main">
                <span class="redirect-status ${this.statusClass(hop.statusCode)}">${hop.statusCode}</span>
                <span class="redirect-method">${NetworkDevUi.escape(hop.method)}</span>
                <div class="redirect-hop-url"><strong class="font-mono">${NetworkDevUi.escape(hop.url)}</strong><span>${NetworkDevUi.escape(hop.reasonPhrase || '')}</span></div>
                <b class="redirect-time font-mono">${hop.elapsedMs} ms</b>
                <button class="inspection-icon-button" data-copy-redirect="${NetworkDevUi.escape(hop.url)}" title="复制地址"><i data-lucide="copy"></i></button>
              </div>
              ${hop.location ? `<div class="redirect-location"><i data-lucide="corner-down-right"></i><span class="font-mono">${NetworkDevUi.escape(hop.location)}</span>${hop.hostChanged ? '<em>跨主机</em>' : ''}${hop.schemeDowngrade ? '<em class="danger">HTTPS 降级</em>' : ''}</div>` : ''}
              <details class="redirect-details">
                <summary><span>响应详情</span><em>${NetworkDevUi.escape(hop.server || '未知服务器')} · ${this.formatBytes(hop.contentLength)}</em><i data-lucide="chevron-down"></i></summary>
                <div class="redirect-detail-grid">
                  <div><span>Content-Type</span><b>${NetworkDevUi.escape(hop.contentType || '-')}</b></div>
                  <div><span>下一请求方法</span><b>${NetworkDevUi.escape(hop.nextMethod || hop.method)}</b></div>
                </div>
                <div class="redirect-headers">${Object.entries(hop.headers || {}).map(([name, value]) => `<div><span>${NetworkDevUi.escape(name)}</span><b class="font-mono">${NetworkDevUi.escape(value)}</b></div>`).join('')}</div>
              </details>
            </div>
          </article>`).join('')}
      </div>`;
    mount.querySelectorAll('[data-copy-redirect]').forEach(button => button.onclick = () => NetworkDevUi.copy(button.dataset.copyRedirect, '地址'));
    if (window.lucide) lucide.createIcons({ root: mount });
  }
};
