// Windows netsh interface portproxy v4tov4 manager.
const PortProxyManagerTool = {
  rules: [],
  targetCandidates: [],
  container: null,

  render(container) {
    this.container = container;
    container.innerHTML = `
      <div class="tool-view-wrapper portproxy-view">
        <div class="portproxy-status-band">
          <div class="portproxy-status-main">
            <span class="portproxy-status-icon"><i data-lucide="route"></i></span>
            <div>
              <div class="portproxy-status-title">IPv4 端口代理</div>
              <div class="portproxy-status-meta" id="portProxyServiceStatus">正在读取 IP Helper 服务状态...</div>
            </div>
          </div>
          <div class="portproxy-status-actions">
            <button type="button" class="btn btn-outline-warning btn-sm d-none" id="btnStartPortProxyService">
              <i data-lucide="play" class="lucide-sm"></i>
              <span>启动 IP Helper</span>
            </button>
            <span class="status-pill secondary" id="portProxyRuleCount"><span class="status-dot"></span>0 条规则</span>
            <span class="status-pill secondary" id="portProxyPrivilege"><span class="status-dot"></span>权限检测中</span>
            <button type="button" class="btn btn-outline-secondary btn-sm icon-command-btn" id="btnRefreshPortProxy" title="刷新规则" aria-label="刷新规则">
              <i data-lucide="refresh-cw"></i>
            </button>
          </div>
        </div>

        <div class="portproxy-layout">
          <section class="portproxy-form-pane" aria-labelledby="portProxyFormTitle">
            <div class="portproxy-pane-heading">
              <div>
                <h4 id="portProxyFormTitle">新增转发规则</h4>
                <span>v4tov4 / TCP</span>
              </div>
              <i data-lucide="plus-circle"></i>
            </div>

            <form id="portProxyForm" novalidate>
              <fieldset class="portproxy-endpoint-fieldset">
                <legend>监听端点</legend>
                <div class="portproxy-field-row">
                  <div class="portproxy-field portproxy-field-address">
                    <label for="portProxyListenAddress">监听地址</label>
                    <input class="form-control form-control-sm font-mono" id="portProxyListenAddress" inputmode="decimal" value="0.0.0.0" autocomplete="off" required>
                  </div>
                  <div class="portproxy-field portproxy-field-port">
                    <label for="portProxyListenPort">端口</label>
                    <input type="number" class="form-control form-control-sm font-mono" id="portProxyListenPort" min="1" max="65535" value="13389" required>
                  </div>
                </div>
              </fieldset>

              <div class="portproxy-direction" aria-hidden="true">
                <span></span><i data-lucide="arrow-down"></i><span></span>
              </div>

              <fieldset class="portproxy-endpoint-fieldset destination">
                <legend>目标端点</legend>
                <div class="portproxy-field-row">
                  <div class="portproxy-field portproxy-field-address">
                    <label for="portProxyConnectAddress">目标地址</label>
                    <div class="portproxy-address-picker">
                      <input class="form-control form-control-sm font-mono" id="portProxyConnectAddress" list="portProxyTargetOptions" inputmode="decimal" placeholder="选择发现的 IP 或手动输入" autocomplete="off" required>
                      <datalist id="portProxyTargetOptions"></datalist>
                      <button type="button" class="btn btn-outline-secondary btn-sm icon-command-btn" id="btnDiscoverPortProxyTargets" title="重新发现目标地址" aria-label="重新发现目标地址">
                        <i data-lucide="radar"></i>
                      </button>
                    </div>
                    <div class="portproxy-discovery-status" id="portProxyDiscoveryStatus">正在自动发现可用地址...</div>
                  </div>
                  <div class="portproxy-field portproxy-field-port">
                    <label for="portProxyConnectPort">端口</label>
                    <input type="number" class="form-control form-control-sm font-mono" id="portProxyConnectPort" min="1" max="65535" value="3389" required>
                  </div>
                </div>
              </fieldset>

              <div class="portproxy-command-preview">
                <div class="portproxy-command-label">
                  <span>将执行的命令</span>
                  <button type="button" class="portproxy-copy-btn" id="btnCopyPortProxyCommand" title="复制命令" aria-label="复制命令">
                    <i data-lucide="copy"></i>
                  </button>
                </div>
                <code id="portProxyCommandPreview"></code>
              </div>

              <div class="portproxy-note">
                <i data-lucide="shield-alert"></i>
                <span>修改规则时会按需请求 UAC。PortProxy 不会自动创建防火墙入站规则。</span>
              </div>

              <button type="submit" class="btn btn-primary btn-sm portproxy-submit" id="btnAddPortProxy">
                <i data-lucide="plus" class="lucide-sm"></i>
                <span>添加转发规则</span>
              </button>
            </form>
          </section>

          <section class="portproxy-rules-pane" aria-labelledby="portProxyRulesTitle">
            <div class="portproxy-pane-heading">
              <div>
                <h4 id="portProxyRulesTitle">当前规则</h4>
                <span>持久化系统配置</span>
              </div>
              <i data-lucide="list-tree"></i>
            </div>
            <div class="portproxy-rules-mount" id="portProxyRulesMount">
              <div class="portproxy-loading"><span class="spinner-border spinner-border-sm"></span>正在读取规则...</div>
            </div>
          </section>
        </div>
      </div>
    `;

    this.bindEvents();
    this.updateCommandPreview();
    this.loadRules();
    this.discoverTargets();
    if (window.lucide) lucide.createIcons({ root: container });
  },

  bindEvents() {
    const form = this.container.querySelector('#portProxyForm');
    const refreshButton = this.container.querySelector('#btnRefreshPortProxy');
    const startServiceButton = this.container.querySelector('#btnStartPortProxyService');
    const discoverButton = this.container.querySelector('#btnDiscoverPortProxyTargets');
    const copyButton = this.container.querySelector('#btnCopyPortProxyCommand');
    const rulesMount = this.container.querySelector('#portProxyRulesMount');

    form.addEventListener('submit', event => {
      event.preventDefault();
      this.addRule();
    });
    form.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => this.updateCommandPreview());
    });
    refreshButton.addEventListener('click', () => this.loadRules());
    startServiceButton.addEventListener('click', () => this.startService());
    discoverButton.addEventListener('click', () => this.discoverTargets());
    copyButton.addEventListener('click', () => this.copyCommand());
    rulesMount.addEventListener('click', event => {
      const deleteButton = event.target.closest('[data-portproxy-delete]');
      if (!deleteButton) return;
      this.removeRule(deleteButton.dataset.listenAddress, Number(deleteButton.dataset.listenPort));
    });
  },

  getFormValues() {
    return {
      listenAddress: this.container.querySelector('#portProxyListenAddress').value.trim(),
      listenPort: Number(this.container.querySelector('#portProxyListenPort').value),
      connectAddress: this.container.querySelector('#portProxyConnectAddress').value.trim(),
      connectPort: Number(this.container.querySelector('#portProxyConnectPort').value)
    };
  },

  isIPv4(value) {
    const parts = value.split('.');
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
  },

  validateRule(rule) {
    if (!this.isIPv4(rule.listenAddress)) return '请输入有效的 IPv4 监听地址';
    if (!this.isIPv4(rule.connectAddress)) return '请输入有效的 IPv4 目标地址';
    if (!Number.isInteger(rule.listenPort) || rule.listenPort < 1 || rule.listenPort > 65535) return '监听端口必须介于 1 和 65535 之间';
    if (!Number.isInteger(rule.connectPort) || rule.connectPort < 1 || rule.connectPort > 65535) return '目标端口必须介于 1 和 65535 之间';
    return '';
  },

  commandFor(rule) {
    return `netsh interface portproxy add v4tov4 listenport=${rule.listenPort || ''} listenaddress=${rule.listenAddress} connectport=${rule.connectPort || ''} connectaddress=${rule.connectAddress}`;
  },

  updateCommandPreview() {
    const preview = this.container.querySelector('#portProxyCommandPreview');
    if (preview) preview.textContent = this.commandFor(this.getFormValues());
  },

  async copyCommand() {
    const command = this.commandFor(this.getFormValues());
    try {
      await navigator.clipboard.writeText(command);
      Toast.show('命令已复制', 'success', 1400);
    } catch (error) {
      Toast.show('复制失败: ' + error.message, 'error');
    }
  },

  async loadRules() {
    const mount = this.container.querySelector('#portProxyRulesMount');
    const refreshButton = this.container.querySelector('#btnRefreshPortProxy');
    mount.innerHTML = `<div class="portproxy-loading"><span class="spinner-border spinner-border-sm"></span>正在读取规则...</div>`;
    refreshButton.disabled = true;

    try {
      const result = await IPC.send('net_get_portproxy_rules');
      this.rules = Array.isArray(result.rules) ? result.rules : [];
      this.renderStatus(result);
      this.renderRules();
    } catch (error) {
      mount.innerHTML = `
        <div class="portproxy-empty is-error">
          <i data-lucide="circle-alert"></i>
          <strong>规则读取失败</strong>
          <span>${this.escapeHtml(error.message)}</span>
        </div>`;
      if (window.lucide) lucide.createIcons({ root: mount });
    } finally {
      refreshButton.disabled = false;
    }
  },

  async discoverTargets() {
    const button = this.container.querySelector('#btnDiscoverPortProxyTargets');
    const status = this.container.querySelector('#portProxyDiscoveryStatus');
    const input = this.container.querySelector('#portProxyConnectAddress');
    const datalist = this.container.querySelector('#portProxyTargetOptions');
    button.disabled = true;
    status.textContent = '正在自动发现可用地址...';
    status.classList.remove('is-error');

    try {
      const result = await IPC.send('net_get_portproxy_targets');
      this.targetCandidates = Array.isArray(result.candidates) ? result.candidates : [];
      datalist.innerHTML = this.targetCandidates.map(candidate => {
        const address = this.escapeHtml(String(candidate.address));
        const label = this.escapeHtml(`${candidate.source} · ${candidate.name}`);
        return `<option value="${address}" label="${label}"></option>`;
      }).join('');

      const wslCandidates = this.targetCandidates.filter(candidate => candidate.source === 'WSL');
      status.textContent = this.targetCandidates.length > 0
        ? `已发现 ${this.targetCandidates.length} 个地址${wslCandidates.length ? `，其中 WSL ${wslCandidates.length} 个` : ''}`
        : '未发现候选地址，仍可手动输入 IPv4';

      if (!input.value.trim() && wslCandidates.length > 0) {
        input.value = wslCandidates[0].address;
        this.updateCommandPreview();
      }
    } catch (error) {
      this.targetCandidates = [];
      datalist.innerHTML = '';
      status.textContent = '自动发现失败，仍可手动输入 IPv4';
      status.classList.add('is-error');
    } finally {
      button.disabled = false;
    }
  },

  renderStatus(result) {
    const service = this.container.querySelector('#portProxyServiceStatus');
    const count = this.container.querySelector('#portProxyRuleCount');
    const privilege = this.container.querySelector('#portProxyPrivilege');

    service.textContent = result.serviceRunning
      ? 'IP Helper 服务正在运行，转发引擎可用'
      : `IP Helper 服务未运行（${result.serviceStatus || 'Unknown'}）`;
    service.classList.toggle('is-warning', !result.serviceRunning);
    this.container.querySelector('#btnStartPortProxyService').classList.toggle('d-none', result.serviceRunning);

    count.className = `status-pill ${this.rules.length > 0 ? 'info' : 'secondary'}`;
    count.innerHTML = `<span class="status-dot"></span>${this.rules.length} 条规则`;
    privilege.className = `status-pill ${result.isAdmin ? 'success' : 'warning'}`;
    privilege.innerHTML = `<span class="status-dot"></span>${result.isAdmin ? '管理员模式' : '按需 UAC'}`;
  },

  renderRules() {
    const mount = this.container.querySelector('#portProxyRulesMount');
    if (this.rules.length === 0) {
      mount.innerHTML = `
        <div class="portproxy-empty">
          <i data-lucide="route-off"></i>
          <strong>暂无 v4tov4 规则</strong>
          <span>新增规则后会显示在这里</span>
        </div>`;
      if (window.lucide) lucide.createIcons({ root: mount });
      return;
    }

    mount.innerHTML = `
      <div class="portproxy-table-wrap">
        <table class="modern-table portproxy-table">
          <thead>
            <tr>
              <th>监听地址</th>
              <th class="portproxy-arrow-column"></th>
              <th>目标地址</th>
              <th class="portproxy-action-column">操作</th>
            </tr>
          </thead>
          <tbody>
            ${this.rules.map(rule => {
              const listenAddress = this.escapeHtml(String(rule.listenAddress));
              const connectAddress = this.escapeHtml(String(rule.connectAddress));
              const listenPort = Number(rule.listenPort);
              const connectPort = Number(rule.connectPort);
              return `
                <tr>
                  <td><div class="portproxy-endpoint"><strong>${listenAddress}</strong><span>:${listenPort}</span></div></td>
                  <td class="portproxy-arrow-column"><i data-lucide="arrow-right"></i></td>
                  <td><div class="portproxy-endpoint destination"><strong>${connectAddress}</strong><span>:${connectPort}</span></div></td>
                  <td class="portproxy-action-column">
                    <button type="button" class="btn btn-outline-danger btn-sm icon-command-btn" data-portproxy-delete data-listen-address="${listenAddress}" data-listen-port="${listenPort}" title="删除规则" aria-label="删除 ${listenAddress}:${listenPort} 规则">
                      <i data-lucide="trash-2"></i>
                    </button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    if (window.lucide) lucide.createIcons({ root: mount });
  },

  async addRule() {
    const rule = this.getFormValues();
    const validationError = this.validateRule(rule);
    if (validationError) {
      Toast.show(validationError, 'warning');
      return;
    }

    const existing = this.rules.find(item => item.listenAddress === rule.listenAddress && Number(item.listenPort) === rule.listenPort);
    if (existing && !window.confirm(`${rule.listenAddress}:${rule.listenPort} 已存在。是否用新目标覆盖该规则？`)) return;

    const button = this.container.querySelector('#btnAddPortProxy');
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm"></span><span>正在应用...</span>`;
    try {
      const result = await IPC.send('net_add_portproxy_rule', rule);
      Toast.show(result.message || '规则添加成功', 'success');
      await this.loadRules();
    } catch (error) {
      Toast.show('添加失败: ' + error.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = `<i data-lucide="plus" class="lucide-sm"></i><span>添加转发规则</span>`;
      if (window.lucide) lucide.createIcons({ root: button });
    }
  },

  async removeRule(listenAddress, listenPort) {
    if (!window.confirm(`确认删除 ${listenAddress}:${listenPort} 的端口代理规则？`)) return;

    try {
      const result = await IPC.send('net_remove_portproxy_rule', { listenAddress, listenPort });
      Toast.show(result.message || '规则已删除', 'success');
      await this.loadRules();
    } catch (error) {
      Toast.show('删除失败: ' + error.message, 'error');
    }
  },

  async startService() {
    const button = this.container.querySelector('#btnStartPortProxyService');
    button.disabled = true;
    try {
      const result = await IPC.send('net_start_portproxy_service');
      Toast.show(result.message || 'IP Helper 服务已启动', 'success');
      await this.loadRules();
    } catch (error) {
      Toast.show('服务启动失败: ' + error.message, 'error');
    } finally {
      button.disabled = false;
    }
  },

  escapeHtml(value) {
    return value.replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }
};
