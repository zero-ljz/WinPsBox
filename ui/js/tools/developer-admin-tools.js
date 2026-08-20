const DeveloperToolUi = {
  escape(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },

  loading(label) {
    return `<div class="dev-empty"><span class="spinner-border spinner-border-sm"></span><strong>${this.escape(label)}</strong></div>`;
  },

  empty(icon, title, detail = '') {
    return `<div class="dev-empty"><i data-lucide="${icon}"></i><strong>${this.escape(title)}</strong>${detail ? `<span>${this.escape(detail)}</span>` : ''}</div>`;
  },

  async copy(text, label = '内容') {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      Toast.show(`已复制${label}`, 'success', 1400);
    } catch (_) {
      Toast.show('复制失败', 'error');
    }
  }
};

const DiagnosticReportTool = {
  root: null,
  report: null,

  render(container) {
    this.root = container;
    this.report = null;
    container.innerHTML = `
      <div class="dev-tool-shell diagnostic-center">
        <div class="dev-command-bar">
          <div class="dev-input-group grow">
            <label for="diagTarget">诊断目标</label>
            <input id="diagTarget" class="dev-input font-mono" value="www.microsoft.com" spellcheck="false">
          </div>
          <button class="dev-primary-button" id="diagRun"><i data-lucide="stethoscope"></i><span>开始诊断</span></button>
          <div class="dev-menu-group">
            <button class="dev-secondary-button" id="diagExportMd" disabled><i data-lucide="file-text"></i><span>Markdown</span></button>
            <button class="dev-icon-button" id="diagExportJson" title="导出 JSON" disabled><i data-lucide="braces"></i></button>
          </div>
        </div>

        <div class="diag-summary" id="diagSummary">
          <div class="diag-metric pass"><i data-lucide="circle-check"></i><div><b>-</b><span>通过</span></div></div>
          <div class="diag-metric warn"><i data-lucide="triangle-alert"></i><div><b>-</b><span>提醒</span></div></div>
          <div class="diag-metric error"><i data-lucide="circle-x"></i><div><b>-</b><span>异常</span></div></div>
          <div class="diag-meta" id="diagMeta"><span>尚未运行诊断</span></div>
        </div>

        <section class="dev-panel">
          <header class="dev-panel-header">
            <div><i data-lucide="list-checks"></i><strong>检查结果</strong></div>
            <span class="dev-state-badge neutral" id="diagState">等待运行</span>
          </header>
          <div class="diag-results" id="diagResults">
            ${DeveloperToolUi.empty('clipboard-check', '等待诊断结果')}
          </div>
        </section>
      </div>`;

    container.querySelector('#diagRun').onclick = () => this.run();
    container.querySelector('#diagExportMd').onclick = () => this.exportReport('markdown');
    container.querySelector('#diagExportJson').onclick = () => this.exportReport('json');
    container.querySelector('#diagTarget').onkeydown = event => { if (event.key === 'Enter') this.run(); };
    if (window.lucide) lucide.createIcons({ root: container });
  },

  async run() {
    const target = this.root.querySelector('#diagTarget').value.trim();
    const button = this.root.querySelector('#diagRun');
    const results = this.root.querySelector('#diagResults');
    this.report = null;
    this.root.querySelectorAll('.diag-metric b').forEach(metric => { metric.textContent = '-'; });
    this.root.querySelector('#diagMeta').innerHTML = '<span>诊断运行中</span>';
    this.root.querySelector('#diagExportMd').disabled = true;
    this.root.querySelector('#diagExportJson').disabled = true;
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>正在检查</span>';
    results.innerHTML = DeveloperToolUi.loading('正在检查系统与网络状态');
    this.root.querySelector('#diagState').textContent = '运行中';
    this.root.querySelector('#diagState').className = 'dev-state-badge info';
    try {
      this.report = await IPC.send('diag_run', { target });
      this.renderReport();
      this.root.querySelector('#diagExportMd').disabled = false;
      this.root.querySelector('#diagExportJson').disabled = false;
    } catch (error) {
      const cancelled = Boolean(error.cancelled);
      results.innerHTML = DeveloperToolUi.empty(cancelled ? 'circle-slash-2' : 'circle-x', cancelled ? '诊断已取消' : '诊断运行失败', cancelled ? '' : error.message);
      this.root.querySelector('#diagState').textContent = cancelled ? '已取消' : '失败';
      this.root.querySelector('#diagState').className = `dev-state-badge ${cancelled ? 'neutral' : 'error'}`;
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="stethoscope"></i><span>重新诊断</span>';
      if (window.lucide) lucide.createIcons({ root: this.root });
    }
  },

  renderReport() {
    const summary = this.report.summary || {};
    const metrics = this.root.querySelectorAll('.diag-metric b');
    metrics[0].textContent = summary.pass ?? 0;
    metrics[1].textContent = summary.warn ?? 0;
    metrics[2].textContent = summary.error ?? 0;
    this.root.querySelector('#diagMeta').innerHTML = `
      <strong>${DeveloperToolUi.escape(this.report.computerName)}</strong>
      <span>${DeveloperToolUi.escape(this.report.generatedAt)} · ${Number(this.report.durationMs || 0)} ms</span>`;
    const healthy = Number(summary.error || 0) === 0;
    const state = this.root.querySelector('#diagState');
    state.textContent = healthy ? (Number(summary.warn || 0) ? '需要留意' : '状态良好') : '发现异常';
    state.className = `dev-state-badge ${healthy ? (Number(summary.warn || 0) ? 'warn' : 'pass') : 'error'}`;

    this.root.querySelector('#diagResults').innerHTML = (this.report.checks || []).map(check => `
      <article class="diag-check ${DeveloperToolUi.escape(check.status)}">
        <div class="diag-check-icon"><i data-lucide="${check.status === 'pass' ? 'check' : check.status === 'warn' ? 'alert-triangle' : 'x'}"></i></div>
        <div class="diag-check-body">
          <div><strong>${DeveloperToolUi.escape(check.name)}</strong><span>${DeveloperToolUi.escape(check.summary)}</span></div>
          ${check.detail ? `<p>${DeveloperToolUi.escape(check.detail)}</p>` : ''}
        </div>
        <span class="diag-check-status">${check.status === 'pass' ? '通过' : check.status === 'warn' ? '提醒' : '异常'}</span>
      </article>`).join('');
    if (window.lucide) lucide.createIcons({ root: this.root });
  },

  async exportReport(format) {
    if (!this.report) return;
    try {
      const result = await IPC.send('diag_export', { report: this.report, format });
      Toast.show(`报告已保存：${result.filePath}`, 'success', 4200);
    } catch (error) {
      Toast.show('导出失败: ' + error.message, 'error', 3500);
    }
  }
};

