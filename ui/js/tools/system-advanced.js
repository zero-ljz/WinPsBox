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
// 8. StartupAuditorTool - 开机自启动项全面审计
// ==========================================
const StartupAuditorTool = {
  items: [],

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <button class="btn btn-primary btn-sm px-3" id="btnRefreshStartup">
              <i data-lucide="refresh-cw" class="lucide-sm me-1"></i> 扫描自启动项
            </button>
            <span class="text-muted small" id="startupCountText">共发现 0 项开机自启</span>
          </div>
          <div class="tool-toolbar-right">
            <input type="text" class="form-control form-control-sm" id="startupFilterInput" placeholder="过滤名称 / 路径 / 来源..." style="max-width: 260px;">
          </div>
        </div>

        <div class="card p-0 border-color flex-grow-1 overflow-hidden d-flex flex-column">
          <div class="table-responsive flex-grow-1 p-0 m-0">
            <table class="table table-hover table-bordered align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>自启项目名称</th>
                  <th>启动命令 / 执行目标路径</th>
                  <th style="width: 170px;">注册来源位置</th>
                  <th style="width: 100px;">文件有效性</th>
                  <th style="width: 120px;">操作</th>
                </tr>
              </thead>
              <tbody id="startupTbody">
                <tr><td colspan="5" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在全面扫描 Windows 自启动入口...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadStartupItems();
  },

  bindEvents(container) {
    const btn = container.querySelector('#btnRefreshStartup');
    const filter = container.querySelector('#startupFilterInput');

    if (btn) btn.onclick = () => this.loadStartupItems();
    if (filter) filter.oninput = () => this.renderTable();
  },

  async loadStartupItems() {
    const tbody = document.getElementById('startupTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在全面扫描 Windows 自启动入口...</td></tr>`;

    try {
      this.items = await IPC.send('sys_get_startup_items');
      this.renderTable();
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">扫描自启动失败: ${e.message}</td></tr>`;
    }
  },

  renderTable() {
    const tbody = document.getElementById('startupTbody');
    const countText = document.getElementById('startupCountText');
    const filterInput = document.getElementById('startupFilterInput');
    if (!tbody || !this.items) return;

    const query = filterInput ? filterInput.value.trim().toLowerCase() : '';
    const filtered = this.items.filter(item => {
      if (!query) return true;
      return (item.name && item.name.toLowerCase().includes(query)) ||
             (item.command && item.command.toLowerCase().includes(query)) ||
             (item.locationType && item.locationType.toLowerCase().includes(query));
    });

    if (countText) countText.textContent = `共发现 ${this.items.length} 项开机自启（当前展示 ${filtered.length} 项）`;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">未找到匹配的自启动项</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => `
      <tr>
        <td class="font-mono fw-bold text-main">${item.name}</td>
        <td>
          <span class="font-mono small text-truncate d-block" style="max-width:400px;" title="${item.command}">${item.command}</span>
        </td>
        <td><span class="badge bg-secondary-subtle text-secondary">${item.locationType}</span></td>
        <td>
          ${item.fileExists
            ? `<span class="badge bg-success-subtle text-success">文件存在</span>`
            : `<span class="badge bg-warning-subtle text-warning">失效残留</span>`
          }
        </td>
        <td>
          <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="StartupAuditorTool.deleteItem('${item.id}', '${item.locationType}', '${item.locationPath.replace(/\\/g, '\\\\')}', '${item.name}')">移除自启</button>
        </td>
      </tr>
    `).join('');
  },

  async deleteItem(id, locationType, locationPath, name) {
    if (!confirm(`确定要移除开机自启动项 [${name}] 吗？`)) return;

    try {
      const res = await IPC.send('sys_remove_startup_item', { id, locationType, locationPath, name });
      Toast.show(res.message || `已移除自启项 ${name}`, 'success');
      this.loadStartupItems();
    } catch (e) {
      Toast.show('移除自启项失败: ' + e.message, 'error');
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

// ==========================================
// 10. SystemSpecsTool - 硬件规格与运行健康面板
// ==========================================
const SystemSpecsTool = {
  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <h5 class="m-0 fw-bold"><i data-lucide="gauge" class="lucide-sm me-2 text-primary"></i>硬件规格与系统运行健康面板</h5>
          </div>
          <div class="tool-toolbar-right">
            <button class="btn btn-primary btn-sm px-3" id="btnRefreshSpecs">
              <i data-lucide="refresh-cw" class="lucide-sm me-1"></i> 刷新数据
            </button>
          </div>
        </div>

        <div class="specs-dashboard-grid flex-grow-1 overflow-auto" id="specsDashboardGrid">
          <div class="text-center text-muted py-5 w-100"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在采集硬件传感器与系统信息...</div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadSpecs();
  },

  bindEvents(container) {
    const btn = container.querySelector('#btnRefreshSpecs');
    if (btn) btn.onclick = () => this.loadSpecs();
  },

  async loadSpecs() {
    const grid = document.getElementById('specsDashboardGrid');
    if (!grid) return;
    grid.innerHTML = `<div class="text-center text-muted py-5 w-100"><div class="spinner-border spinner-border-sm text-primary me-2"></div>正在采集硬件传感器与系统信息...</div>`;

    try {
      const specs = await IPC.send('sys_get_hardware_specs');
      this.renderDashboard(specs);
    } catch (e) {
      grid.innerHTML = `<div class="text-danger py-4 text-center">读取硬件信息失败: ${e.message}</div>`;
    }
  },

  renderDashboard(specs) {
    const grid = document.getElementById('specsDashboardGrid');
    if (!grid || !specs) return;

    const cpu = specs.cpu || {};
    const mem = specs.memory || {};
    const disks = specs.disks || [];
    const gpus = specs.gpus || [];
    const os = specs.os || {};

    grid.innerHTML = `
      <!-- 1. CPU Card -->
      <div class="specs-card">
        <div class="specs-card-header">
          <span class="specs-card-title"><i data-lucide="cpu" class="text-primary"></i> 处理器 (CPU)</span>
          <span class="badge bg-primary-subtle text-primary">${cpu.cores || 0} 核 / ${cpu.threads || 0} 线程</span>
        </div>
        <div>
          <div class="fw-bold fs-6 text-main mb-2">${cpu.name || 'Unknown Processor'}</div>
          <div class="specs-metric-row"><span class="text-muted">基准主频:</span><span class="specs-metric-val">${cpu.maxClockSpeedMHz || 0} MHz</span></div>
          <div class="specs-metric-row"><span class="text-muted">封装插槽:</span><span class="specs-metric-val">${cpu.socket || 'Socket'}</span></div>
          <div class="specs-metric-row mt-2"><span class="text-muted">当前使用率:</span><span class="specs-metric-val text-primary">${cpu.loadPercent || 0}%</span></div>
          <div class="progress mt-1" style="height:6px;">
            <div class="progress-bar" style="width: ${cpu.loadPercent || 0}%;"></div>
          </div>
        </div>
      </div>

      <!-- 2. Memory Card -->
      <div class="specs-card">
        <div class="specs-card-header">
          <span class="specs-card-title"><i data-lucide="layers" class="text-success"></i> 物理内存 (RAM)</span>
          <span class="badge bg-success-subtle text-success">${mem.totalGB || 0} GB 总量</span>
        </div>
        <div>
          <div class="specs-metric-row"><span class="text-muted">已用内存:</span><span class="specs-metric-val">${mem.usedGB || 0} GB (${mem.percentUsed || 0}%)</span></div>
          <div class="specs-metric-row"><span class="text-muted">可用容量:</span><span class="specs-metric-val text-success">${mem.freeGB || 0} GB</span></div>
          <div class="progress my-2" style="height:8px;">
            <div class="progress-bar bg-success" style="width: ${mem.percentUsed || 0}%;"></div>
          </div>
          <div class="small text-muted mb-1">内存插槽详情:</div>
          <div class="font-mono small">
            ${(mem.slots && mem.slots.length > 0)
              ? mem.slots.map(s => `<div>• ${s.slot}: ${s.capacityGB}GB @ ${s.speedMHz}MHz (${s.manufacturer})</div>`).join('')
              : '<div>板载 / 单条内存</div>'
            }
          </div>
        </div>
      </div>

      <!-- 3. Storage Disks Card -->
      <div class="specs-card">
        <div class="specs-card-header">
          <span class="specs-card-title"><i data-lucide="hard-drive" class="text-warning"></i> 本地磁盘驱动器</span>
          <span class="badge bg-warning-subtle text-warning">${disks.length} 个分区</span>
        </div>
        <div class="d-flex flex-column gap-2">
          ${disks.map(d => `
            <div>
              <div class="d-flex justify-content-between small fw-bold">
                <span>盘符 ${d.drive} (${d.fileSystem})</span>
                <span>${d.usedGB}G / ${d.totalGB}G</span>
              </div>
              <div class="progress mt-1" style="height:6px;">
                <div class="progress-bar ${d.percentUsed > 85 ? 'bg-danger' : 'bg-warning'}" style="width: ${d.percentUsed}%;"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 4. GPU & OS Health Card -->
      <div class="specs-card">
        <div class="specs-card-header">
          <span class="specs-card-title"><i data-lucide="monitor" class="text-info"></i> 显卡与系统健康</span>
          <span class="badge bg-info-subtle text-info">${os.architecture || '64位'}</span>
        </div>
        <div>
          <div class="specs-metric-row"><span class="text-muted">显卡设备:</span><span class="specs-metric-val text-truncate" style="max-width:200px;">${(gpus[0] && gpus[0].name) || '核芯显卡'}</span></div>
          <div class="specs-metric-row"><span class="text-muted">操作系统:</span><span class="specs-metric-val">${os.caption || 'Windows 11'}</span></div>
          <div class="specs-metric-row"><span class="text-muted">系统版本 Build:</span><span class="specs-metric-val">${os.buildNumber || '-'}</span></div>
          <div class="specs-metric-row"><span class="text-muted">计算机名称:</span><span class="specs-metric-val">${os.computerName || '-'}</span></div>
          <div class="specs-metric-row mt-2 pt-2 border-top"><span class="text-muted">连续运行时间 (Uptime):</span><span class="specs-metric-val text-primary">${os.uptime || '-'}</span></div>
        </div>
      </div>
    `;

    if (window.lucide) lucide.createIcons({ root: grid });
  }
};

// ==========================================
// 11. SystemLauncherTool - 常用系统管理入口与上帝模式
// ==========================================
const SystemLauncherTool = {
  shortcuts: [
    // MMC Tools
    { key: 'gpedit', name: '组策略编辑器', cmd: 'gpedit.msc', group: 'mmc', icon: 'shield-alert', desc: '系统与安全组策略高级配置' },
    { key: 'regedit', name: '注册表编辑器', cmd: 'regedit.exe', group: 'mmc', icon: 'key', desc: 'Windows Registry 注册表读写' },
    { key: 'devmgmt', name: '设备管理器', cmd: 'devmgmt.msc', group: 'mmc', icon: 'hard-drive', desc: '硬件设备与驱动管理' },
    { key: 'eventvwr', name: '事件查看器', cmd: 'eventvwr.msc', group: 'mmc', icon: 'file-text', desc: '系统日志、崩溃与错误事件审计' },
    { key: 'taskschd', name: '任务计划程序', cmd: 'taskschd.msc', group: 'mmc', icon: 'clock', desc: '系统定时与开机任务管理' },
    { key: 'diskmgmt', name: '磁盘管理', cmd: 'diskmgmt.msc', group: 'mmc', icon: 'pie-chart', desc: '分区压缩、扩展与驱动器号分配' },
    { key: 'compmgmt', name: '计算机管理', cmd: 'compmgmt.msc', group: 'mmc', icon: 'server', desc: '综合计算机管理控制台' },
    { key: 'perfmon', name: '性能监视器', cmd: 'perfmon.msc', group: 'mmc', icon: 'activity', desc: '系统性能计数器与实时分析' },
    { key: 'firewall', name: '高级安全防火墙', cmd: 'wf.msc', group: 'mmc', icon: 'shield', desc: '入站与出站防火墙规则' },
    { key: 'services', name: 'Windows 服务', cmd: 'services.msc', group: 'mmc', icon: 'sliders', desc: '系统服务管理器 MMC' },

    // Control Panel
    { key: 'ncpa', name: '网络连接', cmd: 'ncpa.cpl', group: 'cpl', icon: 'wifi', desc: '网络适配器与以太网连接设置' },
    { key: 'appwiz', name: '程序和功能', cmd: 'appwiz.cpl', group: 'cpl', icon: 'package', desc: '控制面板传统软件卸载面板' },
    { key: 'sysdm', name: '系统属性', cmd: 'sysdm.cpl', group: 'cpl', icon: 'sliders-horizontal', desc: '环境变量、远程桌面与系统保护' },
    { key: 'powercfg', name: '电源选项', cmd: 'powercfg.cpl', group: 'cpl', icon: 'zap', desc: '高性能电源方案与睡眠管理' },
    { key: 'mmsys', name: '声音设置', cmd: 'mmsys.cpl', group: 'cpl', icon: 'volume-2', desc: '音频播放、录音与输出设备' },

    // Utilities & GodMode
    { key: 'godmode', name: '上帝模式 (GodMode)', cmd: 'shell:::{ED7BA...}', group: 'util', icon: 'sparkles', desc: '聚集所有 Windows 隐藏控制面板' },
    { key: 'dxdiag', name: 'DirectX 诊断工具', cmd: 'dxdiag.exe', group: 'util', icon: 'monitor', desc: '显卡、DirectX 与声音硬件测试' },
    { key: 'resmon', name: '资源监视器', cmd: 'resmon.exe', group: 'util', icon: 'cpu', desc: '网络、磁盘句柄与内存实时监视' },
    { key: 'msinfo32', name: '系统信息 (msinfo32)', cmd: 'msinfo32.exe', group: 'util', icon: 'info', desc: '最详尽的系统软硬件资源摘要' },
    { key: 'certmgr', name: '证书管理器', cmd: 'certmgr.msc', group: 'util', icon: 'shield-check', desc: '系统受信任根证书与用户证书' },
    { key: 'cleanmgr', name: '磁盘清理工具', cmd: 'cleanmgr.exe', group: 'util', icon: 'trash-2', desc: '一键清理 Windows Update 与临时文件' }
  ],

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <h5 class="m-0 fw-bold"><i data-lucide="terminal" class="lucide-sm me-2 text-primary"></i>Windows 系统管理入口与上帝模式速开矩阵</h5>
          </div>
          <div class="tool-toolbar-right">
            <input type="text" class="form-control form-control-sm" id="launcherSearchInput" placeholder="快速搜索工具 (例如: 组策略 / 注册表 / ncpa)..." style="max-width: 300px;">
          </div>
        </div>

        <div class="flex-grow-1 overflow-auto d-flex flex-column gap-4 p-1" id="launcherGroupsMount"></div>
      </div>
    `;

    this.bindEvents(container);
    this.renderCards();
  },

  bindEvents(container) {
    const input = container.querySelector('#launcherSearchInput');
    if (input) input.oninput = () => this.renderCards();
  },

  renderCards() {
    const mount = document.getElementById('launcherGroupsMount');
    const input = document.getElementById('launcherSearchInput');
    if (!mount) return;

    const query = input ? input.value.trim().toLowerCase() : '';

    const groups = [
      { id: 'mmc', title: '核心 MMC 管理控制台' },
      { id: 'cpl', title: '经典控制面板组件 (CPL)' },
      { id: 'util', title: '高级系统诊断与上帝模式' }
    ];

    let html = '';
    groups.forEach(g => {
      const items = this.shortcuts.filter(s => s.group === g.id).filter(s => {
        if (!query) return true;
        return s.name.toLowerCase().includes(query) || s.cmd.toLowerCase().includes(query) || s.desc.toLowerCase().includes(query);
      });

      if (items.length > 0) {
        html += `
          <div>
            <h6 class="fw-bold text-muted mb-2">${g.title} (${items.length})</h6>
            <div class="launcher-grid">
              ${items.map(item => `
                <div class="launcher-card" onclick="SystemLauncherTool.launch('${item.key}')">
                  <div class="launcher-icon-box">
                    <i data-lucide="${item.icon}"></i>
                  </div>
                  <div class="launcher-info">
                    <span class="launcher-name">${item.name}</span>
                    <span class="launcher-sub">${item.cmd}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    });

    mount.innerHTML = html || `<div class="text-center text-muted py-5">未找到匹配的系统管理工具</div>`;
    if (window.lucide) lucide.createIcons({ root: mount });
  },

  async launch(key) {
    try {
      const res = await IPC.send('sys_launch_shortcut', { toolKey: key });
      Toast.show(res.message || `已调起 ${key}`, 'success', 1200);
    } catch (e) {
      Toast.show('启动失败: ' + e.message, 'error');
    }
  }
};

