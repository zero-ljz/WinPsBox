// Default Workspace Placeholder for tools under development
const DefaultToolPlaceholder = {
  render(container, tool) {
    container.innerHTML = `
      <div class="workspace-canvas">
        <div class="workspace-placeholder-box">
          <i data-lucide="puzzle" class="placeholder-icon"></i>
          <h4 class="fw-bold mb-2">${tool.title}</h4>
          <p class="text-secondary mb-4 fs-6">
            该工具模块处于<strong>模板就绪</strong>状态。您可继续提出功能需求以完成此工具的业务逻辑开发。
          </p>
          <div class="d-flex justify-content-center gap-2">
            <button class="btn btn-outline-primary btn-sm px-3" onclick="Toast.show('已触发 ${tool.title} 模拟测试', 'success')">
              <i data-lucide="play" class="lucide-sm me-1"></i> 模拟运行测试
            </button>
            <button class="btn btn-secondary btn-sm px-3" onclick="AppNavigation.switchView('tools')">
              返回工具箱
            </button>
          </div>
        </div>
      </div>
    `;
  }
};

// ==========================================
// 5. Tool Registry & Navigation
// ==========================================
const ToolRegistry = {
  tools: [
    // Network tools (Fully implemented)
    { id: 'net-adapter-dns', title: '网卡与 DNS 切换器', category: 'network', categoryName: '网络工具', icon: 'network', desc: '查看网卡配置、一键切换 DHCP/静态 IP 与公共 DNS 方案，一键刷新 DNS 缓存', tags: ['网络', 'DNS', 'IP', '网卡'] },
    { id: 'portproxy-manager', title: 'Windows 端口代理管理器', category: 'network', categoryName: '网络工具', icon: 'waypoints', desc: '可视化管理 netsh interface portproxy v4tov4 转发规则，支持按需 UAC 提权', tags: ['网络', '端口', '转发', 'PortProxy'] },
    { id: 'lan-scanner', title: '局域网设备扫描发现', category: 'network', categoryName: '网络工具', icon: 'radar', desc: '扫描局域网在线设备 IP、MAC 地址、主机名并自动匹配网卡硬件厂商 OUI', tags: ['探测', '局域网', 'ARP', '扫描'] },
    { id: 'domain-diagnostic', title: '域名诊断', category: 'network', categoryName: '网络工具', icon: 'scan-search', desc: '集中检测 SSL / TLS 证书、DNS / DoH 解析以及 IP、ASN 与 Whois 注册信息', tags: ['网络', 'DNS', 'DoH', 'SSL', 'Whois', '诊断'] },
    { id: 'proxy-manager', title: '系统与终端代理管理', category: 'network', categoryName: '网络工具', icon: 'arrow-left-right', desc: '快速切换 Windows 系统全局/PAC 代理，并一键生成终端 HTTP/Socks5 代理环境变量', tags: ['网络', '代理', 'Proxy', '终端'] },
    { id: 'port-checker', title: '端口占用与探测', category: 'network', categoryName: '网络工具', icon: 'activity', desc: '检测本地端口占用进程，或测试远程 IP / 域名的 TCP 端口连通性', tags: ['探测', '网络', '端口'] },
    { id: 'network-link-diagnostic', title: '网络链路诊断', category: 'network', categoryName: '网络工具', icon: 'route', desc: '统一执行 Ping 质量检测、逐跳 Traceroute 追踪并查看 Windows IPv4 路由表', tags: ['探测', '网络', '路由', 'Trace', '诊断'] },
    { id: 'socket-debugger', title: 'WebSocket / Socket 调试台', category: 'network', categoryName: '网络工具', icon: 'radio-tower', desc: '实时调试 WebSocket 与 TCP 长连接，支持文本、Hex、Base64 数据和收发帧检查', tags: ['网络', '调试', 'WebSocket', 'TCP'] },
    { id: 'local-cert-generator', title: '本地 CA 与多域名证书生成器', category: 'network', categoryName: '网络工具', icon: 'badge-check', desc: '创建并信任本地 Root CA，为 localhost、局域网 IP 与测试域名签发 SAN HTTPS 证书', tags: ['安全', '证书', 'HTTPS', '开发'] },
    { id: 'wifi-analyzer', title: 'Wi-Fi 分析器', category: 'network', categoryName: '网络工具', icon: 'wifi', desc: '扫描附近无线网络，分析信号、频段、信道占用、认证方式与当前连接', tags: ['网络', 'Wi-Fi', '信道', '无线'] },
    { id: 'http-redirect-tracer', title: 'HTTP 重定向追踪', category: 'network', categoryName: '网络工具', icon: 'git-commit-horizontal', desc: '逐跳检查 HTTP 重定向链、状态码、响应头、耗时、跨域与 HTTPS 降级', tags: ['网络', 'HTTP', '重定向', '开发'] },

    // System tools (Fully implemented)
    { id: 'service-manager', title: 'Windows 服务管理器', category: 'system', categoryName: '系统运维', icon: 'sliders', desc: '检索所有 Windows 系统服务，支持一键启动/停止/重启与修改自启动模式', tags: ['系统', '服务', '运维', 'Windows'] },
    { id: 'winget-manager', title: 'WinGet 软件包管理', category: 'system', categoryName: '系统运维', icon: 'package-open', desc: '集中查看已安装软件与可用更新，支持搜索、安装、升级、卸载及批量升级和卸载', tags: ['系统', '软件', 'WinGet', '更新'] },
    { id: 'file-lock-hunter', title: '文件占用与句柄解锁', category: 'system', categoryName: '系统运维', icon: 'unlock', desc: '基于 Windows Restart Manager 原生定位锁定文件的进程 PID 与窗口，支持一键结束', tags: ['系统', '进程', '文件', '解锁'] },
    { id: 'scheduled-tasks', title: '定时任务中心', category: 'system', categoryName: '系统运维', icon: 'calendar-clock', desc: '定时关机、重启、睡眠、锁屏或运行程序，支持单次与每日计划', tags: ['系统', '定时', '计划任务', '自动化'] },
    { id: 'context-menu-manager', title: '右键菜单管理器', category: 'system', categoryName: '系统运维', icon: 'mouse-pointer-click', desc: '扫描并启用或禁用文件、文件夹、桌面与磁盘右键菜单项目', tags: ['系统', '右键菜单', '注册表', '优化'] },
    { id: 'env-viewer', title: '系统环境变量管理', category: 'system', categoryName: '系统运维', icon: 'layers', desc: '查看、检索与快捷编辑 Windows 用户与系统 PATH 及环境变量', tags: ['系统', '环境变量', '运维'] },
    { id: 'hosts-editor', title: 'Hosts 快速切换器', category: 'system', categoryName: '系统运维', icon: 'server', desc: '快速读取与编辑系统 Hosts 映射规则，支持规则一键切换与备份', tags: ['系统', '网络', 'Hosts'] },
    { id: 'diagnostic-report-center', title: '一键诊断与报告中心', category: 'system', categoryName: '系统运维', icon: 'stethoscope', desc: '集中检查系统、磁盘、网络、DNS、代理与关键服务，并导出诊断报告', tags: ['系统', '网络', '诊断', '运维'] },

    // Developer tools
    { id: 'openssh-manager', title: 'SSH / OpenSSH 管理器', category: 'developer', categoryName: '开发工具', icon: 'key-round', desc: '管理 Windows OpenSSH 组件、sshd 服务和用户密钥，检查 SSH 端点连通性', tags: ['开发', 'SSH', '安全', '运维'] },
    { id: 'wsl-manager', title: 'WSL 管理中心', category: 'developer', categoryName: '开发工具', icon: 'boxes', desc: '查看和管理 WSL 发行版、运行状态、默认版本与在线安装', tags: ['开发', 'WSL', 'Linux', '系统'] },
    { id: 'developer-text-toolbox', title: '开发文本工具箱', category: 'developer', categoryName: '开发工具', icon: 'braces', desc: '处理 JSON、Base64、URL、JWT、时间戳、消息摘要和 UUID', tags: ['开发', 'JSON', '编码', 'JWT'] }
  ],

  favorites: new Set(),
  activeCategory: 'all',
  activeTag: 'all',
  searchQuery: '',
  activeTool: null,

  init() {
    try {
      const favList = JSON.parse(localStorage.getItem('app_favorites') || '[]');
      const validToolIds = new Set(this.tools.map(tool => tool.id));
      this.favorites = new Set(favList.filter(toolId => validToolIds.has(toolId)));
      localStorage.setItem('app_favorites', JSON.stringify(Array.from(this.favorites)));
    } catch (e) {
      this.favorites = new Set();
    }

    this.updateCategoryCounts();
    this.renderToolGrid();
    this.bindEvents();
  },

  updateCategoryCounts() {
    const counts = {
      all: this.tools.length,
      fav: this.favorites.size,
      network: this.tools.filter(t => t.category === 'network').length,
      system: this.tools.filter(t => t.category === 'system').length,
      developer: this.tools.filter(t => t.category === 'developer').length
    };

    for (const [cat, num] of Object.entries(counts)) {
      const badge = document.getElementById(`count-${cat}`);
      if (badge) badge.textContent = num;
    }
  },

  getFilteredTools() {
    return this.tools.filter(tool => {
      if (this.activeCategory === 'fav') {
        if (!this.favorites.has(tool.id)) return false;
      } else if (this.activeCategory !== 'all') {
        if (tool.category !== this.activeCategory) return false;
      }

      if (this.activeTag !== 'all') {
        if (!tool.tags.includes(this.activeTag)) return false;
      }

      if (this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase().trim();
        const matchTitle = tool.title.toLowerCase().includes(query);
        const matchDesc = tool.desc.toLowerCase().includes(query);
        const matchCat = tool.categoryName.toLowerCase().includes(query);
        const matchTags = tool.tags.some(tag => tag.toLowerCase().includes(query));
        if (!matchTitle && !matchDesc && !matchCat && !matchTags) return false;
      }

      return true;
    });
  },

  renderToolGrid() {
    const grid = document.getElementById('toolGrid');
    const emptyState = document.getElementById('emptyState');
    if (!grid) return;

    const filtered = this.getFilteredTools();

    if (filtered.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.classList.remove('d-none');
      return;
    }

    if (emptyState) emptyState.classList.add('d-none');

    grid.innerHTML = filtered.map(tool => {
      const isStarred = this.favorites.has(tool.id);
      const tagsHtml = tool.tags.map(t => `<span class="tool-tag">#${t}</span>`).join('');

      return `
        <div class="tool-card" data-tool-id="${tool.id}">
          <div class="tool-card-top">
            <div class="tool-icon-wrapper">
              <i data-lucide="${tool.icon}"></i>
            </div>
            <div class="tool-actions">
              <span class="tool-badge">${tool.categoryName}</span>
              <button class="btn-star ${isStarred ? 'starred' : ''}" data-star-id="${tool.id}" title="${isStarred ? '取消收藏' : '添加收藏'}">
                <i data-lucide="star"></i>
              </button>
            </div>
          </div>
          <div class="tool-card-body">
            <div class="tool-card-title">${tool.title}</div>
            <div class="tool-card-desc">${tool.desc}</div>
            <div class="tool-card-tags">${tagsHtml}</div>
          </div>
          <div class="tool-card-footer">
            <button class="btn-open-tool">
              <span>进入工具</span>
              <i data-lucide="chevron-right" style="width: 15px; height: 15px;"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) {
      lucide.createIcons({ root: grid });
    }
  },

  toggleFavorite(toolId) {
    if (this.favorites.has(toolId)) {
      this.favorites.delete(toolId);
      Toast.show('已取消收藏', 'info', 1500);
    } else {
      this.favorites.add(toolId);
      Toast.show('已添加到常用收藏', 'success', 1500);
    }
    localStorage.setItem('app_favorites', JSON.stringify(Array.from(this.favorites)));
    this.updateCategoryCounts();
    this.renderToolGrid();
    SettingsManager.saveConfig();
  },

  openToolWorkspace(toolId) {
    const tool = this.tools.find(t => t.id === toolId);
    if (!tool) return;
    this.activeTool = tool;

    // Header population
    const wsIcon = document.getElementById('wsToolIcon');
    const wsTitle = document.getElementById('wsToolTitle');
    const wsCategory = document.getElementById('wsToolCategory');
    const wsDesc = document.getElementById('wsToolDesc');
    const wsBtnStar = document.getElementById('wsBtnStar');

    if (wsIcon) wsIcon.innerHTML = `<i data-lucide="${tool.icon}"></i>`;
    if (wsTitle) wsTitle.textContent = tool.title;
    if (wsCategory) wsCategory.textContent = tool.categoryName;
    if (wsDesc) wsDesc.textContent = tool.desc;

    if (wsBtnStar) {
      wsBtnStar.classList.toggle('starred', this.favorites.has(tool.id));
      wsBtnStar.onclick = (e) => {
        e.stopPropagation();
        this.toggleFavorite(tool.id);
        wsBtnStar.classList.toggle('starred', this.favorites.has(tool.id));
      };
    }

    // Mount corresponding tool implementation
    const mount = document.getElementById('workspaceToolMount');
    if (mount) {
      switch (tool.id) {
        // Network Tools
        case 'net-adapter-dns':
          NetAdapterTool.render(mount);
          break;
        case 'portproxy-manager':
          PortProxyManagerTool.render(mount);
          break;
        case 'lan-scanner':
          LanScannerTool.render(mount);
          break;
        case 'domain-diagnostic':
          DomainDiagnosticTool.render(mount);
          break;
        case 'proxy-manager':
          ProxyManagerTool.render(mount);
          break;
        case 'port-checker':
          PortCheckerTool.render(mount);
          break;
        case 'network-link-diagnostic':
          NetworkLinkDiagnosticTool.render(mount);
          break;
        case 'socket-debugger':
          SocketDebuggerTool.render(mount);
          break;
        case 'local-cert-generator':
          LocalCertificateTool.render(mount);
          break;
        case 'wifi-analyzer':
          WifiAnalyzerTool.render(mount);
          break;
        case 'http-redirect-tracer':
          HttpRedirectTracerTool.render(mount);
          break;
        // System Tools
        case 'service-manager':
          ServiceManagerTool.render(mount);
          break;
        case 'winget-manager':
          WingetManagerTool.render(mount);
          break;
        case 'file-lock-hunter':
          FileLockTool.render(mount);
          break;
        case 'scheduled-tasks':
          ScheduledTaskTool.render(mount);
          break;
        case 'context-menu-manager':
          ContextMenuManagerTool.render(mount);
          break;
        case 'env-viewer':
          EnvTool.render(mount);
          break;
        case 'hosts-editor':
          HostsTool.render(mount);
          break;
        case 'diagnostic-report-center':
          DiagnosticReportTool.render(mount);
          break;
        case 'openssh-manager':
          OpenSshManagerTool.render(mount);
          break;
        case 'wsl-manager':
          WslManagerTool.render(mount);
          break;
        case 'developer-text-toolbox':
          DeveloperTextTool.render(mount);
          break;

        default:
          DefaultToolPlaceholder.render(mount, tool);
      }
    }

    AppNavigation.switchView('workspace');
    if (window.lucide) lucide.createIcons();
  },

  bindEvents() {
    const sidebarList = document.getElementById('sidebarNavList');
    if (sidebarList) {
      sidebarList.addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-item-btn');
        if (!btn || !btn.dataset.category) return;

        sidebarList.querySelectorAll('.nav-item-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.activeCategory = btn.dataset.category;
        this.updateHeaderAndHero();
        AppNavigation.switchView('tools');
        this.renderToolGrid();
      });
    }

    const tagChips = document.getElementById('tagChipsContainer');
    if (tagChips) {
      tagChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.tag-chip');
        if (!chip) return;
        tagChips.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeTag = chip.dataset.tag;
        this.renderToolGrid();
      });
    }

    const grid = document.getElementById('toolGrid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const starBtn = e.target.closest('.btn-star');
        if (starBtn) {
          e.stopPropagation();
          this.toggleFavorite(starBtn.dataset.starId);
          return;
        }

        const card = e.target.closest('.tool-card');
        if (card) {
          this.openToolWorkspace(card.dataset.toolId);
        }
      });
    }

    const searchInput = document.getElementById('toolSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        if (AppNavigation.currentView !== 'tools') {
          AppNavigation.switchView('tools');
        }
        this.renderToolGrid();
      });
    }

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      } else if (e.key === 'Escape') {
        // Close modal if open
        const envModal = document.getElementById('envVarModal');
        const hostModal = document.getElementById('addHostModal');
        if (envModal && !envModal.classList.contains('d-none')) {
          envModal.classList.add('d-none');
          return;
        }
        if (hostModal && !hostModal.classList.contains('d-none')) {
          hostModal.classList.add('d-none');
          return;
        }

        if (AppNavigation.currentView === 'workspace' || AppNavigation.currentView === 'settings') {
          AppNavigation.switchView('tools');
        } else if (searchInput && document.activeElement === searchInput) {
          searchInput.blur();
        }
      }
    });

    const btnBack = document.getElementById('btnBackToGrid');
    if (btnBack) btnBack.addEventListener('click', () => AppNavigation.switchView('tools'));
  },

  updateHeaderAndHero() {
    const titles = {
      all: { name: '全部工具', icon: 'layout-grid', desc: '集合网络诊断与 Windows 系统运维实用功能' },
      fav: { name: '常用收藏', icon: 'star', desc: '已标星置顶的高频使用工具集' },
      network: { name: '网络工具', icon: 'globe', desc: '端口探测、链路诊断与 API 模拟测试' },
      system: { name: '系统运维', icon: 'terminal-square', desc: '环境配置、系统进程与 Hosts 便捷管理' },
      developer: { name: '开发工具', icon: 'code-2', desc: '本地开发环境、Linux 子系统与常用文本处理工具' }
    };

    const cur = titles[this.activeCategory] || titles.all;
    const headerTitle = document.getElementById('headerTitleText');
    const headerIcon = document.getElementById('headerTitleIcon');
    const heroTitle = document.getElementById('heroTitle');
    const heroSubtitle = document.getElementById('heroSubtitle');

    if (headerTitle) headerTitle.textContent = cur.name;
    if (headerIcon) headerIcon.setAttribute('data-lucide', cur.icon);
    if (heroTitle) heroTitle.textContent = cur.name;
    if (heroSubtitle) heroSubtitle.textContent = cur.desc;

    if (window.lucide) lucide.createIcons();
  }
};

// ==========================================
// 6. Navigation Management
// ==========================================
const AppNavigation = {
  currentView: 'tools',
  toolsScrollTop: 0,

  init() {
    const btnNavSettings = document.getElementById('btnNavSettings');
    const btnHeaderSettings = document.getElementById('btnHeaderSettings');

    [btnNavSettings, btnHeaderSettings].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          if (this.currentView === 'settings') {
            this.switchView('tools');
          } else {
            this.switchView('settings');
          }
        });
      }
    });
  },

  switchView(viewName) {
    const appContent = document.querySelector('.app-content');
    if (this.currentView === 'workspace' && viewName !== 'workspace' && ToolRegistry.activeTool?.id === 'socket-debugger') {
      SocketDebuggerTool.destroy();
    }
    if (appContent && this.currentView === 'tools' && viewName !== 'tools') {
      this.toolsScrollTop = appContent.scrollTop;
    }
    this.currentView = viewName;

    const viewTools = document.getElementById('viewTools');
    const viewWorkspace = document.getElementById('viewWorkspace');
    const viewSettings = document.getElementById('viewSettings');
    const btnHeaderSettings = document.getElementById('btnHeaderSettings');
    const btnNavSettings = document.getElementById('btnNavSettings');
    const searchWrapper = document.getElementById('searchWrapper');
    const headerTitleText = document.getElementById('headerTitleText');
    const headerTitleIcon = document.getElementById('headerTitleIcon');

    if (viewTools) viewTools.classList.toggle('d-none', viewName !== 'tools');
    if (viewWorkspace) viewWorkspace.classList.toggle('d-none', viewName !== 'workspace');
    if (viewSettings) viewSettings.classList.toggle('d-none', viewName !== 'settings');

    if (btnHeaderSettings) btnHeaderSettings.classList.toggle('active', viewName === 'settings');
    if (btnNavSettings) btnNavSettings.classList.toggle('active', viewName === 'settings');

    if (viewName === 'settings') {
      const sidebarNav = document.getElementById('sidebarNavList');
      if (sidebarNav) {
        sidebarNav.querySelectorAll('.nav-item-btn').forEach(b => b.classList.remove('active'));
      }
      if (headerTitleText) headerTitleText.textContent = '系统与应用设置';
      if (headerTitleIcon) headerTitleIcon.setAttribute('data-lucide', 'settings');
      if (searchWrapper) searchWrapper.style.opacity = '0.4';
    } else {
      if (searchWrapper) searchWrapper.style.opacity = '1';
      if (viewName === 'tools') {
        ToolRegistry.updateHeaderAndHero();
        const sidebarNav = document.getElementById('sidebarNavList');
        if (sidebarNav) {
          const activeBtn = sidebarNav.querySelector(`[data-category="${ToolRegistry.activeCategory}"]`);
          if (activeBtn) activeBtn.classList.add('active');
        }
      }
    }

    if (appContent) {
      appContent.scrollTop = viewName === 'tools' ? this.toolsScrollTop : 0;
    }

    if (window.lucide) lucide.createIcons();
  }
};

// ==========================================
// 7. Settings & Auto-Start Manager
// ==========================================
const SettingsManager = {
  autoStartEnabled: false,
  minimizeToTrayEnabled: true,

  async init() {
    const switchAutoStart = document.getElementById('switchAutoStart');
    const switchMinimizeToTray = document.getElementById('switchMinimizeToTray');

    try {
      const config = await IPC.send('get_config');
      this.minimizeToTrayEnabled = config?.minimizeToTray !== false;
      if (switchMinimizeToTray) {
        switchMinimizeToTray.checked = this.minimizeToTrayEnabled;
      }
    } catch (e) {
      console.error('Failed to get tray behavior:', e);
    }

    try {
      const res = await IPC.send('get_autostart');
      this.autoStartEnabled = Boolean(res && res.enabled);
      if (switchAutoStart) {
        switchAutoStart.checked = this.autoStartEnabled;
      }
    } catch (e) {
      console.error('Failed to get autostart status:', e);
    }

    try {
      const info = await IPC.send('get_system_info');
      if (info) {
        const infoOS = document.getElementById('infoOS');
        const infoPS = document.getElementById('infoPS');
        const infoVersion = document.getElementById('infoVersion');
        if (infoOS && info.os) infoOS.textContent = info.os;
        if (infoPS && info.psVersion) infoPS.textContent = 'PowerShell ' + info.psVersion;
        if (infoVersion && info.appVersion) infoVersion.textContent = info.appVersion;
      }
    } catch (e) {
      console.error('Failed to get system info:', e);
    }

    if (switchAutoStart) {
      switchAutoStart.addEventListener('change', async (e) => {
        const targetChecked = e.target.checked;
        switchAutoStart.disabled = true;

        try {
          await IPC.send('set_autostart', { enabled: targetChecked });
          this.autoStartEnabled = targetChecked;
          Toast.show(targetChecked ? '已开启开机自启（已写入注册表）' : '已关闭开机自启（已清除注册表）', 'success', 2500);
          this.saveConfig();
        } catch (err) {
          Toast.show('修改开机自启失败: ' + err.message, 'error', 3000);
          switchAutoStart.checked = !targetChecked;
        } finally {
          switchAutoStart.disabled = false;
        }
      });
    }

    if (switchMinimizeToTray) {
      switchMinimizeToTray.addEventListener('change', async (e) => {
        const targetChecked = e.target.checked;
        switchMinimizeToTray.disabled = true;
        try {
          await IPC.send('set_tray_behavior', { enabled: targetChecked });
          this.minimizeToTrayEnabled = targetChecked;
          Toast.show(targetChecked ? '窗口将收起到系统托盘' : '关闭窗口将直接退出应用', 'success', 2200);
          this.saveConfig();
        } catch (err) {
          Toast.show('修改托盘行为失败: ' + err.message, 'error', 3000);
          switchMinimizeToTray.checked = !targetChecked;
        } finally {
          switchMinimizeToTray.disabled = false;
        }
      });
    }
  },

  async saveConfig() {
    const config = {
      theme: ThemeManager.currentTheme,
      autoStart: this.autoStartEnabled,
      minimizeToTray: this.minimizeToTrayEnabled,
      favorites: Array.from(ToolRegistry.favorites)
    };
    try {
      await IPC.send('save_config', { config });
    } catch (e) {
      console.warn('Failed to save config to backend:', e);
    }
  }
};

// ==========================================
// Application Bootstrap Entry Point
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  IPC.init();
  ThemeManager.init();
  PrivilegeManager.init();
  ToolRegistry.init();
  AppNavigation.init();
  SettingsManager.init();

  if (window.lucide) {
    lucide.createIcons();
  }
});