const OpenSshManagerTool = {
  root: null,
  state: null,

  render(container) {
    this.root = container;
    container.innerHTML = `
      <div class="dev-tool-shell ssh-manager">
        <div class="dev-command-bar">
          <div class="dev-title-status"><span class="dev-live-dot neutral" id="sshDot"></span><div><strong id="sshHeadline">正在读取 OpenSSH 状态</strong><span id="sshSubline">-</span></div></div>
          <button class="dev-icon-button" id="sshRefresh" title="刷新状态"><i data-lucide="refresh-cw"></i></button>
        </div>

        <div class="dev-two-column">
          <section class="dev-panel">
            <header class="dev-panel-header"><div><i data-lucide="package-check"></i><strong>组件与服务</strong></div><span class="dev-state-badge neutral" id="sshPrivilege">检测中</span></header>
            <div class="component-list" id="sshComponents">${DeveloperToolUi.loading('读取 Windows 功能')}</div>
            <div class="service-actions" id="sshServiceActions"></div>
          </section>

          <section class="dev-panel">
            <header class="dev-panel-header"><div><i data-lucide="key-round"></i><strong>生成密钥</strong></div><button class="dev-text-button" id="sshOpenFolder"><i data-lucide="folder-open"></i>打开目录</button></header>
            <div class="ssh-key-form">
              <select class="dev-select" id="sshAlgorithm"><option value="ed25519">ED25519</option><option value="rsa">RSA 4096</option></select>
              <input class="dev-input font-mono" id="sshKeyName" value="id_ed25519" maxlength="64" spellcheck="false">
              <input class="dev-input" id="sshKeyComment" placeholder="注释（可选）" maxlength="120">
              <button class="dev-primary-button" id="sshGenerate"><i data-lucide="key"></i><span>生成</span></button>
            </div>
          </section>
        </div>

        <section class="dev-panel">
          <header class="dev-panel-header"><div><i data-lucide="fingerprint"></i><strong>用户密钥</strong></div><span class="dev-state-badge neutral" id="sshKeyCount">0 个</span></header>
          <div class="ssh-key-list" id="sshKeys">${DeveloperToolUi.loading('扫描 .ssh 目录')}</div>
        </section>

        <section class="dev-panel">
          <header class="dev-panel-header"><div><i data-lucide="plug-zap"></i><strong>连接检查</strong></div><span class="dev-state-badge neutral" id="sshTestState">未测试</span></header>
          <div class="ssh-test-row">
            <input class="dev-input" id="sshTestHost" placeholder="主机名或 IP" spellcheck="false">
            <input class="dev-input" id="sshTestUser" placeholder="用户名（可选）" spellcheck="false">
            <input class="dev-input font-mono compact" id="sshTestPort" type="number" min="1" max="65535" value="22">
            <button class="dev-secondary-button" id="sshTest"><i data-lucide="radio"></i><span>测试</span></button>
          </div>
          <div class="ssh-test-result d-none" id="sshTestResult"></div>
        </section>
      </div>`;

    container.querySelector('#sshRefresh').onclick = () => this.load();
    container.querySelector('#sshOpenFolder').onclick = () => this.openFolder();
    container.querySelector('#sshGenerate').onclick = () => this.generateKey();
    container.querySelector('#sshAlgorithm').onchange = event => {
      const name = container.querySelector('#sshKeyName');
      if (/^id_(ed25519|rsa)$/.test(name.value)) name.value = `id_${event.target.value}`;
    };
    container.querySelector('#sshTest').onclick = () => this.testEndpoint();
    container.querySelector('#sshComponents').onclick = event => {
      const install = event.target.closest('[data-ssh-install]');
      if (install) this.install(install.dataset.sshInstall, install);
    };
    container.querySelector('#sshServiceActions').onclick = event => {
      const action = event.target.closest('[data-ssh-service]');
      if (action) this.serviceAction(action.dataset.sshService, action);
    };
    container.querySelector('#sshKeys').onclick = event => {
      const copy = event.target.closest('[data-ssh-copy]');
      if (copy) this.copyPublicKey(copy.dataset.sshCopy);
    };
    this.load();
    if (window.lucide) lucide.createIcons({ root: container });
  },

  async load() {
    try {
      this.state = await IPC.send('ssh_get_status');
      if (!this.root?.querySelector('#sshHeadline')) return;
      this.renderState();
    } catch (error) {
      if (!this.root?.querySelector('#sshHeadline')) return;
      this.root.querySelector('#sshHeadline').textContent = '读取 OpenSSH 状态失败';
      this.root.querySelector('#sshSubline').textContent = error.message;
    }
  },

  renderState() {
    if (!this.state || !this.root?.querySelector('#sshHeadline')) return;
    const available = this.state.sshAvailable;
    this.root.querySelector('#sshDot').className = `dev-live-dot ${available ? 'pass' : 'warn'}`;
    this.root.querySelector('#sshHeadline').textContent = available ? 'OpenSSH 客户端可用' : 'OpenSSH 客户端未安装';
    this.root.querySelector('#sshSubline').textContent = available ? this.state.sshPath : '可通过 Windows 可选功能安装';
    const privilege = this.root.querySelector('#sshPrivilege');
    privilege.textContent = this.state.isAdmin ? '管理员模式' : '普通模式';
    privilege.className = `dev-state-badge ${this.state.isAdmin ? 'pass' : 'neutral'}`;

    const componentRow = (title, state, component, icon) => `
      <div class="component-row">
        <i data-lucide="${icon}"></i><div><strong>${title}</strong><span>${DeveloperToolUi.escape(state)}</span></div>
        ${String(state).toLowerCase().includes('installed') ? '<span class="component-ok"><i data-lucide="check"></i></span>' : `<button class="dev-text-button" data-ssh-install="${component}">安装</button>`}
      </div>`;
    this.root.querySelector('#sshComponents').innerHTML =
      componentRow('OpenSSH Client', this.state.clientState, 'client', 'terminal') +
      componentRow('OpenSSH Server', this.state.serverState, 'server', 'server');

    const service = this.root.querySelector('#sshServiceActions');
    if (!this.state.serviceInstalled) {
      service.innerHTML = DeveloperToolUi.empty('server-off', 'sshd 服务尚未安装');
    } else {
      const running = this.state.serviceStatus === 'Running';
      service.innerHTML = `
        <div class="service-state-line"><span><i data-lucide="${running ? 'circle-play' : 'circle-stop'}"></i>sshd</span><strong>${DeveloperToolUi.escape(this.state.serviceStatus)} · ${DeveloperToolUi.escape(this.state.serviceStartType)}</strong></div>
        <div class="service-button-row">
          <button class="dev-secondary-button" data-ssh-service="${running ? 'restart' : 'start'}"><i data-lucide="${running ? 'refresh-cw' : 'play'}"></i><span>${running ? '重启' : '启动'}</span></button>
          <button class="dev-secondary-button" data-ssh-service="${running ? 'stop' : 'enable'}"><i data-lucide="${running ? 'square' : 'power'}"></i><span>${running ? '停止' : '启用'}</span></button>
        </div>`;
    }

    const keys = this.state.keys || [];
    this.root.querySelector('#sshKeyCount').textContent = `${keys.length} 个`;
    this.root.querySelector('#sshKeys').innerHTML = keys.length ? keys.map(key => `
      <div class="ssh-key-row">
        <div class="ssh-key-icon"><i data-lucide="key-square"></i></div>
        <div class="ssh-key-info"><strong>${DeveloperToolUi.escape(key.name)}</strong><span class="font-mono">${DeveloperToolUi.escape(key.fingerprint || '暂无指纹')}</span><small>${DeveloperToolUi.escape(key.modifiedAt)} · ${key.privateExists ? '私钥存在' : '仅公钥'}</small></div>
        <button class="dev-icon-button" data-ssh-copy="${DeveloperToolUi.escape(key.name)}" title="复制公钥"><i data-lucide="copy"></i></button>
      </div>`).join('') : DeveloperToolUi.empty('key', '尚未发现用户密钥');
    if (window.lucide) lucide.createIcons({ root: this.root });
  },

  async install(component, button) {
    if (!this.state?.isAdmin) {
      Toast.show('安装 Windows 可选功能需要管理员权限，正在请求管理员模式重启...', 'info', 3000);
      await PrivilegeManager.requestElevation();
      return;
    }
    button.disabled = true;
    try {
      const result = await IPC.send('ssh_install_capability', { component });
      Toast.show(result.restartNeeded ? '安装完成，需要重启 Windows' : 'OpenSSH 组件安装完成', 'success', 3500);
      await this.load();
    } catch (error) {
      Toast.show(error.cancelled ? 'OpenSSH 组件安装已取消' : '安装失败: ' + error.message, error.cancelled ? 'info' : 'error', 4000);
    } finally { button.disabled = false; }
  },

  async serviceAction(serviceAction, button) {
    if (!this.state?.isAdmin) {
      Toast.show('管理 sshd 服务需要管理员权限，正在请求管理员模式重启...', 'info', 3000);
      await PrivilegeManager.requestElevation();
      return;
    }
    button.disabled = true;
    try {
      await IPC.send('ssh_service_action', { serviceAction });
      Toast.show('sshd 服务状态已更新', 'success');
      await this.load();
    } catch (error) { Toast.show('服务操作失败: ' + error.message, 'error'); }
    finally { button.disabled = false; }
  },

  async generateKey() {
    const button = this.root.querySelector('#sshGenerate');
    const keyName = this.root.querySelector('#sshKeyName').value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyName) || keyName.includes('..')) {
      Toast.show('密钥名称仅允许字母、数字、点、下划线和连字符，且不能包含连续点', 'warning');
      return;
    }
    button.disabled = true;
    try {
      const result = await IPC.send('ssh_generate_key', {
        algorithm: this.root.querySelector('#sshAlgorithm').value,
        keyName,
        comment: this.root.querySelector('#sshKeyComment').value.trim()
      });
      Toast.show(`密钥已生成：${result.publicPath}`, 'success', 3500);
      await this.load();
    } catch (error) { Toast.show('生成失败: ' + error.message, 'error', 3500); }
    finally { button.disabled = false; }
  },

  async copyPublicKey(keyName) {
    try {
      const result = await IPC.send('ssh_read_public_key', { keyName });
      await DeveloperToolUi.copy(result.content, '公钥');
    } catch (error) { Toast.show('读取公钥失败: ' + error.message, 'error'); }
  },

  async openFolder() {
    try { await IPC.send('ssh_open_folder'); } catch (error) { Toast.show(error.message, 'error'); }
  },

  async testEndpoint() {
    const state = this.root.querySelector('#sshTestState');
    const resultBox = this.root.querySelector('#sshTestResult');
    state.textContent = '测试中';
    state.className = 'dev-state-badge info';
    try {
      const result = await IPC.send('ssh_test_endpoint', {
        host: this.root.querySelector('#sshTestHost').value.trim(),
        user: this.root.querySelector('#sshTestUser').value.trim(),
        port: Number(this.root.querySelector('#sshTestPort').value)
      });
      state.textContent = result.reachable ? '可连接' : '不可连接';
      state.className = `dev-state-badge ${result.reachable ? 'pass' : 'error'}`;
      const config = Object.entries(result.effective || {}).map(([key, value]) => `<span><b>${DeveloperToolUi.escape(key)}</b>${DeveloperToolUi.escape(value)}</span>`).join('');
      resultBox.innerHTML = `<strong>${result.reachable ? `${result.latencyMs} ms` : DeveloperToolUi.escape(result.error || '连接失败')}</strong>${config ? `<div>${config}</div>` : ''}`;
      resultBox.classList.remove('d-none');
    } catch (error) {
      state.textContent = '测试失败';
      state.className = 'dev-state-badge error';
      resultBox.textContent = error.message;
      resultBox.classList.remove('d-none');
    }
  }
};

