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
