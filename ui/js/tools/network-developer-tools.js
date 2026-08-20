const NetworkDevUi = {
  escape(value) {
    const node = document.createElement('div');
    node.textContent = String(value ?? '');
    return node.innerHTML;
  },

  formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  },

  async copy(value, label = '内容') {
    try {
      await navigator.clipboard.writeText(String(value || ''));
      Toast.show(`已复制${label}`, 'success', 1200);
    } catch (_) {
      Toast.show('复制失败', 'error');
    }
  },

  loading(text) {
    return `<div class="nd-loading"><span class="spinner-border spinner-border-sm"></span><span>${this.escape(text)}</span></div>`;
  },

  empty(icon, title, text = '') {
    return `<div class="nd-empty"><i data-lucide="${icon}"></i><strong>${this.escape(title)}</strong>${text ? `<span>${this.escape(text)}</span>` : ''}</div>`;
  }
};

const LocalCertificateTool = {
  root: null,
  defaults: null,
  status: null,
  lastFolder: '',

  render(container) {
    this.root = container;
    container.innerHTML = `
      <div class="nd-shell cert-tool-shell">
        <div class="nd-topbar">
          <div class="nd-topbar-title">
            <span class="nd-live-dot neutral" id="certStatusDot"></span>
            <strong id="certStatusHeadline">正在读取证书库</strong>
            <span class="nd-muted font-mono" id="certStatusThumbprint">-</span>
          </div>
          <button class="nd-icon-button" id="certRefreshButton" title="刷新证书状态"><i data-lucide="refresh-cw"></i></button>
        </div>

        <div class="cert-layout">
          <section class="nd-panel cert-ca-panel">
            <header class="nd-panel-header">
              <div><i data-lucide="shield-check"></i><span>本地根证书颁发机构</span></div>
              <span class="nd-state-badge neutral" id="certCaBadge">未创建</span>
            </header>
            <div class="nd-panel-body cert-ca-body">
              <div class="cert-ca-identity">
                <div class="cert-ca-seal"><i data-lucide="landmark"></i></div>
                <div>
                  <strong>WinPsBox Local Root CA</strong>
                  <span>RSA 4096 · SHA-256 · 10 年有效期</span>
                </div>
              </div>

              <div class="nd-field">
                <label for="certTrustScope">信任范围</label>
                <select id="certTrustScope" class="nd-select">
                  <option value="CurrentUser">当前用户 · 无需管理员权限</option>
                  <option value="LocalMachine">本机所有用户 · 需要 UAC</option>
                </select>
              </div>

              <label class="cert-security-check">
                <input type="checkbox" id="certTrustAcknowledgement">
                <span>我确认仅使用此 CA 签发本地开发证书，并妥善保管私钥。</span>
              </label>

              <button class="nd-primary-button cert-create-button" id="certCreateCaButton" disabled>
                <i data-lucide="badge-plus"></i><span>创建并信任 Root CA</span>
              </button>

              <div class="cert-ca-facts" id="certCaFacts">
                <div><span>当前用户信任库</span><b>检测中</b></div>
                <div><span>本机信任库</span><b>检测中</b></div>
                <div><span>有效期至</span><b>-</b></div>
              </div>
            </div>
          </section>

          <section class="nd-panel cert-leaf-panel">
            <header class="nd-panel-header">
              <div><i data-lucide="file-key-2"></i><span>SAN HTTPS 证书</span></div>
              <span class="nd-state-badge info">RSA 2048</span>
            </header>
            <div class="nd-panel-body cert-form-grid">
              <div class="nd-field cert-cn-field">
                <label for="certCommonName">Common Name</label>
                <input id="certCommonName" class="nd-input font-mono" value="localhost" spellcheck="false">
              </div>
              <div class="nd-field cert-days-field">
                <label for="certValidDays">有效天数</label>
                <input id="certValidDays" class="nd-input font-mono" type="number" min="1" max="825" value="398">
              </div>
              <div class="nd-field cert-san-field">
                <div class="nd-label-row">
                  <label for="certSans">Subject Alternative Names</label>
                  <button class="nd-text-button" id="certFillDefaultsButton"><i data-lucide="wand-sparkles"></i>填入本机地址</button>
                </div>
                <textarea id="certSans" class="nd-textarea font-mono" rows="6" spellcheck="false" placeholder="localhost&#10;127.0.0.1&#10;dev.example.test"></textarea>
              </div>
              <div class="nd-field cert-password-field">
                <label for="certPfxPassword">PFX 导出密码</label>
                <div class="nd-password-row">
                  <input id="certPfxPassword" class="nd-input font-mono" type="password" autocomplete="new-password" placeholder="至少 6 个字符">
                  <button class="nd-icon-button" id="certTogglePassword" title="显示或隐藏密码"><i data-lucide="eye"></i></button>
                </div>
              </div>
              <button class="nd-primary-button cert-generate-button" id="certGenerateButton">
                <i data-lucide="key-round"></i><span>生成开发证书</span>
              </button>
            </div>
          </section>
        </div>

        <section class="nd-panel cert-result-panel">
          <header class="nd-panel-header">
            <div><i data-lucide="package-check"></i><span>证书产物</span></div>
            <button class="nd-text-button" id="certOpenFolderButton"><i data-lucide="folder-open"></i>打开目录</button>
          </header>
          <div class="cert-result" id="certResult">
            ${NetworkDevUi.empty('folder-key', '尚未生成服务器证书', '生成后可获得 PFX、CER、PEM 与完整证书链')}
          </div>
        </section>
      </div>`;

    this.bindEvents();
    this.refresh();
    if (window.lucide) lucide.createIcons({ root: container });
  },

  bindEvents() {
    this.root.querySelector('#certRefreshButton').onclick = () => this.refresh();
    this.root.querySelector('#certTrustAcknowledgement').onchange = event => {
      this.root.querySelector('#certCreateCaButton').disabled = !event.target.checked;
    };
    this.root.querySelector('#certTrustScope').onchange = () => this.updateCaButton();
    this.root.querySelector('#certCreateCaButton').onclick = () => this.createCa();
    this.root.querySelector('#certGenerateButton').onclick = () => this.generateCertificate();
    this.root.querySelector('#certFillDefaultsButton').onclick = () => this.fillDefaults();
    this.root.querySelector('#certOpenFolderButton').onclick = () => this.openFolder(this.lastFolder || this.defaults?.outputDirectory || '');
    this.root.querySelector('#certTogglePassword').onclick = () => {
      const input = this.root.querySelector('#certPfxPassword');
      input.type = input.type === 'password' ? 'text' : 'password';
      this.root.querySelector('#certTogglePassword').innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
      if (window.lucide) lucide.createIcons({ root: this.root.querySelector('#certTogglePassword') });
    };
  },

  async refresh() {
    try {
      const [defaults, status] = await Promise.all([
        IPC.send('cert_get_defaults'),
        IPC.send('cert_get_ca_status')
      ]);
      this.defaults = defaults;
      this.status = status;
      this.lastFolder = defaults.outputDirectory || '';
      this.renderStatus();
      if (!this.root.querySelector('#certSans').value.trim()) this.fillDefaults();
    } catch (error) {
      Toast.show('读取证书状态失败: ' + error.message, 'error');
    }
  },

  fillDefaults() {
    if (!this.defaults?.sans) return;
    this.root.querySelector('#certSans').value = this.defaults.sans.join('\n');
  },

  renderStatus() {
    if (!this.root || !this.status) return;
    const status = this.status;
    const trusted = status.trustedCurrentUser || status.trustedLocalMachine;
    const dot = this.root.querySelector('#certStatusDot');
    dot.className = `nd-live-dot ${trusted ? 'success' : status.exists ? 'warning' : 'neutral'}`;
    this.root.querySelector('#certStatusHeadline').textContent = trusted ? 'Root CA 已受信任' : status.exists ? 'Root CA 尚未受信任' : '尚未创建 Root CA';
    this.root.querySelector('#certStatusThumbprint').textContent = status.thumbprint ? status.thumbprint.slice(0, 16) + '...' : '-';
    const badge = this.root.querySelector('#certCaBadge');
    badge.className = `nd-state-badge ${trusted ? 'success' : status.exists ? 'warning' : 'neutral'}`;
    badge.textContent = trusted ? '已就绪' : status.exists ? '待导入' : '未创建';
    this.root.querySelector('#certCaFacts').innerHTML = `
      <div><span>当前用户信任库</span><b class="${status.trustedCurrentUser ? 'nd-ok' : ''}">${status.trustedCurrentUser ? '已信任' : '未信任'}</b></div>
      <div><span>本机信任库</span><b class="${status.trustedLocalMachine ? 'nd-ok' : ''}">${status.trustedLocalMachine ? '已信任' : '未信任'}</b></div>
      <div><span>有效期至</span><b>${NetworkDevUi.escape(status.validTo || '-')}</b></div>`;
    this.updateCaButton();
  },

  updateCaButton() {
    if (!this.root) return;
    const scope = this.root.querySelector('#certTrustScope').value;
    const isTrusted = scope === 'LocalMachine' ? this.status?.trustedLocalMachine : this.status?.trustedCurrentUser;
    this.root.querySelector('#certCreateCaButton span').textContent = isTrusted ? '重新导出 Root CA' : this.status?.exists ? '导入到所选信任库' : '创建并信任 Root CA';
  },

  async createCa() {
    const button = this.root.querySelector('#certCreateCaButton');
    const scope = this.root.querySelector('#certTrustScope').value;
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>处理中</span>';
    try {
      const result = await IPC.send('cert_create_root_ca', { trustScope: scope });
      this.status = result.status;
      this.lastFolder = this.status.outputDirectory;
      this.renderStatus();
      Toast.show(scope === 'LocalMachine' ? 'Root CA 已导入本机信任库' : 'Root CA 已导入当前用户信任库', 'success', 2500);
    } catch (error) {
      Toast.show('Root CA 操作失败: ' + error.message, 'error', 4000);
    } finally {
      button.innerHTML = '<i data-lucide="badge-plus"></i><span>创建并信任 Root CA</span>';
      button.disabled = !this.root.querySelector('#certTrustAcknowledgement').checked;
      this.updateCaButton();
      if (window.lucide) lucide.createIcons({ root: button });
    }
  },

  async generateCertificate() {
    const button = this.root.querySelector('#certGenerateButton');
    const commonName = this.root.querySelector('#certCommonName').value.trim();
    const sans = this.root.querySelector('#certSans').value.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    const validDays = Number(this.root.querySelector('#certValidDays').value);
    const pfxPassword = this.root.querySelector('#certPfxPassword').value;
    if (!this.status?.exists) {
      Toast.show('请先创建本地 Root CA', 'warning');
      return;
    }
    if (!sans.length || pfxPassword.length < 6) {
      Toast.show('请填写 SAN，并设置至少 6 个字符的 PFX 密码', 'warning');
      return;
    }
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>正在签发</span>';
    try {
      const result = await IPC.send('cert_generate_server', { commonName, sans, validDays, pfxPassword });
      this.lastFolder = result.folder;
      this.renderCertificateResult(result);
      this.root.querySelector('#certPfxPassword').value = '';
      Toast.show('SAN 开发证书已生成', 'success', 2500);
    } catch (error) {
      Toast.show('证书生成失败: ' + error.message, 'error', 4000);
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="key-round"></i><span>生成开发证书</span>';
      if (window.lucide) lucide.createIcons({ root: button });
    }
  },

  renderCertificateResult(result) {
    const files = [
      ['PFX', result.pfxPath, '服务器证书与私钥'],
      ['CER', result.cerPath, 'DER 编码公钥证书'],
      ['PEM', result.pemPath, 'PEM 编码公钥证书'],
      ['CHAIN', result.chainPath, '服务器证书与 Root CA 链']
    ];
    this.root.querySelector('#certResult').innerHTML = `
      <div class="cert-result-summary">
        <div class="cert-success-icon"><i data-lucide="check"></i></div>
        <div><strong>${NetworkDevUi.escape(result.commonName)}</strong><span>${NetworkDevUi.escape(result.validFrom)} → ${NetworkDevUi.escape(result.validTo)}</span></div>
        <div class="cert-san-chips">${result.sans.map(san => `<span>${NetworkDevUi.escape(san.type)} · ${NetworkDevUi.escape(san.value)}</span>`).join('')}</div>
      </div>
      <div class="cert-file-list">
        ${files.map(([type, path, desc]) => `
          <div class="cert-file-row">
            <span class="cert-file-type">${type}</span>
            <div><b class="font-mono">${NetworkDevUi.escape(path)}</b><span>${desc}</span></div>
            <button class="nd-icon-button cert-copy-path" data-path="${NetworkDevUi.escape(path)}" title="复制路径"><i data-lucide="copy"></i></button>
          </div>`).join('')}
      </div>`;
    this.root.querySelectorAll('.cert-copy-path').forEach(button => button.onclick = () => NetworkDevUi.copy(button.dataset.path, '文件路径'));
    if (window.lucide) lucide.createIcons({ root: this.root.querySelector('#certResult') });
  },

  async openFolder(path) {
    try { await IPC.send('cert_open_folder', { path }); } catch (error) { Toast.show('无法打开目录: ' + error.message, 'error'); }
  }
};

