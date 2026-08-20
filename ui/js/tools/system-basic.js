// Tool 4: Environment Variables Manager
const EnvTool = {
  activeScope: 'User', // 'User' | 'Machine' | 'PathAnalysis'
  envData: { userVars: [], machineVars: [], pathAnalysis: [] },

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs">
              <button class="tool-tab-btn ${this.activeScope === 'User' ? 'active' : ''}" id="tabEnvUser">用户变量 (User)</button>
              <button class="tool-tab-btn ${this.activeScope === 'Machine' ? 'active' : ''}" id="tabEnvMachine">系统变量 (Machine)</button>
              <button class="tool-tab-btn ${this.activeScope === 'PathAnalysis' ? 'active' : ''}" id="tabEnvPath">Path 路径分析器</button>
            </div>
            <input type="text" class="form-control form-control-sm" id="envSearchInput" placeholder="检索环境变量..." style="width: 220px;">
          </div>
          <div class="tool-toolbar-right">
            <button class="btn btn-outline-primary btn-sm d-flex align-items-center gap-1" id="btnAddEnv">
              <i data-lucide="plus" style="width: 14px; height: 14px;"></i> 新增变量
            </button>
            <button class="btn btn-primary btn-sm d-flex align-items-center gap-1" id="btnRefreshEnv">
              <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> 刷新
            </button>
          </div>
        </div>

        <!-- Normal Env Vars Table -->
        <div id="panelEnvNormal" class="table-card ${this.activeScope === 'PathAnalysis' ? 'd-none' : ''}">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th style="width: 28%;">变量名称 (Name)</th>
                  <th>变量值 (Value)</th>
                  <th style="width: 120px;">操作</th>
                </tr>
              </thead>
              <tbody id="envTableBody">
                <tr><td colspan="3" class="text-center text-muted py-4">正在加载环境变量...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Path Analysis Panel -->
        <div id="panelEnvPath" class="table-card ${this.activeScope === 'PathAnalysis' ? '' : 'd-none'}">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th style="width: 80px;">序号</th>
                  <th>Path 目录路径</th>
                  <th style="width: 150px;">磁盘有效性</th>
                </tr>
              </thead>
              <tbody id="envPathTableBody">
                <tr><td colspan="3" class="text-center text-muted py-4">正在分析 Path 路径...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadEnvVars();
  },

  bindEvents(container) {
    const tabUser = container.querySelector('#tabEnvUser');
    const tabMachine = container.querySelector('#tabEnvMachine');
    const tabPath = container.querySelector('#tabEnvPath');
    const panelNormal = container.querySelector('#panelEnvNormal');
    const panelPath = container.querySelector('#panelEnvPath');
    const searchInput = container.querySelector('#envSearchInput');

    tabUser.onclick = () => {
      this.activeScope = 'User';
      tabUser.classList.add('active');
      tabMachine.classList.remove('active');
      tabPath.classList.remove('active');
      panelNormal.classList.remove('d-none');
      panelPath.classList.add('d-none');
      this.renderTable(searchInput.value.toLowerCase().trim());
    };

    tabMachine.onclick = () => {
      this.activeScope = 'Machine';
      tabMachine.classList.add('active');
      tabUser.classList.remove('active');
      tabPath.classList.remove('active');
      panelNormal.classList.remove('d-none');
      panelPath.classList.add('d-none');
      this.renderTable(searchInput.value.toLowerCase().trim());
    };

    tabPath.onclick = () => {
      this.activeScope = 'PathAnalysis';
      tabPath.classList.add('active');
      tabUser.classList.remove('active');
      tabMachine.classList.remove('active');
      panelNormal.classList.add('d-none');
      panelPath.classList.remove('d-none');
      this.renderPathTable();
    };

    container.querySelector('#btnRefreshEnv').onclick = () => this.loadEnvVars();
    container.querySelector('#btnAddEnv').onclick = () => this.openEditModal('', '', this.activeScope === 'Machine' ? 'Machine' : 'User');

    searchInput.oninput = (e) => this.renderTable(e.target.value.toLowerCase().trim());

    // Modal bindings
    const modal = document.getElementById('envVarModal');
    const btnClose = document.getElementById('btnCloseEnvModal');
    const btnCancel = document.getElementById('btnCancelEnvModal');
    const btnSave = document.getElementById('btnSaveEnvModal');

    [btnClose, btnCancel].forEach(b => {
      if (b) b.onclick = () => modal.classList.add('d-none');
    });

    if (btnSave) {
      btnSave.onclick = async () => {
        const name = document.getElementById('envModalName').value.trim();
        const value = document.getElementById('envModalValue').value;
        const scope = document.getElementById('envModalScope').value;

        if (!name) {
          Toast.show('变量名不能为空', 'warning');
          return;
        }

        if (scope === 'Machine' && !PrivilegeManager.isAdmin) {
          Toast.show('正在保存系统级环境变量（如权限不足将自动呼出 UAC 授权）...', 'info', 2500);
        }

        try {
          const res = await IPC.send('sys_set_env_var', { name, value, scope });
          Toast.show(res.message || `已保存变量 ${name}`, 'success', 2000);
          modal.classList.add('d-none');
          this.loadEnvVars();
        } catch (e) {
          Toast.show('保存环境变量失败: ' + e.message, 'error', 3500);
        }
      };
    }
  },

  async loadEnvVars() {
    try {
      const data = await IPC.send('sys_get_env_vars');
      this.envData = data || { userVars: [], machineVars: [], pathAnalysis: [] };
      const searchInput = document.getElementById('envSearchInput');
      if (this.activeScope === 'PathAnalysis') {
        this.renderPathTable();
      } else {
        this.renderTable(searchInput ? searchInput.value.toLowerCase().trim() : '');
      }
      Toast.show('环境变量已刷新', 'success', 1200);
    } catch (e) {
      Toast.show('加载环境变量失败: ' + e.message, 'error', 3000);
    }
  },

  renderTable(filter = '') {
    const tbody = document.getElementById('envTableBody');
    if (!tbody) return;

    let list = this.activeScope === 'Machine' ? this.envData.machineVars : this.envData.userVars;
    if (filter) {
      list = list.filter(v => v.name.toLowerCase().includes(filter) || v.value.toLowerCase().includes(filter));
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">未找到相关环境变量</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(v => `
      <tr>
        <td class="font-mono fw-bold text-primary">${v.name}</td>
        <td class="font-mono text-break" style="max-width: 500px;">${v.value}</td>
        <td>
          <div class="d-flex align-items-center gap-1">
            <button class="btn btn-outline-secondary btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="EnvTool.openEditModal('${v.name}', \`${v.value.replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`, '${v.scope}')">编辑</button>
            <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="EnvTool.deleteVar('${v.name}', '${v.scope}')">删除</button>
          </div>
        </td>
      </tr>
    `).join('');
  },

  renderPathTable() {
    const tbody = document.getElementById('envPathTableBody');
    if (!tbody) return;

    const list = this.envData.pathAnalysis || [];
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-4">Path 环境变量为空</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, idx) => {
      const badge = item.exists
        ? `<span class="status-pill success"><span class="status-dot"></span>有效目录</span>`
        : `<span class="status-pill danger"><span class="status-dot"></span>目录不存在/失效</span>`;

      return `
        <tr>
          <td class="font-mono text-muted">#${idx + 1}</td>
          <td class="font-mono ${item.exists ? '' : 'text-danger fw-bold'}">${item.path}</td>
          <td>${badge}</td>
        </tr>
      `;
    }).join('');
  },

  openEditModal(name, value, scope) {
    const modal = document.getElementById('envVarModal');
    const title = document.getElementById('envModalTitle');
    const inputName = document.getElementById('envModalName');
    const inputValue = document.getElementById('envModalValue');
    const selectScope = document.getElementById('envModalScope');

    if (title) title.textContent = name ? '编辑环境变量' : '新增环境变量';
    if (inputName) {
      inputName.value = name;
      inputName.disabled = Boolean(name); // Disable key modification on edit
    }
    if (inputValue) inputValue.value = value;
    if (selectScope) selectScope.value = scope || 'User';

    if (modal) modal.classList.remove('d-none');
  },

  async deleteVar(name, scope) {
    if (!confirm(`确定要删除 ${scope} 环境变量 [${name}] 吗？`)) return;
    if (scope === 'Machine' && !PrivilegeManager.isAdmin) {
      Toast.show('正在删除系统级环境变量（如权限不足将自动呼出 UAC 授权）...', 'info', 2500);
    }
    try {
      const res = await IPC.send('sys_delete_env_var', { name, scope });
      Toast.show(res.message || `已删除环境变量 ${name}`, 'success', 2000);
      this.loadEnvVars();
    } catch (e) {
      Toast.show('删除失败: ' + e.message, 'error', 3500);
    }
  }
};

// Tool 6: Hosts Editor
const HostsTool = {
  activeTab: 'visual',
  rawContent: '',
  hostsPath: '',

  render(container) {
    container.innerHTML = `
      <div class="tool-view-wrapper">
        <div class="tool-toolbar">
          <div class="tool-toolbar-left">
            <div class="tool-nav-tabs">
              <button class="tool-tab-btn ${this.activeTab === 'visual' ? 'active' : ''}" id="tabHostsVisual">规则列表视图</button>
              <button class="tool-tab-btn ${this.activeTab === 'raw' ? 'active' : ''}" id="tabHostsRaw">源码文本编辑</button>
            </div>
            <span class="small font-mono text-muted text-truncate" style="max-width: 320px;" id="hostsFilePath">C:\\Windows\\System32\\drivers\\etc\\hosts</span>
          </div>
          <div class="tool-toolbar-right">
            <button class="btn btn-outline-primary btn-sm d-flex align-items-center gap-1" id="btnAddHostRule">
              <i data-lucide="plus" style="width: 14px; height: 14px;"></i> 添加规则
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="btnBackupHosts">备份 Hosts</button>
            <button class="btn btn-primary btn-sm d-flex align-items-center gap-1" id="btnSaveHosts">
              <i data-lucide="save" style="width: 14px; height: 14px;"></i> 保存修改
            </button>
          </div>
        </div>

        <!-- Visual Table -->
        <div id="panelHostsVisual" class="table-card ${this.activeTab === 'visual' ? '' : 'd-none'}">
          <div class="table-responsive-container">
            <table class="modern-table">
              <thead>
                <tr>
                  <th style="width: 80px;">状态</th>
                  <th style="width: 25%;">IP 地址</th>
                  <th>映射域名 / 主机名</th>
                  <th>备注说明</th>
                  <th style="width: 80px;">操作</th>
                </tr>
              </thead>
              <tbody id="hostsRulesTbody">
                <tr><td colspan="5" class="text-center text-muted py-4">正在读取系统 Hosts 文件...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Raw Textarea Editor -->
        <div id="panelHostsRaw" class="table-card p-3 ${this.activeTab === 'raw' ? '' : 'd-none'}">
          <textarea class="code-editor-box flex-grow-1" id="hostsRawTextarea" rows="18" style="height: calc(100vh - 280px);"></textarea>
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.loadHosts();
  },

  bindEvents(container) {
    const tabVisual = container.querySelector('#tabHostsVisual');
    const tabRaw = container.querySelector('#tabHostsRaw');
    const panelVisual = container.querySelector('#panelHostsVisual');
    const panelRaw = container.querySelector('#panelHostsRaw');
    const textarea = container.querySelector('#hostsRawTextarea');

    tabVisual.onclick = () => {
      this.activeTab = 'visual';
      tabVisual.classList.add('active');
      tabRaw.classList.remove('active');
      panelVisual.classList.remove('d-none');
      panelRaw.classList.add('d-none');
      // If user typed in textarea, sync to rawContent
      if (textarea) this.rawContent = textarea.value;
      this.renderRulesTable();
    };

    tabRaw.onclick = () => {
      this.activeTab = 'raw';
      tabRaw.classList.add('active');
      tabVisual.classList.remove('active');
      panelRaw.classList.remove('d-none');
      panelVisual.classList.add('d-none');
      if (textarea) textarea.value = this.rawContent;
    };

    container.querySelector('#btnAddHostRule').onclick = () => {
      const modal = document.getElementById('addHostModal');
      if (modal) modal.classList.remove('d-none');
    };

    container.querySelector('#btnSaveHosts').onclick = () => this.saveHosts();
    container.querySelector('#btnBackupHosts').onclick = () => this.backupHosts();

    // Modal add host
    const modal = document.getElementById('addHostModal');
    const btnClose = document.getElementById('btnCloseHostModal');
    const btnCancel = document.getElementById('btnCancelHostModal');
    const btnSave = document.getElementById('btnSaveHostModal');

    [btnClose, btnCancel].forEach(b => {
      if (b) b.onclick = () => modal.classList.add('d-none');
    });

    if (btnSave) {
      btnSave.onclick = () => {
        const ip = document.getElementById('hostModalIp').value.trim();
        const domain = document.getElementById('hostModalDomain').value.trim();
        const comment = document.getElementById('hostModalComment').value.trim();

        if (!ip || !domain) {
          Toast.show('IP 与域名不能为空', 'warning');
          return;
        }

        const newLine = `${ip} ${domain}${comment ? ' # ' + comment : ''}\n`;
        this.rawContent = (this.rawContent.trim() ? this.rawContent.trim() + '\n' : '') + newLine;
        modal.classList.add('d-none');
        this.renderRulesTable();
        Toast.show('已添加规则（请点击“保存修改”写入磁盘）', 'info', 2500);
      };
    }
  },

  async loadHosts() {
    try {
      const res = await IPC.send('sys_get_hosts');
      this.rawContent = res.content || '';
      this.hostsPath = res.path || '';

      const pathEl = document.getElementById('hostsFilePath');
      const textarea = document.getElementById('hostsRawTextarea');
      if (pathEl) pathEl.textContent = this.hostsPath;
      if (textarea) textarea.value = this.rawContent;

      this.renderRulesTable();
      Toast.show('Hosts 文件加载成功', 'success', 1200);
    } catch (e) {
      Toast.show('读取 Hosts 文件失败: ' + e.message, 'error', 3000);
    }
  },

  parseRules() {
    const lines = this.rawContent.split('\n');
    const rules = [];

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const isCommented = trimmed.startsWith('#');
      const content = isCommented ? trimmed.replace(/^#\s*/, '') : trimmed;
      const parts = content.split(/[\s\t]+/).filter(Boolean);

      if (parts.length >= 2 && (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parts[0]) || parts[0] === '::1' || parts[0].includes(':'))) {
        const ip = parts[0];
        const domain = parts[1];
        const commentIndex = content.indexOf('#');
        const comment = commentIndex !== -1 ? content.substring(commentIndex + 1).trim() : '';

        rules.push({
          lineIndex: idx,
          enabled: !isCommented,
          ip,
          domain,
          comment
        });
      }
    });

    return rules;
  },

  renderRulesTable() {
    const tbody = document.getElementById('hostsRulesTbody');
    if (!tbody) return;

    const rules = this.parseRules();
    if (rules.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Hosts 中未解析出有效 IP 映射规则</td></tr>`;
      return;
    }

    tbody.innerHTML = rules.map(r => `
      <tr>
        <td>
          <div class="form-check form-switch m-0">
            <input class="form-check-input" type="checkbox" role="switch" ${r.enabled ? 'checked' : ''} onchange="HostsTool.toggleRule(${r.lineIndex}, this.checked)">
          </div>
        </td>
        <td class="font-mono fw-bold">${r.ip}</td>
        <td class="font-mono text-primary">${r.domain}</td>
        <td class="text-muted small">${r.comment || '-'}</td>
        <td>
          <button class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.75rem;" onclick="HostsTool.deleteRule(${r.lineIndex})">删除</button>
        </td>
      </tr>
    `).join('');
  },

  toggleRule(lineIndex, enabled) {
    const lines = this.rawContent.split('\n');
    if (lineIndex >= 0 && lineIndex < lines.length) {
      const line = lines[lineIndex];
      if (enabled) {
        lines[lineIndex] = line.replace(/^#\s*/, '');
      } else {
        lines[lineIndex] = '# ' + line.replace(/^#\s*/, '');
      }
      this.rawContent = lines.join('\n');
    }
  },

  deleteRule(lineIndex) {
    const lines = this.rawContent.split('\n');
    if (lineIndex >= 0 && lineIndex < lines.length) {
      lines.splice(lineIndex, 1);
      this.rawContent = lines.join('\n');
      this.renderRulesTable();
    }
  },

  async saveHosts() {
    const textarea = document.getElementById('hostsRawTextarea');
    if (this.activeTab === 'raw' && textarea) {
      this.rawContent = textarea.value;
    }

    if (!PrivilegeManager.isAdmin) {
      Toast.show('正在保存 Hosts（如遇系统权限限制将自动唤起 Windows UAC 授权）...', 'info', 2500);
    }

    try {
      const res = await IPC.send('sys_save_hosts', { content: this.rawContent });
      Toast.show(res.message || 'Hosts 文件已保存成功', 'success', 2500);
      this.loadHosts();
    } catch (e) {
      Toast.show('保存失败: ' + e.message, 'error', 4000);
    }
  },

  backupHosts() {
    const blob = new Blob([this.rawContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hosts_backup_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show('已导出 Hosts 备份文件', 'success', 2000);
  }
};