const WslManagerTool = {
  root: null,
  state: null,

  render(container) {
    this.root = container;
    container.innerHTML = `
      <div class="dev-tool-shell wsl-manager">
        <div class="dev-command-bar">
          <div class="dev-title-status"><span class="dev-live-dot neutral" id="wslDot"></span><div><strong id="wslHeadline">正在读取 WSL 状态</strong><span id="wslSubline">-</span></div></div>
          <button class="dev-secondary-button" id="wslUpdate"><i data-lucide="download"></i><span>更新 WSL</span></button>
          <button class="dev-icon-button" id="wslRefresh" title="刷新状态"><i data-lucide="refresh-cw"></i></button>
        </div>

        <div class="wsl-facts" id="wslFacts"></div>
        <section class="dev-panel">
          <header class="dev-panel-header"><div><i data-lucide="boxes"></i><strong>已安装发行版</strong></div><button class="dev-secondary-button compact-button" id="wslShutdown"><i data-lucide="power"></i><span>全部关闭</span></button></header>
          <div class="wsl-distro-list" id="wslDistros">${DeveloperToolUi.loading('读取发行版')}</div>
        </section>

        <section class="dev-panel">
          <header class="dev-panel-header"><div><i data-lucide="package-plus"></i><strong>安装发行版</strong></div><button class="dev-text-button" id="wslLoadOnline"><i data-lucide="cloud-download"></i>读取在线列表</button></header>
          <div class="wsl-install-row">
            <input class="dev-input font-mono" id="wslInstallName" list="wslOnlineList" placeholder="例如 Ubuntu-24.04" spellcheck="false">
            <datalist id="wslOnlineList"></datalist>
            <button class="dev-primary-button" id="wslInstall"><i data-lucide="download"></i><span>安装</span></button>
          </div>
          <div class="wsl-online-list d-none" id="wslOnline"></div>
        </section>
      </div>`;
    container.querySelector('#wslRefresh').onclick = () => this.load();
    container.querySelector('#wslUpdate').onclick = () => this.action('update');
    container.querySelector('#wslShutdown').onclick = () => this.action('shutdown');
    container.querySelector('#wslInstall').onclick = () => this.action('install', container.querySelector('#wslInstallName').value.trim());
    container.querySelector('#wslLoadOnline').onclick = () => this.loadOnline();
    container.querySelector('#wslDistros').onclick = event => {
      const button = event.target.closest('[data-wsl-action]');
      if (button) this.action(button.dataset.wslAction, button.dataset.wslDistro);
    };
    this.load();
    if (window.lucide) lucide.createIcons({ root: container });
  },

  async load() {
    try {
      this.state = await IPC.send('wsl_get_status');
      if (!this.root?.querySelector('#wslHeadline')) return;
      this.renderState();
    } catch (error) {
      if (!this.root?.querySelector('#wslHeadline')) return;
      this.root.querySelector('#wslHeadline').textContent = '读取 WSL 状态失败';
      this.root.querySelector('#wslSubline').textContent = error.message;
    }
  },

  renderState() {
    if (!this.state || !this.root?.querySelector('#wslHeadline')) return;
    const installed = this.state.installed;
    this.root.querySelector('#wslDot').className = `dev-live-dot ${installed ? 'pass' : 'warn'}`;
    this.root.querySelector('#wslHeadline').textContent = installed ? 'WSL 可用' : 'WSL 尚未安装';
    this.root.querySelector('#wslSubline').textContent = installed ? this.state.executable : '请先启用适用于 Linux 的 Windows 子系统';
    this.root.querySelector('#wslFacts').innerHTML = `
      <div><i data-lucide="box"></i><span>发行版</span><strong>${(this.state.distros || []).length}</strong></div>
      <div><i data-lucide="layers-3"></i><span>默认版本</span><strong>WSL ${this.state.defaultVersion || 2}</strong></div>
      <div><i data-lucide="cpu"></i><span>虚拟化</span><strong>${this.state.virtualization ? '可用' : '未检测到'}</strong></div>
      <div><i data-lucide="shield"></i><span>当前权限</span><strong>${this.state.isAdmin ? '管理员' : '普通用户'}</strong></div>`;

    const distros = this.state.distros || [];
    this.root.querySelector('#wslDistros').innerHTML = distros.length ? distros.map(distro => `
      <article class="wsl-distro-row">
        <div class="wsl-logo"><i data-lucide="terminal-square"></i></div>
        <div class="wsl-distro-info"><div><strong>${DeveloperToolUi.escape(distro.name)}</strong>${distro.isDefault ? '<span>默认</span>' : ''}</div><small>WSL ${distro.version} · ${DeveloperToolUi.escape(distro.state)}</small><code>${DeveloperToolUi.escape(distro.basePath)}</code></div>
        <div class="wsl-row-actions">
          <button class="dev-icon-button" data-wsl-action="open" data-wsl-distro="${DeveloperToolUi.escape(distro.name)}" title="打开终端"><i data-lucide="square-terminal"></i></button>
          ${distro.state === 'Running' ? `<button class="dev-icon-button" data-wsl-action="terminate" data-wsl-distro="${DeveloperToolUi.escape(distro.name)}" title="终止发行版"><i data-lucide="square"></i></button>` : ''}
          ${!distro.isDefault ? `<button class="dev-text-button" data-wsl-action="setDefault" data-wsl-distro="${DeveloperToolUi.escape(distro.name)}">设为默认</button>` : ''}
        </div>
      </article>`).join('') : DeveloperToolUi.empty('package-open', '没有已安装的 WSL 发行版');
    if (window.lucide) lucide.createIcons({ root: this.root });
  },

  async action(wslAction, distro = '') {
    if ((wslAction === 'install' || ['open', 'terminate', 'setDefault'].includes(wslAction)) && !distro) {
      Toast.show('请先选择或输入发行版名称', 'warning');
      return;
    }
    try {
      const result = await IPC.send('wsl_action', { wslAction, distro, version: 2 });
      Toast.show(result.launched ? '操作已在独立窗口启动' : 'WSL 状态已更新', 'success');
      if (!result.launched) await this.load();
    } catch (error) { Toast.show('WSL 操作失败: ' + error.message, 'error', 3800); }
  },

  async loadOnline() {
    const box = this.root.querySelector('#wslOnline');
    box.classList.remove('d-none');
    box.innerHTML = DeveloperToolUi.loading('读取在线发行版');
    try {
      const result = await IPC.send('wsl_get_online');
      const items = result.items || [];
      this.root.querySelector('#wslOnlineList').innerHTML = items.map(item => `<option value="${DeveloperToolUi.escape(item.name)}">${DeveloperToolUi.escape(item.friendlyName)}</option>`).join('');
      box.innerHTML = items.length ? items.map(item => `<button data-online-distro="${DeveloperToolUi.escape(item.name)}"><strong>${DeveloperToolUi.escape(item.name)}</strong><span>${DeveloperToolUi.escape(item.friendlyName)}</span></button>`).join('') : DeveloperToolUi.empty('cloud-off', '没有读取到在线发行版');
      box.onclick = event => {
        const item = event.target.closest('[data-online-distro]');
        if (item) this.root.querySelector('#wslInstallName').value = item.dataset.onlineDistro;
      };
    } catch (error) { box.innerHTML = DeveloperToolUi.empty('cloud-off', '在线列表读取失败', error.message); }
    if (window.lucide) lucide.createIcons({ root: box });
  }
};
