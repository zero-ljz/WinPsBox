// ==========================================
// 12. WingetManagerTool - Windows package management
// ==========================================
const WingetManagerTool = {
  activeTab: 'installed',
  installed: [],
  updates: [],
  searchResults: [],
  status: null,
  busy: false,

  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  },

  render(container) {
    this.activeTab = 'installed';
    this.installed = [];
    this.updates = [];
    this.searchResults = [];
    this.status = null;

    container.innerHTML = `
      <div class="tool-view-wrapper winget-panel">
        <div class="winget-status-strip">
          <div class="winget-status-item">
            <span class="winget-status-icon"><i data-lucide="package-check"></i></span>
            <div><span class="winget-status-label">WinGet 状态</span><strong id="wingetVersion">检测中</strong></div>
          </div>
          <div class="winget-status-item">
            <span class="winget-status-icon neutral"><i data-lucide="package"></i></span>
            <div><span class="winget-status-label">已安装</span><strong id="wingetInstalledCount">--</strong></div>
          </div>
          <div class="winget-status-item">
            <span class="winget-status-icon warning"><i data-lucide="arrow-up-circle"></i></span>
            <div><span class="winget-status-label">可更新</span><strong id="wingetUpdateCount">--</strong></div>
          </div>
          <div class="winget-status-actions">
            <button class="btn btn-primary btn-sm" id="btnWingetUpgradeAll" disabled>
              <i data-lucide="download" class="lucide-sm me-1"></i> 全部升级
            </button>
            <button class="btn btn-outline-secondary btn-sm icon-action-btn" id="btnWingetRefresh" title="刷新列表" aria-label="刷新列表">
              <i data-lucide="refresh-cw" class="lucide-sm"></i>
            </button>
          </div>
        </div>

        <div class="tool-toolbar winget-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs">
              <button class="tool-tab-btn active" data-winget-tab="installed"><i data-lucide="hard-drive-download"></i> 已安装</button>
              <button class="tool-tab-btn" data-winget-tab="updates"><i data-lucide="circle-arrow-up"></i> 可更新 <span class="winget-tab-count" id="wingetUpdateTabCount">0</span></button>
              <button class="tool-tab-btn" data-winget-tab="search"><i data-lucide="search"></i> 软件搜索</button>
            </div>
          </div>
          <div class="tool-toolbar-right winget-search-group">
            <div class="input-group input-group-sm">
              <span class="input-group-text"><i data-lucide="search" style="width:14px;height:14px;"></i></span>
              <input type="text" class="form-control" id="wingetSearchInput" placeholder="筛选已安装软件..." autocomplete="off">
              <button class="btn btn-primary d-none" id="btnWingetSearch">搜索</button>
            </div>
          </div>
        </div>

        <div class="winget-operation-bar d-none" id="wingetOperationBar">
          <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
          <span id="wingetOperationText">正在执行...</span>
        </div>

        <div class="table-card winget-table-card">
          <div class="table-responsive-container">
            <table class="modern-table winget-table">
              <thead id="wingetTableHead"></thead>
              <tbody id="wingetTableBody">
                <tr><td class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm text-primary me-2"></span>正在读取软件包...</td></tr>
              </tbody>
            </table>
          </div>
          <div class="winget-table-footer">
            <span id="wingetResultCount">0 项</span>
            <span id="wingetLastRefresh">--</span>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.renderTable();
    this.showTableLoading('正在读取软件包...');
    this.loadInitial();
  },

  bindEvents(container) {
    container.querySelectorAll('[data-winget-tab]').forEach(button => {
      button.onclick = () => this.switchTab(button.dataset.wingetTab);
    });

    const input = container.querySelector('#wingetSearchInput');
    const searchButton = container.querySelector('#btnWingetSearch');
    const refreshButton = container.querySelector('#btnWingetRefresh');
    const upgradeAllButton = container.querySelector('#btnWingetUpgradeAll');
    const tableBody = container.querySelector('#wingetTableBody');

    if (input) {
      input.oninput = () => {
        if (this.activeTab !== 'search') this.renderTable();
      };
      input.onkeydown = event => {
        if (event.key === 'Enter' && this.activeTab === 'search') this.searchPackages();
      };
    }
    if (searchButton) searchButton.onclick = () => this.searchPackages();
    if (refreshButton) refreshButton.onclick = () => this.refreshCurrent();
    if (upgradeAllButton) upgradeAllButton.onclick = () => this.runPackageAction('upgrade-all', '', '全部可更新软件');
    if (tableBody) {
      tableBody.onclick = event => {
        const button = event.target.closest('[data-winget-action]');
        if (!button || this.busy) return;
        this.runPackageAction(button.dataset.wingetAction, button.dataset.packageId, button.dataset.packageName);
      };
    }
  },

  async loadInitial() {
    try {
      this.status = await IPC.send('winget_get_status');
      if (!this.status.available) throw new Error(this.status.error || '当前系统未安装 WinGet');
      const [installedResult, updatesResult] = await Promise.all([
        IPC.send('winget_get_packages', { mode: 'installed' }),
        IPC.send('winget_get_packages', { mode: 'updates' })
      ]);
      this.installed = installedResult.items || [];
      this.updates = updatesResult.items || [];
      this.updateSummary();
      this.renderTable();
    } catch (error) {
      this.showLoadError(error.message);
    }
  },

  updateSummary() {
    const version = document.getElementById('wingetVersion');
    const installedCount = document.getElementById('wingetInstalledCount');
    const updateCount = document.getElementById('wingetUpdateCount');
    const updateTabCount = document.getElementById('wingetUpdateTabCount');
    const upgradeAll = document.getElementById('btnWingetUpgradeAll');
    const lastRefresh = document.getElementById('wingetLastRefresh');

    if (version) version.textContent = this.status?.available ? this.status.version : '不可用';
    if (installedCount) installedCount.textContent = this.installed.length;
    if (updateCount) updateCount.textContent = this.updates.length;
    if (updateTabCount) updateTabCount.textContent = this.updates.length;
    if (upgradeAll) upgradeAll.disabled = this.busy || this.updates.length === 0;
    if (lastRefresh) lastRefresh.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('[data-winget-tab]').forEach(button => button.classList.toggle('active', button.dataset.wingetTab === tab));

    const input = document.getElementById('wingetSearchInput');
    const searchButton = document.getElementById('btnWingetSearch');
    if (input) {
      input.value = '';
      input.placeholder = tab === 'search' ? '输入软件名称或包 ID...' : tab === 'updates' ? '筛选可更新软件...' : '筛选已安装软件...';
    }
    if (searchButton) searchButton.classList.toggle('d-none', tab !== 'search');
    this.renderTable();
    if (window.lucide) lucide.createIcons({ root: document.querySelector('.winget-panel') });
  },

  getVisibleItems() {
    const source = this.activeTab === 'search' ? this.searchResults : this.activeTab === 'updates' ? this.updates : this.installed;
    const input = document.getElementById('wingetSearchInput');
    const query = input ? input.value.trim().toLowerCase() : '';
    if (!query || this.activeTab === 'search') return source;
    return source.filter(item => `${item.name} ${item.id} ${item.version} ${item.source}`.toLowerCase().includes(query));
  },

  renderTable() {
    const head = document.getElementById('wingetTableHead');
    const body = document.getElementById('wingetTableBody');
    const resultCount = document.getElementById('wingetResultCount');
    if (!head || !body) return;

    const isSearch = this.activeTab === 'search';
    const items = this.getVisibleItems();
    head.innerHTML = `<tr>
      <th>软件包</th>
      <th>包 ID</th>
      <th style="width:130px;">${isSearch ? '最新版本' : '当前版本'}</th>
      <th style="width:130px;">${isSearch ? '匹配信息' : '可用版本'}</th>
      <th style="width:92px;">来源</th>
      <th style="width:112px;">操作</th>
    </tr>`;

    if (items.length === 0) {
      const emptyText = isSearch ? '输入关键词搜索 winget 软件源' : this.activeTab === 'updates' ? '当前没有可用更新' : '没有匹配的软件包';
      const emptyIcon = isSearch ? 'package-search' : this.activeTab === 'updates' ? 'badge-check' : 'package-x';
      body.innerHTML = `<tr><td colspan="6"><div class="winget-empty-state"><i data-lucide="${emptyIcon}"></i><span>${emptyText}</span></div></td></tr>`;
    } else {
      body.innerHTML = items.map(item => this.renderRow(item, isSearch)).join('');
    }

    if (resultCount) resultCount.textContent = `${items.length} 项`;
    if (window.lucide) lucide.createIcons({ root: body });
  },

  renderRow(item, isSearch) {
    const name = this.escape(item.name || item.id);
    const id = this.escape(item.id);
    const currentVersion = this.escape(item.version || '--');
    const availableVersion = this.escape(item.availableVersion || '已是最新');
    const source = this.escape(item.source || '--');
    const match = this.escape(item.match || '--');
    let actionHtml;

    if (isSearch) {
      actionHtml = `<button class="btn btn-primary btn-sm winget-action-btn" data-winget-action="install" data-package-id="${id}" data-package-name="${name}"><i data-lucide="download"></i>安装</button>`;
    } else if (item.availableVersion) {
      actionHtml = `<button class="btn btn-primary btn-sm winget-action-btn" data-winget-action="upgrade" data-package-id="${id}" data-package-name="${name}"><i data-lucide="arrow-up"></i>升级</button>`;
    } else {
      actionHtml = `<button class="btn btn-outline-danger btn-sm winget-action-btn" data-winget-action="uninstall" data-package-id="${id}" data-package-name="${name}"><i data-lucide="trash-2"></i>卸载</button>`;
    }

    return `<tr>
      <td><div class="winget-package-name" title="${name}">${name}</div></td>
      <td><code class="winget-package-id" title="${id}">${id}</code></td>
      <td class="font-mono">${currentVersion}</td>
      <td>${isSearch ? `<span class="text-muted small">${match}</span>` : item.availableVersion ? `<span class="winget-version-update">${availableVersion}</span>` : `<span class="text-muted small">${availableVersion}</span>`}</td>
      <td><span class="winget-source-badge">${source}</span></td>
      <td>${actionHtml}</td>
    </tr>`;
  },

  async searchPackages() {
    const input = document.getElementById('wingetSearchInput');
    const query = input ? input.value.trim() : '';
    if (query.length < 2) {
      Toast.show('请输入至少 2 个字符', 'warning');
      return;
    }

    this.setBusy(true, `正在搜索 ${query}`);
    this.showTableLoading('正在搜索 winget 软件源...');
    try {
      const result = await IPC.send('winget_search', { query });
      this.searchResults = result.items || [];
      this.renderTable();
    } catch (error) {
      this.showLoadError(error.message);
    } finally {
      this.setBusy(false);
    }
  },

  async refreshCurrent() {
    if (this.busy) return;
    if (this.activeTab === 'search') {
      const input = document.getElementById('wingetSearchInput');
      if (input?.value.trim().length >= 2) await this.searchPackages();
      return;
    }

    this.setBusy(true, '正在刷新软件包列表');
    this.showTableLoading('正在刷新软件包列表...');
    try {
      const [installedResult, updatesResult] = await Promise.all([
        IPC.send('winget_get_packages', { mode: 'installed' }),
        IPC.send('winget_get_packages', { mode: 'updates' })
      ]);
      this.installed = installedResult.items || [];
      this.updates = updatesResult.items || [];
      this.updateSummary();
      this.renderTable();
    } catch (error) {
      this.showLoadError(error.message);
    } finally {
      this.setBusy(false);
    }
  },

  async runPackageAction(operation, packageId, packageName) {
    const actionName = { install: '安装', upgrade: '升级', uninstall: '卸载', 'upgrade-all': '全部升级' }[operation];
    const target = operation === 'upgrade-all' ? `${this.updates.length} 个软件包` : packageName;
    if (!confirm(`确定要${actionName} ${target} 吗？`)) return;

    this.setBusy(true, `正在${actionName} ${target}`);
    await new Promise(resolve => requestAnimationFrame(resolve));
    try {
      const result = await IPC.send('winget_package_action', { operation, packageId });
      Toast.show(`${actionName}已完成`, 'success', 3200);
      try {
        await this.reloadPackageLists();
      } catch (refreshError) {
        Toast.show(`操作已完成，但列表刷新失败: ${refreshError.message}`, 'warning', 5000);
      }
    } catch (error) {
      Toast.show(`${actionName}失败: ${error.message}`, 'error', 6000);
    } finally {
      this.setBusy(false);
    }
  },

  async reloadPackageLists() {
    const [installedResult, updatesResult] = await Promise.all([
      IPC.send('winget_get_packages', { mode: 'installed' }),
      IPC.send('winget_get_packages', { mode: 'updates' })
    ]);
    this.installed = installedResult.items || [];
    this.updates = updatesResult.items || [];
    this.updateSummary();
    this.renderTable();
  },

  setBusy(isBusy, message = '') {
    this.busy = isBusy;
    const bar = document.getElementById('wingetOperationBar');
    const text = document.getElementById('wingetOperationText');
    const refresh = document.getElementById('btnWingetRefresh');
    const search = document.getElementById('btnWingetSearch');
    if (bar) bar.classList.toggle('d-none', !isBusy);
    if (text && message) text.textContent = message;
    if (refresh) refresh.disabled = isBusy;
    if (search) search.disabled = isBusy;
    document.querySelectorAll('[data-winget-action]').forEach(button => button.disabled = isBusy);
    this.updateSummary();
  },

  showTableLoading(message) {
    const body = document.getElementById('wingetTableBody');
    if (body) body.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm text-primary me-2"></span>${this.escape(message)}</td></tr>`;
  },

  showLoadError(message) {
    const body = document.getElementById('wingetTableBody');
    const version = document.getElementById('wingetVersion');
    if (version && !this.status?.available) version.textContent = '不可用';
    if (body) body.innerHTML = `<tr><td colspan="6"><div class="winget-empty-state error"><i data-lucide="triangle-alert"></i><span>${this.escape(message)}</span></div></td></tr>`;
    if (window.lucide) lucide.createIcons({ root: body });
  }
};


