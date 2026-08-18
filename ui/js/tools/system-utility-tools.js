const UtilityHtml = {
  escape(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
};

// ==========================================
// 12. ScheduledTaskTool - 定时任务中心
// ==========================================
const ScheduledTaskTool = {
  tasks: [],
  actionLabels: {
    shutdown: '关闭电脑',
    restart: '重启电脑',
    sleep: '进入睡眠',
    lock: '锁定屏幕',
    program: '运行程序'
  },
  actionIcons: {
    shutdown: 'power',
    restart: 'rotate-cw',
    sleep: 'moon',
    lock: 'lock',
    program: 'play'
  },

  render(container) {
    const initialTime = this.getInitialTime();
    container.innerHTML = `
      <div class="tool-view-wrapper scheduler-layout">
        <aside class="scheduler-form-panel">
          <div class="scheduler-panel-heading">
            <div class="scheduler-panel-icon"><i data-lucide="calendar-plus"></i></div>
            <div>
              <h4>新建定时任务</h4>
              <p>任务由 Windows 计划任务程序可靠执行</p>
            </div>
          </div>

          <div class="scheduler-form-body">
            <div>
              <label class="form-label utility-label" for="scheduleName">任务名称</label>
              <input class="form-control form-control-sm" id="scheduleName" maxlength="48" placeholder="例如：今晚自动关机">
            </div>

            <div>
              <label class="form-label utility-label" for="scheduleAction">执行动作</label>
              <select class="form-select form-select-sm" id="scheduleAction">
                <option value="shutdown">关闭电脑</option>
                <option value="restart">重启电脑</option>
                <option value="sleep">进入睡眠</option>
                <option value="lock">锁定屏幕</option>
                <option value="program">运行程序或脚本</option>
              </select>
            </div>

            <div class="scheduler-danger-note" id="schedulerDangerNote">
              <i data-lucide="triangle-alert"></i>
              <span>执行时将立即关机，请提前保存正在编辑的内容。</span>
            </div>

            <div class="d-none scheduler-program-fields" id="schedulerProgramFields">
              <div>
                <label class="form-label utility-label" for="scheduleProgram">程序或脚本路径</label>
                <input class="form-control form-control-sm font-mono" id="scheduleProgram" placeholder="C:\\Tools\\backup.ps1">
              </div>
              <div>
                <label class="form-label utility-label" for="scheduleArguments">运行参数 <span>可选</span></label>
                <input class="form-control form-control-sm font-mono" id="scheduleArguments" placeholder="--mode daily">
              </div>
              <div>
                <label class="form-label utility-label" for="scheduleWorkingDir">工作目录 <span>可选</span></label>
                <input class="form-control form-control-sm font-mono" id="scheduleWorkingDir" placeholder="C:\\Tools">
              </div>
            </div>

            <div>
              <label class="form-label utility-label">执行频率</label>
              <div class="utility-segmented" role="group" aria-label="执行频率">
                <button class="active" type="button" data-schedule-type="once">仅执行一次</button>
                <button type="button" data-schedule-type="daily">每天执行</button>
              </div>
            </div>

            <div id="scheduleOnceField">
              <label class="form-label utility-label" for="scheduleDateTime">执行日期与时间</label>
              <input type="datetime-local" class="form-control form-control-sm" id="scheduleDateTime" value="${initialTime}">
            </div>
            <div class="d-none" id="scheduleDailyField">
              <label class="form-label utility-label" for="scheduleDailyTime">每天执行时间</label>
              <input type="time" class="form-control form-control-sm" id="scheduleDailyTime" value="22:30">
            </div>

            <button class="btn btn-primary scheduler-submit" id="btnCreateSchedule">
              <i data-lucide="calendar-plus"></i>
              <span>创建任务</span>
            </button>
          </div>
        </aside>

        <section class="scheduler-list-panel">
          <div class="tool-toolbar scheduler-toolbar">
            <div class="tool-toolbar-left">
              <div>
                <h5 class="utility-section-title">我的定时任务</h5>
                <p class="utility-section-subtitle">仅显示和管理由 DevTools Box 创建的任务</p>
              </div>
            </div>
            <div class="tool-toolbar-right">
              <span class="status-pill info" id="scheduleCount">0 项任务</span>
              <button class="btn btn-outline-secondary btn-sm utility-icon-button" id="btnRefreshSchedules" title="刷新任务" aria-label="刷新任务">
                <i data-lucide="refresh-cw"></i>
              </button>
            </div>
          </div>
          <div class="scheduler-task-list" id="schedulerTaskList">
            ${this.loadingState('正在读取计划任务...')}
          </div>
        </section>
      </div>
    `;

    this.bindEvents(container);
    this.updateActionFields(container);
    this.loadTasks();
  },

  getInitialTime() {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  },

  bindEvents(container) {
    container.querySelector('#scheduleAction').onchange = () => this.updateActionFields(container);
    container.querySelector('#btnCreateSchedule').onclick = () => this.createTask(container);
    container.querySelector('#btnRefreshSchedules').onclick = () => this.loadTasks();

    container.querySelectorAll('[data-schedule-type]').forEach(button => {
      button.onclick = () => {
        container.querySelectorAll('[data-schedule-type]').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        const isDaily = button.dataset.scheduleType === 'daily';
        container.querySelector('#scheduleOnceField').classList.toggle('d-none', isDaily);
        container.querySelector('#scheduleDailyField').classList.toggle('d-none', !isDaily);
      };
    });

    container.querySelector('#schedulerTaskList').onclick = event => {
      const deleteButton = event.target.closest('[data-schedule-delete]');
      if (deleteButton) this.deleteTask(deleteButton.dataset.scheduleDelete);
    };
    container.querySelector('#schedulerTaskList').onchange = event => {
      const toggle = event.target.closest('[data-schedule-toggle]');
      if (toggle) this.toggleTask(toggle.dataset.scheduleToggle, toggle.checked, toggle);
    };
  },

  updateActionFields(container) {
    const action = container.querySelector('#scheduleAction').value;
    const isProgram = action === 'program';
    const note = container.querySelector('#schedulerDangerNote');
    container.querySelector('#schedulerProgramFields').classList.toggle('d-none', !isProgram);
    note.classList.toggle('d-none', !['shutdown', 'restart'].includes(action));
    if (!note.classList.contains('d-none')) {
      note.querySelector('span').textContent = action === 'restart'
        ? '执行时将立即重启，请提前保存正在编辑的内容。'
        : '执行时将立即关机，请提前保存正在编辑的内容。';
    }
  },

  async createTask(container) {
    const button = container.querySelector('#btnCreateSchedule');
    const action = container.querySelector('#scheduleAction').value;
    const scheduleType = container.querySelector('[data-schedule-type].active').dataset.scheduleType;
    const runAt = scheduleType === 'daily'
      ? container.querySelector('#scheduleDailyTime').value
      : container.querySelector('#scheduleDateTime').value;
    const payload = {
      name: container.querySelector('#scheduleName').value.trim() || this.actionLabels[action],
      taskAction: action,
      scheduleType,
      runAt,
      programPath: container.querySelector('#scheduleProgram').value.trim(),
      arguments: container.querySelector('#scheduleArguments').value.trim(),
      workingDirectory: container.querySelector('#scheduleWorkingDir').value.trim()
    };

    if (!runAt) return Toast.show('请选择任务执行时间', 'warning');
    if (action === 'program' && !payload.programPath) return Toast.show('请输入程序或脚本路径', 'warning');
    if (['shutdown', 'restart'].includes(action) && !confirm(`确定创建“${this.actionLabels[action]}”任务吗？执行前请保存工作。`)) return;

    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>正在创建...</span>';
    try {
      const result = await IPC.send('sys_create_scheduled_task', payload);
      Toast.show(result.message || '定时任务已创建', 'success');
      container.querySelector('#scheduleName').value = '';
      await this.loadTasks();
    } catch (error) {
      Toast.show(error.message, 'error', 5000);
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="calendar-plus"></i><span>创建任务</span>';
      if (window.lucide) lucide.createIcons({ root: button });
    }
  },

  async loadTasks() {
    const list = document.getElementById('schedulerTaskList');
    if (!list) return;
    list.innerHTML = this.loadingState('正在读取计划任务...');
    try {
      const data = await IPC.send('sys_get_scheduled_tasks');
      this.tasks = Array.isArray(data) ? data : [];
      this.renderTasks();
    } catch (error) {
      list.innerHTML = this.emptyState('circle-alert', '读取任务失败', error.message, 'error');
    }
  },

  renderTasks() {
    const list = document.getElementById('schedulerTaskList');
    const count = document.getElementById('scheduleCount');
    if (!list) return;
    if (count) count.textContent = `${this.tasks.length} 项任务`;

    if (!this.tasks.length) {
      list.innerHTML = this.emptyState('calendar-clock', '还没有定时任务', '在左侧设置动作和时间后创建第一个任务');
      if (window.lucide) lucide.createIcons({ root: list });
      return;
    }

    list.innerHTML = this.tasks.map(task => {
      const action = task.action || 'program';
      const scheduleText = task.scheduleType === 'daily' ? '每天' : '单次';
      const command = action === 'program' ? task.execute : this.actionLabels[action];
      return `
        <article class="scheduler-task-card ${task.enabled ? '' : 'is-disabled'}">
          <div class="scheduler-task-icon action-${UtilityHtml.escape(action)}"><i data-lucide="${this.actionIcons[action] || 'play'}"></i></div>
          <div class="scheduler-task-main">
            <div class="scheduler-task-title-row">
              <h6>${UtilityHtml.escape(task.name || this.actionLabels[action])}</h6>
              <span class="status-pill ${task.scheduleType === 'daily' ? 'info' : 'secondary'}">${scheduleText}</span>
            </div>
            <div class="scheduler-task-time">
              <i data-lucide="clock-3"></i>
              <strong>${UtilityHtml.escape(task.nextRun || '暂无下次执行时间')}</strong>
            </div>
            <div class="scheduler-task-command" title="${UtilityHtml.escape(command)}">${UtilityHtml.escape(command)}</div>
          </div>
          <div class="scheduler-task-controls">
            <label class="form-check form-switch m-0" title="${task.enabled ? '暂停任务' : '启用任务'}">
              <input class="form-check-input" type="checkbox" data-schedule-toggle="${UtilityHtml.escape(task.id)}" ${task.enabled ? 'checked' : ''}>
            </label>
            <button class="btn btn-outline-danger btn-sm utility-icon-button" data-schedule-delete="${UtilityHtml.escape(task.id)}" title="删除任务" aria-label="删除任务">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </article>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons({ root: list });
  },

  async toggleTask(id, enabled, input) {
    input.disabled = true;
    try {
      const result = await IPC.send('sys_set_scheduled_task_state', { id, enabled });
      Toast.show(result.message, 'success', 1600);
      await this.loadTasks();
    } catch (error) {
      input.checked = !enabled;
      input.disabled = false;
      Toast.show(error.message, 'error');
    }
  },

  async deleteTask(id) {
    const task = this.tasks.find(item => item.id === id);
    if (!confirm(`确定删除任务“${task ? task.name : id}”吗？`)) return;
    try {
      const result = await IPC.send('sys_remove_scheduled_task', { id });
      Toast.show(result.message, 'success');
      await this.loadTasks();
    } catch (error) {
      Toast.show(error.message, 'error');
    }
  },

  loadingState(text) {
    return `<div class="utility-empty-state"><span class="spinner-border spinner-border-sm text-primary"></span><span>${UtilityHtml.escape(text)}</span></div>`;
  },

  emptyState(icon, title, text, type = '') {
    return `<div class="utility-empty-state ${type}"><i data-lucide="${icon}"></i><strong>${UtilityHtml.escape(title)}</strong><span>${UtilityHtml.escape(text)}</span></div>`;
  }
};

// ==========================================
// 13. ContextMenuManagerTool - 右键菜单管理器
// ==========================================
const ContextMenuManagerTool = {
  items: [],
  activeTarget: 'all',

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="context-summary" id="contextSummary">
          <div class="context-summary-main">
            <div class="context-summary-icon"><i data-lucide="mouse-pointer-click"></i></div>
            <div>
              <h4>右键菜单项目</h4>
              <p>禁用不会删除项目，可随时恢复；更改通常在重启资源管理器后生效。</p>
            </div>
          </div>
          <div class="context-metrics">
            <div><strong id="contextTotalCount">0</strong><span>已发现</span></div>
            <div><strong id="contextEnabledCount">0</strong><span>已启用</span></div>
            <div><strong id="contextDisabledCount">0</strong><span>已禁用</span></div>
          </div>
        </div>

        <div class="tool-toolbar context-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs context-target-tabs">
              <button class="tool-tab-btn active" data-context-target="all">全部</button>
              <button class="tool-tab-btn" data-context-target="file">文件</button>
              <button class="tool-tab-btn" data-context-target="folder">文件夹</button>
              <button class="tool-tab-btn" data-context-target="background">背景</button>
              <button class="tool-tab-btn" data-context-target="drive">磁盘</button>
            </div>
          </div>
          <div class="tool-toolbar-right context-toolbar-actions">
            <div class="utility-search">
              <i data-lucide="search"></i>
              <input id="contextSearch" placeholder="搜索菜单名称、命令或 CLSID">
            </div>
            <button class="btn btn-outline-secondary btn-sm utility-icon-button" id="btnRefreshContext" title="重新扫描" aria-label="重新扫描">
              <i data-lucide="refresh-cw"></i>
            </button>
          </div>
        </div>

        <div class="table-card context-table-card">
          <div class="table-responsive-container">
            <table class="modern-table context-table">
              <thead><tr>
                <th>菜单项目</th>
                <th>显示位置</th>
                <th>类型</th>
                <th>作用域</th>
                <th>状态</th>
                <th>操作</th>
              </tr></thead>
              <tbody id="contextMenuTbody">
                <tr><td colspan="6"><div class="utility-empty-state"><span class="spinner-border spinner-border-sm text-primary"></span><span>正在扫描右键菜单...</span></div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    this.bindEvents(container);
    this.loadItems();
  },

  bindEvents(container) {
    container.querySelector('#contextSearch').oninput = () => this.renderTable();
    container.querySelector('#btnRefreshContext').onclick = () => this.loadItems();
    container.querySelectorAll('[data-context-target]').forEach(button => {
      button.onclick = () => {
        container.querySelectorAll('[data-context-target]').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        this.activeTarget = button.dataset.contextTarget;
        this.renderTable();
      };
    });
    container.querySelector('#contextMenuTbody').onchange = event => {
      const toggle = event.target.closest('[data-context-toggle]');
      if (toggle) this.toggleItem(Number(toggle.dataset.contextToggle), toggle.checked, toggle);
    };
    container.querySelector('#contextMenuTbody').onclick = event => {
      const locate = event.target.closest('[data-context-locate]');
      if (locate) this.openRegistry(Number(locate.dataset.contextLocate));
    };
  },

  async loadItems() {
    const tbody = document.getElementById('contextMenuTbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6"><div class="utility-empty-state"><span class="spinner-border spinner-border-sm text-primary"></span><span>正在扫描右键菜单...</span></div></td></tr>';
    try {
      const data = await IPC.send('sys_get_context_menu_items');
      this.items = Array.isArray(data) ? data : [];
      this.renderTable();
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="utility-empty-state error"><i data-lucide="circle-alert"></i><strong>扫描失败</strong><span>${UtilityHtml.escape(error.message)}</span></div></td></tr>`;
      if (window.lucide) lucide.createIcons({ root: tbody });
    }
  },

  getFilteredItems() {
    const search = (document.getElementById('contextSearch')?.value || '').trim().toLowerCase();
    return this.items.filter(item => {
      if (this.activeTarget !== 'all' && item.target !== this.activeTarget) return false;
      if (!search) return true;
      return [item.name, item.command, item.registryPath, item.typeName]
        .some(value => String(value || '').toLowerCase().includes(search));
    });
  },

  renderTable() {
    const tbody = document.getElementById('contextMenuTbody');
    if (!tbody) return;
    const filtered = this.getFilteredItems();
    document.getElementById('contextTotalCount').textContent = this.items.length;
    document.getElementById('contextEnabledCount').textContent = this.items.filter(item => item.enabled).length;
    document.getElementById('contextDisabledCount').textContent = this.items.filter(item => !item.enabled).length;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="utility-empty-state"><i data-lucide="list-filter"></i><strong>没有匹配项目</strong><span>更换位置筛选或搜索关键词</span></div></td></tr>';
      if (window.lucide) lucide.createIcons({ root: tbody });
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const index = this.items.indexOf(item);
      const scopeBadge = item.scope === 'Machine'
        ? '<span class="status-pill warning"><i data-lucide="shield"></i>系统</span>'
        : '<span class="status-pill secondary"><i data-lucide="user-round"></i>当前用户</span>';
      const lockReason = item.policyLocked ? '系统策略已禁用，无法在当前用户范围恢复' : (item.enabled ? '禁用项目' : '启用项目');
      return `
        <tr class="${item.enabled ? '' : 'context-row-disabled'}">
          <td>
            <div class="context-item-name">${UtilityHtml.escape(item.name)}</div>
            <div class="context-item-command" title="${UtilityHtml.escape(item.command || item.registryPath)}">${UtilityHtml.escape(item.command || item.keyName)}</div>
          </td>
          <td><span class="context-target-label"><i data-lucide="${this.targetIcon(item.target)}"></i>${UtilityHtml.escape(item.targetName)}</span></td>
          <td><span class="status-pill info">${UtilityHtml.escape(item.typeName)}</span></td>
          <td>${scopeBadge}</td>
          <td><span class="status-pill ${item.enabled ? 'success' : 'secondary'}"><span class="status-dot"></span>${item.enabled ? '已启用' : '已禁用'}</span></td>
          <td>
            <div class="context-row-actions">
              <label class="form-check form-switch m-0" title="${lockReason}">
                <input class="form-check-input" type="checkbox" data-context-toggle="${index}" ${item.enabled ? 'checked' : ''} ${item.policyLocked ? 'disabled' : ''}>
              </label>
              <button class="btn btn-outline-secondary btn-sm utility-icon-button" data-context-locate="${index}" title="在注册表中定位" aria-label="在注册表中定位">
                <i data-lucide="external-link"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
    if (window.lucide) lucide.createIcons({ root: tbody });
  },

  targetIcon(target) {
    return { file: 'file', folder: 'folder', background: 'monitor', drive: 'hard-drive' }[target] || 'menu';
  },

  async toggleItem(index, enabled, input) {
    const item = this.items[index];
    if (!item) return;
    const scopeWarning = item.scope === 'Machine' ? '该项目属于系统范围，Windows 可能请求管理员权限。\n\n' : '';
    if (!confirm(`${scopeWarning}确定${enabled ? '启用' : '禁用'}“${item.name}”吗？`)) {
      input.checked = !enabled;
      return;
    }
    input.disabled = true;
    try {
      const result = await IPC.send('sys_set_context_menu_item_state', {
        type: item.type,
        registryPath: item.registryPath,
        clsid: item.clsid,
        enabled
      });
      Toast.show(result.message || '右键菜单状态已更新', 'success', 3500);
      await this.loadItems();
    } catch (error) {
      input.checked = !enabled;
      input.disabled = false;
      Toast.show(error.message, 'error', 5000);
    }
  },

  async openRegistry(index) {
    const item = this.items[index];
    if (!item) return;
    try {
      await IPC.send('sys_open_context_menu_registry', { registryPath: item.registryPath });
    } catch (error) {
      Toast.show(error.message, 'error');
    }
  }
};