const DnsDeepDiagnosticTool = {
  root: null,
  activeTab: 'records',
  result: null,

  render(container) {
    this.root = container;
    container.innerHTML = `
      <div class="nd-shell dns-tool-shell">
        <div class="nd-querybar">
          <div class="nd-query-input-wrap"><i data-lucide="globe-2"></i><input id="dnsDeepName" class="nd-query-input font-mono" value="example.com" placeholder="域名或 DNS 名称" spellcheck="false"></div>
          <select id="dnsDeepType" class="nd-query-select" aria-label="记录类型">
            <option value="A">A</option><option value="AAAA">AAAA</option><option value="CNAME">CNAME</option><option value="MX">MX</option><option value="TXT">TXT</option><option value="NS">NS</option><option value="SOA">SOA</option><option value="SRV">SRV</option><option value="CAA">CAA</option><option value="ALL">全部记录</option>
          </select>
          <button class="nd-primary-button" id="dnsDeepRun"><i data-lucide="scan-search"></i><span>开始诊断</span></button>
        </div>

        <div class="dns-summary-strip" id="dnsSummaryStrip">
          <div><span>系统记录</span><b>-</b></div><div><span>公共 DNS</span><b>-</b></div><div><span>DoH 可用</span><b>-</b></div><div><span>结果一致性</span><b>-</b></div>
        </div>

        <section class="nd-panel dns-result-panel">
          <header class="nd-panel-header dns-tabs-header">
            <div class="nd-tabs" role="tablist">
              <button class="nd-tab active" data-dns-tab="records">完整记录</button>
              <button class="nd-tab" data-dns-tab="compare">公共 DNS 对比</button>
              <button class="nd-tab" data-dns-tab="doh">DoH 探测</button>
            </div>
            <span class="nd-muted" id="dnsDiagnosedAt">尚未诊断</span>
          </header>
          <div class="dns-tab-content" id="dnsTabContent">${NetworkDevUi.empty('network', '等待 DNS 诊断', '将同时查询系统解析器、四个公共 DNS 与三个 DoH 端点')}</div>
        </section>
      </div>`;
    this.bindEvents();
    if (window.lucide) lucide.createIcons({ root: container });
  },

  bindEvents() {
    this.root.querySelector('#dnsDeepRun').onclick = () => this.run();
    this.root.querySelector('#dnsDeepName').onkeydown = event => { if (event.key === 'Enter') this.run(); };
    this.root.querySelectorAll('[data-dns-tab]').forEach(button => button.onclick = () => this.switchTab(button.dataset.dnsTab));
  },

  switchTab(tab) {
    this.activeTab = tab;
    this.root.querySelectorAll('[data-dns-tab]').forEach(button => button.classList.toggle('active', button.dataset.dnsTab === tab));
    this.renderActiveTab();
  },

  async run() {
    const name = this.root.querySelector('#dnsDeepName').value.trim();
    const recordType = this.root.querySelector('#dnsDeepType').value;
    if (!name) { Toast.show('请输入 DNS 名称', 'warning'); return; }
    const button = this.root.querySelector('#dnsDeepRun');
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>诊断中</span>';
    this.root.querySelector('#dnsTabContent').innerHTML = NetworkDevUi.loading(`正在对比 ${name} 的 DNS 与 DoH 响应`);
    try {
      this.result = await IPC.send('net_dns_deep_diagnostic', { name, recordType });
      this.renderSummary();
      this.renderActiveTab();
    } catch (error) {
      this.result = null;
      const cancelled = Boolean(error.cancelled);
      this.root.querySelector('#dnsTabContent').innerHTML = NetworkDevUi.empty(cancelled ? 'circle-slash-2' : 'circle-x', cancelled ? 'DNS 诊断已取消' : 'DNS 诊断失败', cancelled ? '' : error.message);
      Toast.show(cancelled ? 'DNS 诊断已取消' : 'DNS 诊断失败: ' + error.message, cancelled ? 'info' : 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="scan-search"></i><span>开始诊断</span>';
      if (window.lucide) lucide.createIcons({ root: this.root });
    }
  },

  renderSummary() {
    const result = this.result;
    const providers = result.comparison.providers || [];
    const doh = result.doh || [];
    const consistent = !result.comparison.mismatch;
    this.root.querySelector('#dnsSummaryStrip').innerHTML = `
      <div><span>系统记录</span><b>${result.records.length}</b></div>
      <div><span>公共 DNS</span><b>${providers.filter(item => item.success).length} / ${providers.length}</b></div>
      <div><span>DoH 可用</span><b>${doh.filter(item => item.success).length} / ${doh.length}</b></div>
      <div><span>结果一致性</span><b class="${consistent ? 'nd-ok' : 'nd-warn'}">${consistent ? '一致' : '存在分歧'}</b></div>`;
    this.root.querySelector('#dnsDiagnosedAt').textContent = result.diagnosedAt;
  },

  renderActiveTab() {
    if (!this.result) return;
    if (this.activeTab === 'compare') this.renderComparison();
    else if (this.activeTab === 'doh') this.renderDoh();
    else this.renderRecords();
  },

  renderRecords() {
    const records = this.result.records || [];
    const errors = this.result.recordErrors || [];
    const mount = this.root.querySelector('#dnsTabContent');
    mount.innerHTML = `
      ${records.length ? `<div class="nd-table-wrap"><table class="nd-table"><thead><tr><th>名称</th><th>类型</th><th>TTL</th><th>记录值</th></tr></thead><tbody>${records.map(record => `<tr><td class="font-mono">${NetworkDevUi.escape(record.name)}</td><td><span class="dns-type-badge">${NetworkDevUi.escape(record.type)}</span></td><td class="font-mono">${record.ttl}</td><td class="font-mono dns-value-cell">${NetworkDevUi.escape(record.value)}</td></tr>`).join('')}</tbody></table></div>` : NetworkDevUi.empty('database-zap', '没有返回记录')}
      ${errors.length ? `<div class="dns-error-list">${errors.map(item => `<span><b>${NetworkDevUi.escape(item.type)}</b>${NetworkDevUi.escape(item.error)}</span>`).join('')}</div>` : ''}`;
    if (window.lucide) lucide.createIcons({ root: mount });
  },

  renderComparison() {
    const data = this.result.comparison;
    const mount = this.root.querySelector('#dnsTabContent');
    mount.innerHTML = `
      <div class="dns-diagnosis ${data.mismatch ? 'warning' : 'success'}">
        <i data-lucide="${data.mismatch ? 'triangle-alert' : 'shield-check'}"></i>
        <div><strong>${data.mismatch ? '公共 DNS 返回结果存在分歧' : '公共 DNS 返回结果一致'}</strong><span>${data.respondingCount} 个解析器响应，主流结果由 ${data.consensusCount} 个解析器共同返回</span></div>
      </div>
      <div class="dns-provider-list">
        ${data.providers.map(provider => `
          <div class="dns-provider-row">
            <span class="nd-live-dot ${provider.success ? 'success' : 'danger'}"></span>
            <div class="dns-provider-name"><strong>${NetworkDevUi.escape(provider.name)}</strong><span class="font-mono">${NetworkDevUi.escape(provider.server)}</span></div>
            <div class="dns-answer-list">${provider.success ? provider.answers.map(answer => `<span class="font-mono">${NetworkDevUi.escape(answer)}</span>`).join('') : `<em>${NetworkDevUi.escape(provider.error || '无响应')}</em>`}</div>
            <b class="dns-latency font-mono">${provider.latencyMs} ms</b>
          </div>`).join('')}
      </div>`;
    if (window.lucide) lucide.createIcons({ root: mount });
  },

  renderDoh() {
    const mount = this.root.querySelector('#dnsTabContent');
    mount.innerHTML = `<div class="doh-grid">${this.result.doh.map(provider => `
      <section class="doh-provider">
        <header><div><span class="nd-live-dot ${provider.success ? 'success' : 'danger'}"></span><strong>${NetworkDevUi.escape(provider.name)}</strong></div><b class="font-mono">${provider.latencyMs} ms</b></header>
        <span class="doh-endpoint font-mono">${NetworkDevUi.escape(provider.endpoint)}</span>
        <div class="doh-answer-list">${provider.success && provider.answers.length ? provider.answers.map(answer => `<div><span class="dns-type-badge">${NetworkDevUi.escape(answer.type)}</span><b class="font-mono">${NetworkDevUi.escape(answer.value)}</b><em>TTL ${answer.ttl}</em></div>`).join('') : `<div class="nd-muted">${NetworkDevUi.escape(provider.error || `DNS Status ${provider.status}`)}</div>`}</div>
      </section>`).join('')}</div>`;
    if (window.lucide) lucide.createIcons({ root: mount });
  }
};

const IpWhoisIntelligenceTool = {
  root: null,

  render(container) {
    this.root = container;
    container.innerHTML = `
      <div class="nd-shell intel-tool-shell">
        <div class="nd-querybar">
          <div class="nd-query-input-wrap"><i data-lucide="crosshair"></i><input id="intelTarget" class="nd-query-input font-mono" value="1.1.1.1" placeholder="IP 地址或域名" spellcheck="false"></div>
          <div class="nd-quick-targets"><button data-intel-target="1.1.1.1">Cloudflare</button><button data-intel-target="8.8.8.8">Google DNS</button><button data-intel-target="example.com">示例域名</button></div>
          <button class="nd-primary-button" id="intelRun"><i data-lucide="search"></i><span>查询情报</span></button>
        </div>
        <div class="intel-result" id="intelResult">${NetworkDevUi.empty('map-pinned', '等待 IP / Whois 查询', '查询结果将聚合 GeoIP、RIPE BGP 与 RDAP 数据')}</div>
      </div>`;
    this.bindEvents();
    if (window.lucide) lucide.createIcons({ root: container });
  },

  bindEvents() {
    this.root.querySelector('#intelRun').onclick = () => this.run();
    this.root.querySelector('#intelTarget').onkeydown = event => { if (event.key === 'Enter') this.run(); };
    this.root.querySelectorAll('[data-intel-target]').forEach(button => button.onclick = () => {
      this.root.querySelector('#intelTarget').value = button.dataset.intelTarget;
      this.run();
    });
  },

  async run() {
    const target = this.root.querySelector('#intelTarget').value.trim();
    if (!target) { Toast.show('请输入 IP 地址或域名', 'warning'); return; }
    const button = this.root.querySelector('#intelRun');
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>查询中</span>';
    this.root.querySelector('#intelResult').innerHTML = NetworkDevUi.loading(`正在聚合 ${target} 的网络与注册情报`);
    try {
      const result = await IPC.send('net_intel_lookup', { target });
      this.renderResult(result);
    } catch (error) {
      const cancelled = Boolean(error.cancelled);
      this.root.querySelector('#intelResult').innerHTML = NetworkDevUi.empty(cancelled ? 'circle-slash-2' : 'circle-x', cancelled ? '情报查询已取消' : '情报查询失败', cancelled ? '' : error.message);
      Toast.show(cancelled ? '情报查询已取消' : '查询失败: ' + error.message, cancelled ? 'info' : 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="search"></i><span>查询情报</span>';
      if (window.lucide) lucide.createIcons({ root: this.root });
    }
  },

  classificationLabel(code) {
    return ({ private: '内网 / 保留地址', proxy: '代理 / VPN', cdn: 'CDN 节点', datacenter: '机房 / 数据中心', residential: '家宽 / 运营商', unknown: '未知网络类型' })[code] || code;
  },

  renderResult(result) {
    const geo = result.geo;
    const network = result.network || {};
    const rdap = result.domainRdap || result.networkRdap;
    const classification = result.classification || { code: 'unknown', confidence: 'low', reasons: [] };
    const hasCoordinates = geo && Number.isFinite(Number(geo.latitude)) && Number.isFinite(Number(geo.longitude));
    let mapHtml = NetworkDevUi.empty('map-off', '没有可用的地理坐标');
    if (hasCoordinates) {
      const lat = Number(geo.latitude);
      const lon = Number(geo.longitude);
      const bbox = `${lon - 0.18},${lat - 0.12},${lon + 0.18},${lat + 0.12}`;
      const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
      mapHtml = `<iframe class="intel-map" src="${mapUrl}" title="IP 地理位置地图" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
    }

    const rdapRows = rdap ? (rdap.kind === 'domain' ? [
      ['注册商', rdap.registrar], ['创建时间', NetworkDevUi.formatDate(rdap.registeredAt)], ['到期时间', NetworkDevUi.formatDate(rdap.expiresAt)], ['最后变更', NetworkDevUi.formatDate(rdap.changedAt)], ['DNSSEC', rdap.dnssec ? '已签名' : '未签名'], ['名称服务器', (rdap.nameservers || []).join(', ')]
    ] : [
      ['网络名称', rdap.name], ['地址范围', `${rdap.startAddress || '-'} - ${rdap.endAddress || '-'}`], ['分配类型', rdap.type], ['国家/地区', rdap.country], ['最后变更', NetworkDevUi.formatDate(rdap.changedAt)], ['状态', (rdap.status || []).join(', ')]
    ]) : [];

    this.root.querySelector('#intelResult').innerHTML = `
      <section class="intel-hero">
        <div class="intel-primary">
          <span>${result.queryType === 'domain' ? NetworkDevUi.escape(result.domain) : 'IP Intelligence'}</span>
          <strong class="font-mono">${NetworkDevUi.escape(result.primaryIp)}</strong>
          <div class="intel-ip-chips">${result.resolvedIps.map(ip => `<button class="font-mono" data-copy-ip="${NetworkDevUi.escape(ip)}">${NetworkDevUi.escape(ip)}</button>`).join('')}</div>
        </div>
        <div class="intel-hero-metrics">
          <div><span>网络类型</span><b class="intel-classification ${NetworkDevUi.escape(classification.code)}">${NetworkDevUi.escape(this.classificationLabel(classification.code))}</b><em>${NetworkDevUi.escape(classification.confidence)} confidence</em></div>
          <div><span>ASN</span><b class="font-mono">${network.asn ? `AS${network.asn}` : '-'}</b><em>${NetworkDevUi.escape(network.prefix || '无 BGP 前缀')}</em></div>
          <div><span>位置</span><b>${geo ? NetworkDevUi.escape(`${geo.country || ''} ${geo.city || ''}`.trim()) : '-'}</b><em>${geo ? NetworkDevUi.escape(geo.timezone || '') : ''}</em></div>
        </div>
      </section>

      <div class="intel-grid">
        <section class="nd-panel intel-map-panel">
          <header class="nd-panel-header"><div><i data-lucide="map"></i><span>地理位置</span></div>${geo ? `<span class="nd-muted font-mono">${geo.latitude}, ${geo.longitude}</span>` : ''}</header>
          <div class="intel-map-wrap">${mapHtml}</div>
          ${geo ? `<div class="intel-geo-line"><span>${NetworkDevUi.escape(geo.country || '-')}</span><span>${NetworkDevUi.escape(geo.region || '-')}</span><span>${NetworkDevUi.escape(geo.city || '-')}</span><span>${NetworkDevUi.escape(geo.postal || '-')}</span></div>` : ''}
        </section>

        <section class="nd-panel intel-network-panel">
          <header class="nd-panel-header"><div><i data-lucide="network"></i><span>ASN / BGP 情报</span></div><span class="nd-state-badge ${network.announced ? 'success' : 'neutral'}">${network.announced ? '已宣告' : '未确认宣告'}</span></header>
          <div class="intel-detail-list">
            <div><span>运营组织</span><b>${NetworkDevUi.escape(network.organization || network.holder || '-')}</b></div>
            <div><span>ISP</span><b>${NetworkDevUi.escape(network.isp || '-')}</b></div>
            <div><span>网络域名</span><b class="font-mono">${NetworkDevUi.escape(network.domain || '-')}</b></div>
            <div><span>BGP 前缀</span><b class="font-mono">${NetworkDevUi.escape(network.prefix || '-')}</b></div>
          </div>
          <div class="intel-heuristic"><strong>类型判断依据</strong>${(classification.reasons || []).map(reason => `<span><i data-lucide="binary"></i>${NetworkDevUi.escape(reason)}</span>`).join('')}</div>
        </section>

        <section class="nd-panel intel-rdap-panel">
          <header class="nd-panel-header"><div><i data-lucide="contact-round"></i><span>${rdap?.kind === 'domain' ? '域名 RDAP / Whois' : 'IP 网络 RDAP / Whois'}</span></div>${rdap ? `<span class="nd-muted font-mono">${NetworkDevUi.escape(rdap.handle || '')}</span>` : ''}</header>
          ${rdapRows.length ? `<div class="intel-rdap-list">${rdapRows.map(([label, value]) => `<div><span>${label}</span><b>${NetworkDevUi.escape(value || '-')}</b></div>`).join('')}</div>` : NetworkDevUi.empty('file-question', '没有可用的 RDAP 数据')}
        </section>
      </div>
      ${result.sourceErrors?.length ? `<div class="intel-source-errors"><i data-lucide="triangle-alert"></i><span>${result.sourceErrors.map(item => `${NetworkDevUi.escape(item.source)} 暂不可用`).join(' · ')}</span></div>` : ''}`;

    this.root.querySelectorAll('[data-copy-ip]').forEach(button => button.onclick = () => NetworkDevUi.copy(button.dataset.copyIp, ' IP'));
    if (window.lucide) lucide.createIcons({ root: this.root.querySelector('#intelResult') });
  }
};
