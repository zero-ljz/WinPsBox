// ==========================================
// 2. Toast Notification Component
// ==========================================
const Toast = {
  show(message, type = 'info', duration = 2500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'custom-toast';

    let iconName = 'info';
    let iconColor = 'var(--accent-primary)';
    if (type === 'success') {
      iconName = 'check-circle-2';
      iconColor = '#10b981';
    } else if (type === 'warning') {
      iconName = 'alert-triangle';
      iconColor = '#f59e0b';
    } else if (type === 'error') {
      iconName = 'x-circle';
      iconColor = '#ef4444';
    }

    toast.innerHTML = `
      <i data-lucide="${iconName}" style="color: ${iconColor}; width: 18px; height: 18px;"></i>
      <span></span>
    `;
    toast.querySelector('span').textContent = String(message);

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons({ root: toast });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};

// ==========================================
// 2.5 Background Task Activity
// ==========================================
const TaskActivity = {
  tasks: new Map(),
  labels: {
    net_check_remote_port: '远程端口探测',
    net_ping: 'Ping 网络诊断',
    net_dns_deep_diagnostic: 'DNS 深度诊断',
    net_intel_lookup: '网络情报查询',
    diag_run: '系统诊断',
    ssh_get_status: 'OpenSSH 状态检查',
    ssh_install_capability: 'OpenSSH 组件安装',
    wsl_get_status: 'WSL 状态检查',
    wsl_get_online: 'WSL 在线列表',
    net_get_portproxy_targets: '转发目标发现',
    net_scan_lan: '局域网设备扫描',
    net_check_ssl: 'TLS 证书检查',
    net_trace_route: '路由追踪',
    winget_get_status: 'WinGet 状态检查',
    winget_get_packages: 'WinGet 软件清单',
    winget_search: 'WinGet 软件搜索',
    winget_package_action: 'WinGet 软件操作',
    winget_batch_action: 'WinGet 批量操作'
  },

  ensureContainer() {
    let container = document.getElementById('taskActivityContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'taskActivityContainer';
      container.className = 'task-activity-container';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    return container;
  },

  start(taskId, action, progress = {}) {
    if (!taskId) return;
    if (this.tasks.has(taskId)) {
      this.update(taskId, progress);
      return;
    }

    const item = document.createElement('section');
    item.className = 'task-activity-item';
    item.dataset.taskId = taskId;
    item.innerHTML = `
      <div class="task-activity-header">
        <i data-lucide="loader-circle" class="task-activity-icon"></i>
        <strong></strong>
        <span class="task-activity-percent">0%</span>
        <button type="button" class="task-activity-cancel" title="取消任务" aria-label="取消任务">
          <i data-lucide="x"></i>
        </button>
      </div>
      <div class="task-activity-message"></div>
      <div class="task-activity-progress" aria-hidden="true"><span></span></div>`;
    item.querySelector('strong').textContent = this.labels[action] || action;
    item.querySelector('.task-activity-cancel').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.title = '正在取消';
      try {
        await IPC.cancel(taskId);
      } catch (error) {
        button.disabled = false;
        button.title = '取消任务';
        Toast.show('取消任务失败: ' + error.message, 'error', 3000);
      }
    };
    this.ensureContainer().appendChild(item);
    this.tasks.set(taskId, item);
    this.update(taskId, progress);
    if (window.lucide) lucide.createIcons({ root: item });
  },

  update(taskId, progress = {}) {
    const item = this.tasks.get(taskId);
    if (!item) return;
    const percent = Math.min(100, Math.max(0, Number(progress.percent) || 0));
    const percentLabel = item.querySelector('.task-activity-percent');
    const message = item.querySelector('.task-activity-message');
    const bar = item.querySelector('.task-activity-progress span');
    percentLabel.textContent = `${Math.round(percent)}%`;
    bar.style.width = `${percent}%`;
    message.textContent = [progress.message, progress.detail].filter(Boolean).join(' · ') || '正在处理';
  },

  finish(taskId, success, cancelled) {
    const item = this.tasks.get(taskId);
    if (!item) return;
    item.classList.add(success ? 'is-success' : cancelled ? 'is-cancelled' : 'is-error');
    const message = item.querySelector('.task-activity-message');
    message.textContent = success ? '已完成' : cancelled ? '已取消' : '执行失败';
    if (success) item.querySelector('.task-activity-progress span').style.width = '100%';
    setTimeout(() => {
      item.remove();
      this.tasks.delete(taskId);
    }, 2000);
  }
};
window.TaskActivity = TaskActivity;

// ==========================================
// 3. Theme Manager (Light / Dark / Auto)
// ==========================================
const ThemeManager = {
  currentTheme: 'system',
  mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),

  init() {
    const savedTheme = localStorage.getItem('app_theme') || 'system';
    this.setTheme(savedTheme, false);

    this.mediaQuery.addEventListener('change', () => {
      if (this.currentTheme === 'system') {
        this.applyThemeToDOM('system');
      }
    });

    const btnQuick = document.getElementById('btnQuickTheme');
    if (btnQuick) {
      btnQuick.addEventListener('click', () => {
        const nextTheme = this.currentTheme === 'light' ? 'dark' : this.currentTheme === 'dark' ? 'system' : 'light';
        this.setTheme(nextTheme, true);
      });
    }

    ['themeOptLight', 'themeOptDark', 'themeOptSystem'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          this.setTheme(el.dataset.themeVal, true);
        });
      }
    });
  },

  setTheme(theme, showNotice = false) {
    this.currentTheme = theme;
    localStorage.setItem('app_theme', theme);
    this.applyThemeToDOM(theme);
    this.updateThemeUI(theme);

    if (showNotice) {
      const labelMap = { light: '浅色模式', dark: '深色模式', system: '跟随系统' };
      Toast.show(`主题已切换为：${labelMap[theme]}`, 'info', 1800);
      SettingsManager.saveConfig();
    }
  },

  applyThemeToDOM(theme) {
    let effectiveTheme = theme;
    if (theme === 'system') {
      effectiveTheme = this.mediaQuery.matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-bs-theme', effectiveTheme);
  },

  updateThemeUI(theme) {
    const quickIcon = document.getElementById('quickThemeIcon');
    const quickText = document.getElementById('quickThemeText');

    let iconName = 'sun';
    let text = '浅色';
    if (theme === 'dark') {
      iconName = 'moon';
      text = '深色';
    } else if (theme === 'system') {
      iconName = 'monitor';
      text = '跟随系统';
    }

    if (quickText) quickText.textContent = text;
    if (quickIcon) {
      quickIcon.setAttribute('data-lucide', iconName);
      if (window.lucide) lucide.createIcons();
    }

    ['light', 'dark', 'system'].forEach(t => {
      const el = document.getElementById(`themeOpt${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (el) {
        el.classList.toggle('active', t === theme);
      }
    });
  }
};

// ==========================================
// 3.5 Privilege & Windows UAC Manager
// ==========================================
const PrivilegeManager = {
  isAdmin: false,

  async init() {
    try {
      const res = await IPC.send('get_privilege_info');
      this.isAdmin = Boolean(res && res.isAdmin);
      this.updateUI();
    } catch (e) {
      console.warn('Failed to check admin privilege:', e);
    }

    const btnHeader = document.getElementById('btnAppPrivilege');
    const btnSettings = document.getElementById('btnRestartAsAdmin');

    [btnHeader, btnSettings].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => this.requestElevation());
      }
    });
  },

  updateUI() {
    const btnHeader = document.getElementById('btnAppPrivilege');
    const iconHeader = document.getElementById('privilegeIcon');
    const textHeader = document.getElementById('privilegeText');
    const statusSettings = document.getElementById('settingsPrivilegeStatus');
    const infoPrivilege = document.getElementById('infoPrivilege');
    const btnSettings = document.getElementById('btnRestartAsAdmin');

    if (btnHeader) {
      btnHeader.classList.toggle('is-admin', this.isAdmin);
      btnHeader.title = this.isAdmin ? '当前应用已获得完整管理员权限' : '当前为普通用户模式（点击可申请管理员权限重启）';
    }
    if (iconHeader) {
      iconHeader.setAttribute('data-lucide', this.isAdmin ? 'shield-check' : 'shield');
    }
    if (textHeader) {
      textHeader.textContent = this.isAdmin ? '管理员模式' : '普通模式';
    }

    if (statusSettings) {
      statusSettings.innerHTML = this.isAdmin
        ? `<span class="text-success fw-bold"><i data-lucide="shield-check" class="lucide-sm me-1"></i>已具备管理员完全权限</span>`
        : `<span class="text-warning fw-bold"><i data-lucide="shield" class="lucide-sm me-1"></i>普通权限（已启用自动 UAC 按需提权）</span>`;
    }

    if (infoPrivilege) {
      infoPrivilege.textContent = this.isAdmin ? 'Administrator (管理员)' : 'Standard User (普通用户)';
      infoPrivilege.className = `info-item-val fw-bold ${this.isAdmin ? 'text-success' : 'text-secondary'}`;
    }

    if (btnSettings) {
      if (this.isAdmin) {
        btnSettings.innerHTML = `<i data-lucide="check" style="width: 14px; height: 14px;"></i> 已处于管理员权限`;
        btnSettings.className = 'btn btn-success btn-sm d-flex align-items-center gap-1 disabled';
      } else {
        btnSettings.innerHTML = `<i data-lucide="shield" style="width: 14px; height: 14px;"></i> 以管理员身份重启应用`;
        btnSettings.className = 'btn btn-outline-primary btn-sm d-flex align-items-center gap-1';
      }
    }

    if (window.lucide) lucide.createIcons();
  },

  async requestElevation() {
    if (this.isAdmin) {
      Toast.show('当前应用已处于管理员完全权限状态', 'info', 2000);
      return;
    }

    Toast.show('正在请求以管理员身份重启，请在 Windows 弹出的 UAC 窗口中点击“是”...', 'info', 3000);

    try {
      const res = await IPC.send('sys_elevate_app');
      if (res && res.success) {
        Toast.show('已启动管理员新实例，当前窗口即将关闭...', 'success', 2000);
      }
    } catch (e) {
      Toast.show('提权失败: ' + e.message, 'error', 3500);
    }
  }
};

