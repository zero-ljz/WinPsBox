const RemoteConnectionCenterTool = {
  root: null,
  profiles: [],
  selectedId: '',
  testResults: new Map(),

  typeMeta: {
    rdp: { label: '远程桌面', icon: 'monitor-up', port: 3389 },
    ssh: { label: 'SSH', icon: 'square-terminal', port: 22 },
    smb: { label: '网络共享', icon: 'folder-network', port: 445 }
  },

  render(container) {
    this.root = container;
    this.profiles = [];
    this.selectedId = '';
    this.testResults.clear();
    container.innerHTML = `
      <div class="dev-tool-shell remote-connection-center">
        <div class="dev-command-bar">
          <div class="dev-title-status"><span class="dev-live-dot neutral" id="remoteDot"></span><div><strong id="remoteHeadline">正在读取连接配置</strong><span id="remoteSubline">RDP · SSH · SMB</span></div></div>
          <button class="dev-secondary-button" id="remoteNew"><i data-lucide="plus"></i><span>新建连接</span></button>
          <button class="dev-icon-button" id="remoteRefresh" title="刷新连接列表"><i data-lucide="refresh-cw"></i></button>
        </div>

        <div class="remote-summary" id="remoteSummary">
          <div><i data-lucide="monitor-up"></i><span>远程桌面</span><strong>-</strong></div>
          <div><i data-lucide="square-terminal"></i><span>SSH</span><strong>-</strong></div>
          <div><i data-lucide="folder-network"></i><span>网络共享</span><strong>-</strong></div>
          <div><i data-lucide="history"></i><span>最近使用</span><strong>-</strong></div>
        </div>

        <div class="remote-layout">
          <section class="dev-panel remote-list-panel">
            <header class="dev-panel-header">
              <div><i data-lucide="server-cog"></i><strong>连接列表</strong></div>
              <span class="dev-state-badge neutral" id="remoteCount">0 个</span>
            </header>
            <div class="remote-filter"><i data-lucide="search"></i><input id="remoteSearch" placeholder="搜索名称、主机或用户" autocomplete="off"></div>
            <div class="remote-profile-list" id="remoteProfileList">${DeveloperToolUi.loading('读取连接配置')}</div>
          </section>

          <section class="dev-panel remote-editor-panel">
            <header class="dev-panel-header">
              <div><i data-lucide="panel-right"></i><strong id="remoteEditorTitle">新建连接</strong></div>
              <span class="dev-state-badge neutral" id="remoteEditorState">未保存</span>
            </header>
            <div class="remote-form">
              <div class="dev-input-group remote-name-field"><label for="remoteName">连接名称</label><input class="dev-input" id="remoteName" maxlength="80" placeholder="例如：生产服务器"></div>
              <div class="dev-input-group"><label for="remoteType">连接类型</label><select class="dev-select" id="remoteType"><option value="rdp">远程桌面 RDP</option><option value="ssh">SSH 终端</option><option value="smb">网络共享 SMB</option></select></div>
              <div class="dev-input-group remote-host-field"><label for="remoteHost">主机名或 IP</label><input class="dev-input font-mono" id="remoteHost" maxlength="255" placeholder="server.example.com" spellcheck="false"></div>
              <div class="dev-input-group"><label for="remotePort">端口</label><input class="dev-input font-mono" id="remotePort" type="number" min="1" max="65535" value="3389"></div>
              <div class="dev-input-group" id="remoteUserGroup"><label for="remoteUser">用户名</label><input class="dev-input font-mono" id="remoteUser" maxlength="128" placeholder="DOMAIN\\user" spellcheck="false"></div>
              <div class="dev-input-group d-none" id="remoteShareGroup"><label for="remoteShare">共享名称</label><input class="dev-input font-mono" id="remoteShare" maxlength="80" placeholder="Projects" spellcheck="false"></div>
              <div class="dev-input-group remote-notes-field"><label for="remoteNotes">备注</label><input class="dev-input" id="remoteNotes" maxlength="300" placeholder="可选"></div>
            </div>
            <div class="remote-test-result neutral" id="remoteTestResult"><i data-lucide="radio"></i><span>尚未测试连接</span></div>
            <div class="remote-editor-actions">
              <button class="dev-secondary-button" id="remoteTest"><i data-lucide="activity"></i><span>测试</span></button>
              <button class="dev-primary-button" id="remoteConnect"><i data-lucide="plug-zap"></i><span>连接</span></button>
              <span></span>
              <button class="dev-text-button danger d-none" id="remoteDelete"><i data-lucide="trash-2"></i>删除</button>
              <button class="dev-secondary-button" id="remoteSave"><i data-lucide="save"></i><span>保存</span></button>
            </div>
          </section>
        </div>
      </div>`;

    container.querySelector('#remoteNew').onclick = () => this.newProfile();
    container.querySelector('#remoteRefresh').onclick = () => this.load();
    container.querySelector('#remoteSearch').oninput = () => this.renderList();
    container.querySelector('#remoteType').onchange = () => this.syncType(true);
    container.querySelector('#remoteSave').onclick = () => this.save();
    container.querySelector('#remoteDelete').onclick = () => this.remove();
    container.querySelector('#remoteTest').onclick = () => this.test();
    container.querySelector('#remoteConnect').onclick = () => this.connect();
    container.querySelector('#remoteProfileList').onclick = event => {
      const action = event.target.closest('[data-remote-action]');
      if (action) {
        event.stopPropagation();
        const profile = this.profiles.find(item => item.id === action.dataset.id);
        if (!profile) return;
        if (action.dataset.remoteAction === 'connect') this.connect(profile);
        if (action.dataset.remoteAction === 'test') this.test(profile);
        return;
      }
      const row = event.target.closest('[data-remote-id]');
      if (row) this.select(row.dataset.remoteId);
    };
    if (window.lucide) lucide.createIcons({ root: container });
    this.load();
  },

  async load(preferredId = this.selectedId) {
    const list = this.root.querySelector('#remoteProfileList');
    list.innerHTML = DeveloperToolUi.loading('读取连接配置');
    try {
      const profiles = await IPC.send('remote_get_profiles');
      if (!this.root.querySelector('.remote-connection-center')) return;
      this.profiles = profiles;
      this.root.querySelector('#remoteDot').className = 'dev-live-dot pass';
      this.root.querySelector('#remoteHeadline').textContent = this.profiles.length ? `${this.profiles.length} 个远程连接` : '连接中心已就绪';
      this.root.querySelector('#remoteSubline').textContent = 'RDP · SSH · SMB';
      this.updateSummary();
      this.renderList();
      if (preferredId && this.profiles.some(item => item.id === preferredId)) this.select(preferredId);
      else if (!this.selectedId && this.profiles.length) this.select(this.profiles[0].id);
      else if (!this.profiles.length) this.newProfile();
    } catch (error) {
      if (!this.root.querySelector('.remote-connection-center')) return;
      this.root.querySelector('#remoteDot').className = 'dev-live-dot warn';
      this.root.querySelector('#remoteHeadline').textContent = '连接配置读取失败';
      list.innerHTML = DeveloperToolUi.empty('circle-x', '无法读取连接配置', error.message);
      if (window.lucide) lucide.createIcons({ root: this.root });
    }
  },

  updateSummary() {
    const values = ['rdp', 'ssh', 'smb'].map(type => this.profiles.filter(item => item.type === type).length);
    const recent = this.profiles.find(item => item.lastUsedAt);
    const metrics = this.root.querySelectorAll('#remoteSummary strong');
    values.forEach((value, index) => { metrics[index].textContent = value; });
    metrics[3].textContent = recent ? recent.name : '无';
    this.root.querySelector('#remoteCount').textContent = `${this.profiles.length} 个`;
  },

  renderList() {
    const query = this.root.querySelector('#remoteSearch').value.trim().toLowerCase();
    const items = this.profiles.filter(item => [item.name, item.host, item.userName, item.shareName].some(value => String(value || '').toLowerCase().includes(query)));
    const list = this.root.querySelector('#remoteProfileList');
    list.innerHTML = items.length ? items.map(profile => {
      const meta = this.typeMeta[profile.type] || this.typeMeta.rdp;
      const result = this.testResults.get(profile.id);
      const endpoint = profile.type === 'smb' ? `\\\\${profile.host}\\${profile.shareName}` : `${profile.host}:${profile.port}`;
      return `<article class="remote-profile-row ${this.selectedId === profile.id ? 'selected' : ''}" data-remote-id="${DeveloperToolUi.escape(profile.id)}">
        <div class="remote-profile-icon ${profile.type}"><i data-lucide="${meta.icon}"></i></div>
        <div class="remote-profile-info"><div><strong>${DeveloperToolUi.escape(profile.name)}</strong><span>${meta.label}</span></div><code>${DeveloperToolUi.escape(endpoint)}</code>${profile.userName ? `<small>${DeveloperToolUi.escape(profile.userName)}</small>` : ''}</div>
        <div class="remote-row-state ${result ? (result.reachable ? 'pass' : 'error') : 'neutral'}" title="${result ? (result.reachable ? '连接可达' : '连接不可达') : '尚未测试'}"></div>
        <div class="remote-row-actions"><button class="dev-icon-button" data-remote-action="test" data-id="${DeveloperToolUi.escape(profile.id)}" title="测试连接"><i data-lucide="activity"></i></button><button class="dev-primary-button compact-button" data-remote-action="connect" data-id="${DeveloperToolUi.escape(profile.id)}"><i data-lucide="plug-zap"></i><span>连接</span></button></div>
      </article>`;
    }).join('') : DeveloperToolUi.empty('server-off', query ? '没有匹配的连接' : '还没有保存连接');
    if (window.lucide) lucide.createIcons({ root: list });
  },

  newProfile() {
    this.selectedId = '';
    this.root.querySelector('#remoteEditorTitle').textContent = '新建连接';
    this.root.querySelector('#remoteEditorState').textContent = '未保存';
    this.root.querySelector('#remoteEditorState').className = 'dev-state-badge neutral';
    this.root.querySelector('#remoteName').value = '';
    this.root.querySelector('#remoteType').value = 'rdp';
    this.root.querySelector('#remoteHost').value = '';
    this.root.querySelector('#remotePort').value = '3389';
    this.root.querySelector('#remoteUser').value = '';
    this.root.querySelector('#remoteShare').value = '';
    this.root.querySelector('#remoteNotes').value = '';
    this.root.querySelector('#remoteDelete').classList.add('d-none');
    this.resetTestResult();
    this.syncType(false);
    this.renderList();
    this.root.querySelector('#remoteName').focus();
  },

  select(id) {
    const profile = this.profiles.find(item => item.id === id);
    if (!profile) return;
    this.selectedId = id;
    this.root.querySelector('#remoteEditorTitle').textContent = profile.name;
    this.root.querySelector('#remoteEditorState').textContent = '已保存';
    this.root.querySelector('#remoteEditorState').className = 'dev-state-badge pass';
    this.root.querySelector('#remoteName').value = profile.name || '';
    this.root.querySelector('#remoteType').value = profile.type || 'rdp';
    this.root.querySelector('#remoteHost').value = profile.host || '';
    this.root.querySelector('#remotePort').value = profile.port || this.typeMeta[profile.type]?.port || 22;
    this.root.querySelector('#remoteUser').value = profile.userName || '';
    this.root.querySelector('#remoteShare').value = profile.shareName || '';
    this.root.querySelector('#remoteNotes').value = profile.notes || '';
    this.root.querySelector('#remoteDelete').classList.remove('d-none');
    this.syncType(false);
    this.showTestResult(this.testResults.get(id));
    this.renderList();
  },

  syncType(resetPort) {
    const type = this.root.querySelector('#remoteType').value;
    if (resetPort) this.root.querySelector('#remotePort').value = this.typeMeta[type].port;
    this.root.querySelector('#remoteShareGroup').classList.toggle('d-none', type !== 'smb');
    this.root.querySelector('#remoteUserGroup').classList.toggle('d-none', type === 'smb');
    this.root.querySelector('#remoteConnect span').textContent = type === 'smb' ? '打开共享' : '连接';
  },

  getDraft(source = null) {
    if (source) return { ...source };
    return {
      id: this.selectedId,
      name: this.root.querySelector('#remoteName').value.trim(),
      type: this.root.querySelector('#remoteType').value,
      host: this.root.querySelector('#remoteHost').value.trim(),
      port: Number(this.root.querySelector('#remotePort').value),
      userName: this.root.querySelector('#remoteUser').value.trim(),
      shareName: this.root.querySelector('#remoteShare').value.trim(),
      notes: this.root.querySelector('#remoteNotes').value.trim()
    };
  },

  async save() {
    const button = this.root.querySelector('#remoteSave');
    button.disabled = true;
    try {
      const result = await IPC.send('remote_save_profile', { profile: this.getDraft() });
      this.selectedId = result.profile.id;
      Toast.show('远程连接已保存', 'success');
      await this.load(this.selectedId);
    } catch (error) {
      Toast.show('保存失败: ' + error.message, 'error', 3500);
    } finally { button.disabled = false; }
  },

  async remove() {
    const profile = this.profiles.find(item => item.id === this.selectedId);
    if (!profile || !confirm(`确定删除连接“${profile.name}”吗？`)) return;
    try {
      await IPC.send('remote_remove_profile', { id: profile.id });
      this.selectedId = '';
      this.testResults.delete(profile.id);
      Toast.show('连接配置已删除', 'success');
      await this.load();
    } catch (error) { Toast.show('删除失败: ' + error.message, 'error'); }
  },

  async test(source = null) {
    const profile = this.getDraft(source);
    const button = this.root.querySelector('#remoteTest');
    if (!source) button.disabled = true;
    this.showTestResult(null, true);
    try {
      const result = await IPC.send('remote_test_profile', { profile });
      if (profile.id) this.testResults.set(profile.id, result);
      this.showTestResult(result);
      this.renderList();
      Toast.show(result.reachable ? '目标端口可以连接' : '目标端口无法连接', result.reachable ? 'success' : 'warning');
    } catch (error) {
      this.showTestResult({ reachable: false, error: error.message });
      Toast.show('测试失败: ' + error.message, 'error');
    } finally { if (!source) button.disabled = false; }
  },

  async connect(source = null) {
    const profile = this.getDraft(source);
    try {
      const result = await IPC.send('remote_open_profile', { profile });
      Toast.show(`${result.type === 'smb' ? '已打开' : '已启动连接'}：${result.target}`, 'success', 2600);
      if (profile.id) await this.load(profile.id);
    } catch (error) { Toast.show('连接失败: ' + error.message, 'error', 3500); }
  },

  resetTestResult() { this.showTestResult(); },

  showTestResult(result = null, loading = false) {
    const box = this.root.querySelector('#remoteTestResult');
    if (loading) {
      box.className = 'remote-test-result info';
      box.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>正在解析主机并测试端口</span>';
    } else if (!result) {
      box.className = 'remote-test-result neutral';
      box.innerHTML = '<i data-lucide="radio"></i><span>尚未测试连接</span>';
    } else {
      box.className = `remote-test-result ${result.reachable ? 'pass' : 'error'}`;
      const address = (result.addresses || []).join(', ');
      box.innerHTML = `<i data-lucide="${result.reachable ? 'circle-check' : 'circle-x'}"></i><span>${result.reachable ? `端口可达 · ${Number(result.latencyMs || 0).toFixed(1)} ms${address ? ` · ${DeveloperToolUi.escape(address)}` : ''}` : DeveloperToolUi.escape(result.error || '端口不可达')}</span>`;
    }
    if (window.lucide) lucide.createIcons({ root: box });
  }
};

const SharedFolderManagerTool = {
  root: null,
  state: null,
  selectedName: '',

  render(container) {
    this.root = container;
    this.state = null;
    this.selectedName = '';
    container.innerHTML = `
      <div class="dev-tool-shell smb-manager">
        <div class="dev-command-bar">
          <div class="dev-title-status"><span class="dev-live-dot neutral" id="smbDot"></span><div><strong id="smbHeadline">正在读取 Windows 共享</strong><span id="smbSubline">-</span></div></div>
          <span class="dev-state-badge neutral" id="smbPrivilege">检测权限</span>
          <button class="dev-secondary-button" id="smbNew"><i data-lucide="folder-plus"></i><span>新建共享</span></button>
          <button class="dev-icon-button" id="smbRefresh" title="刷新共享状态"><i data-lucide="refresh-cw"></i></button>
        </div>

        <div class="smb-summary">
          <div><i data-lucide="folder-network"></i><span>普通共享</span><strong id="smbShareCount">-</strong></div>
          <div><i data-lucide="shield-check"></i><span>系统共享</span><strong id="smbSystemCount">-</strong></div>
          <div><i data-lucide="users"></i><span>活动会话</span><strong id="smbSessionCount">-</strong></div>
          <div><i data-lucide="file-lock-2"></i><span>远程文件</span><strong id="smbFileCount">-</strong></div>
        </div>

        <section class="dev-panel smb-create-panel d-none" id="smbCreatePanel">
          <header class="dev-panel-header"><div><i data-lucide="folder-plus"></i><strong>创建共享文件夹</strong></div><button class="dev-icon-button" id="smbCloseCreate" title="关闭"><i data-lucide="x"></i></button></header>
          <div class="smb-create-form">
            <div class="dev-input-group"><label for="smbCreateName">共享名称</label><input class="dev-input font-mono" id="smbCreateName" maxlength="80" placeholder="Projects"></div>
            <div class="dev-input-group smb-path-field"><label for="smbCreatePath">本地文件夹</label><div class="smb-path-input"><input class="dev-input font-mono" id="smbCreatePath" placeholder="D:\\Projects"><button class="dev-icon-button" id="smbBrowse" title="选择文件夹"><i data-lucide="folder-open"></i></button></div></div>
            <div class="dev-input-group"><label for="smbCreateAccess">初始权限</label><select class="dev-select" id="smbCreateAccess"><option value="Read">读取</option><option value="Change">更改</option><option value="Full">完全控制</option></select></div>
            <div class="dev-input-group"><label for="smbCreateAccounts">访问账户</label><input class="dev-input font-mono" id="smbCreateAccounts" placeholder="DOMAIN\\user"></div>
            <div class="dev-input-group smb-description-field"><label for="smbCreateDescription">描述</label><input class="dev-input" id="smbCreateDescription" maxlength="256" placeholder="可选"></div>
            <button class="dev-primary-button" id="smbCreate"><i data-lucide="folder-plus"></i><span>创建共享</span></button>
          </div>
        </section>

        <section class="dev-panel">
          <header class="dev-panel-header"><div><i data-lucide="folders"></i><strong>本机共享</strong></div><span class="dev-state-badge neutral" id="smbListCount">0 个</span></header>
          <div class="smb-share-list" id="smbShareList">${DeveloperToolUi.loading('枚举 SMB 共享')}</div>
        </section>

        <div class="smb-detail-grid">
          <section class="dev-panel">
            <header class="dev-panel-header"><div><i data-lucide="shield"></i><strong id="smbAccessTitle">共享权限</strong></div><button class="dev-text-button" id="smbCopyUnc" disabled><i data-lucide="copy"></i>复制路径</button></header>
            <div class="smb-permission-list" id="smbPermissionList">${DeveloperToolUi.empty('mouse-pointer-click', '选择一个共享')}</div>
            <div class="smb-grant-row d-none" id="smbGrantRow"><input class="dev-input font-mono" id="smbGrantAccount" placeholder="DOMAIN\\user"><select class="dev-select" id="smbGrantRight"><option value="Read">读取</option><option value="Change">更改</option><option value="Full">完全控制</option></select><button class="dev-primary-button" id="smbGrant"><i data-lucide="user-plus"></i><span>授予</span></button></div>
          </section>

          <section class="dev-panel">
            <header class="dev-panel-header"><div><i data-lucide="users"></i><strong>活动会话</strong></div><span class="dev-state-badge neutral" id="smbSessionBadge">0 个</span></header>
            <div class="smb-session-list" id="smbSessionList">${DeveloperToolUi.loading('读取活动会话')}</div>
          </section>
        </div>

        <section class="dev-panel">
          <header class="dev-panel-header"><div><i data-lucide="file-lock-2"></i><strong>远程打开的文件</strong></div><span class="dev-state-badge neutral" id="smbFileBadge">0 个</span></header>
          <div class="smb-file-list" id="smbFileList">${DeveloperToolUi.loading('读取远程文件')}</div>
        </section>
      </div>`;

    container.querySelector('#smbRefresh').onclick = () => this.load();
    container.querySelector('#smbNew').onclick = () => this.toggleCreate(true);
    container.querySelector('#smbCloseCreate').onclick = () => this.toggleCreate(false);
    container.querySelector('#smbBrowse').onclick = () => this.browse();
    container.querySelector('#smbCreate').onclick = () => this.createShare();
    container.querySelector('#smbCopyUnc').onclick = () => this.copySelectedUnc();
    container.querySelector('#smbGrant').onclick = () => this.grant();
    container.querySelector('#smbShareList').onclick = event => this.handleShareListClick(event);
    container.querySelector('#smbPermissionList').onclick = event => this.handlePermissionClick(event);
    container.querySelector('#smbSessionList').onclick = event => this.handleSessionClick(event);
    container.querySelector('#smbFileList').onclick = event => this.handleFileClick(event);
    if (window.lucide) lucide.createIcons({ root: container });
    this.load();
  },

  async load(preferredName = this.selectedName) {
    try {
      const state = await IPC.send('smb_get_state');
      if (!this.root.querySelector('.smb-manager')) return;
      this.state = state;
      if (!state.available) throw new Error(state.error || 'SMB 管理功能不可用');
      const ordinary = (this.state.shares || []).filter(item => !item.special);
      const special = (this.state.shares || []).filter(item => item.special);
      this.root.querySelector('#smbDot').className = 'dev-live-dot pass';
      this.root.querySelector('#smbHeadline').textContent = `${this.state.computerName} 的共享文件夹`;
      this.root.querySelector('#smbSubline').textContent = `${ordinary.length} 个普通共享 · ${(this.state.sessions || []).length} 个活动会话`;
      this.root.querySelector('#smbPrivilege').textContent = this.state.isAdmin ? '管理员' : '按需提权';
      this.root.querySelector('#smbPrivilege').className = `dev-state-badge ${this.state.isAdmin ? 'pass' : 'info'}`;
      this.root.querySelector('#smbShareCount').textContent = ordinary.length;
      this.root.querySelector('#smbSystemCount').textContent = special.length;
      this.root.querySelector('#smbSessionCount').textContent = (this.state.sessions || []).length;
      this.root.querySelector('#smbFileCount').textContent = (this.state.openFiles || []).length;
      this.root.querySelector('#smbListCount').textContent = `${this.state.shares.length} 个`;
      this.root.querySelector('#smbSessionBadge').textContent = `${(this.state.sessions || []).length} 个`;
      this.root.querySelector('#smbFileBadge').textContent = `${(this.state.openFiles || []).length} 个`;
      this.root.querySelector('#smbCreateAccounts').placeholder = this.state.currentUser || 'DOMAIN\\user';
      if (!this.root.querySelector('#smbCreateAccounts').value) this.root.querySelector('#smbCreateAccounts').value = this.state.currentUser || '';
      this.renderShares();
      this.renderSessions();
      this.renderFiles();
      const fallback = ordinary[0] || this.state.shares[0];
      if (preferredName && this.state.shares.some(item => item.name === preferredName)) this.selectShare(preferredName);
      else if (fallback) this.selectShare(fallback.name);
      else this.selectShare('');
    } catch (error) {
      if (!this.root.querySelector('.smb-manager')) return;
      this.root.querySelector('#smbDot').className = 'dev-live-dot warn';
      this.root.querySelector('#smbHeadline').textContent = '共享状态读取失败';
      this.root.querySelector('#smbShareList').innerHTML = DeveloperToolUi.empty('circle-x', '无法读取 Windows 共享', error.message);
      if (window.lucide) lucide.createIcons({ root: this.root });
    }
  },

  renderShares() {
    const shares = this.state.shares || [];
    this.root.querySelector('#smbShareList').innerHTML = shares.length ? shares.map(share => `
      <article class="smb-share-row ${this.selectedName === share.name ? 'selected' : ''}" data-smb-name="${DeveloperToolUi.escape(share.name)}">
        <div class="smb-share-icon ${share.special ? 'special' : ''}"><i data-lucide="${share.special ? 'shield' : 'folder-network'}"></i></div>
        <div class="smb-share-info"><div><strong>${DeveloperToolUi.escape(share.name)}</strong>${share.special ? '<span>系统</span>' : ''}</div><code>${DeveloperToolUi.escape(share.path || share.uncPath)}</code><small>${DeveloperToolUi.escape(share.description || '无描述')}</small></div>
        <div class="smb-share-users"><strong>${share.currentUsers || 0}</strong><span>连接</span></div>
        <div class="smb-share-actions"><button class="dev-icon-button" data-smb-action="copy" data-name="${DeveloperToolUi.escape(share.name)}" title="复制 UNC 路径"><i data-lucide="copy"></i></button><button class="dev-icon-button" data-smb-action="open" data-name="${DeveloperToolUi.escape(share.name)}" title="打开共享"><i data-lucide="folder-open"></i></button>${share.special ? '' : `<button class="dev-icon-button danger" data-smb-action="remove" data-name="${DeveloperToolUi.escape(share.name)}" title="删除共享"><i data-lucide="trash-2"></i></button>`}</div>
      </article>`).join('') : DeveloperToolUi.empty('folder-off', '本机没有共享文件夹');
    if (window.lucide) lucide.createIcons({ root: this.root.querySelector('#smbShareList') });
  },

  selectShare(name) {
    this.selectedName = name;
    const share = this.selectedShare();
    this.root.querySelector('#smbAccessTitle').textContent = share ? `${share.name} 的共享权限` : '共享权限';
    this.root.querySelector('#smbCopyUnc').disabled = !share;
    this.root.querySelector('#smbGrantRow').classList.toggle('d-none', !share || share.special);
    const list = this.root.querySelector('#smbPermissionList');
    list.innerHTML = share ? ((share.access || []).length ? share.access.map(access => `
      <article class="smb-permission-row"><div class="smb-account-icon"><i data-lucide="${access.accessControlType === 'Deny' ? 'user-x' : 'user-check'}"></i></div><div><strong>${DeveloperToolUi.escape(access.accountName)}</strong><span>${access.accessControlType === 'Deny' ? '拒绝' : '允许'} · ${this.accessLabel(access.accessRight)}</span></div>${share.special ? '' : `<button class="dev-icon-button danger" data-smb-revoke="${DeveloperToolUi.escape(access.accountName)}" title="撤销权限"><i data-lucide="user-minus"></i></button>`}</article>`).join('') : DeveloperToolUi.empty('shield-question', '未读取到共享权限')) : DeveloperToolUi.empty('mouse-pointer-click', '选择一个共享');
    this.renderShares();
    if (window.lucide) lucide.createIcons({ root: this.root });
  },

  selectedShare() { return (this.state?.shares || []).find(item => item.name === this.selectedName); },
  accessLabel(value) { return ({ Read: '读取', Change: '更改', Full: '完全控制' })[value] || value; },

  renderSessions() {
    const sessions = this.state.sessions || [];
    const list = this.root.querySelector('#smbSessionList');
    if (this.state.sessionError && !sessions.length) {
      list.innerHTML = DeveloperToolUi.empty('shield-alert', '需要管理员权限查看会话', this.state.sessionError);
    } else {
      list.innerHTML = sessions.length ? sessions.map(session => `<article class="smb-session-row"><div><strong>${DeveloperToolUi.escape(session.clientUserName || '未知用户')}</strong><code>${DeveloperToolUi.escape(session.clientComputerName || '-')}</code></div><span>${session.numOpens || 0} 个文件 · 空闲 ${this.duration(session.secondsIdle)}</span><button class="dev-icon-button danger" data-smb-session="${DeveloperToolUi.escape(session.sessionId)}" title="断开会话"><i data-lucide="unplug"></i></button></article>`).join('') : DeveloperToolUi.empty('users', '当前没有远程会话');
    }
    if (window.lucide) lucide.createIcons({ root: list });
  },

  renderFiles() {
    const files = this.state.openFiles || [];
    const list = this.root.querySelector('#smbFileList');
    if (this.state.openFileError && !files.length) {
      list.innerHTML = DeveloperToolUi.empty('shield-alert', '需要管理员权限查看远程文件', this.state.openFileError);
    } else {
      list.innerHTML = files.length ? files.map(file => `<article class="smb-file-row"><div class="smb-file-icon"><i data-lucide="file"></i></div><div><strong>${DeveloperToolUi.escape(file.shareRelativePath || file.path)}</strong><span>${DeveloperToolUi.escape(file.clientUserName)} · ${DeveloperToolUi.escape(file.clientComputerName)}</span><code>${DeveloperToolUi.escape(file.path)}</code></div><span>${file.locks || 0} 个锁</span><button class="dev-icon-button danger" data-smb-file="${DeveloperToolUi.escape(file.fileId)}" title="关闭远程文件"><i data-lucide="file-x-2"></i></button></article>`).join('') : DeveloperToolUi.empty('file-check-2', '当前没有远程打开的文件');
    }
    if (window.lucide) lucide.createIcons({ root: list });
  },

  duration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${value} 秒`;
    if (value < 3600) return `${Math.floor(value / 60)} 分钟`;
    return `${Math.floor(value / 3600)} 小时`;
  },

  toggleCreate(show) {
    this.root.querySelector('#smbCreatePanel').classList.toggle('d-none', !show);
    if (show) this.root.querySelector('#smbCreateName').focus();
  },

  async browse() {
    try {
      const result = await IPC.send('smb_select_folder');
      if (!result.cancelled && result.path) this.root.querySelector('#smbCreatePath').value = result.path;
    } catch (error) { Toast.show('选择文件夹失败: ' + error.message, 'error'); }
  },

  async createShare() {
    const parameters = {
      name: this.root.querySelector('#smbCreateName').value.trim(),
      path: this.root.querySelector('#smbCreatePath').value.trim(),
      description: this.root.querySelector('#smbCreateDescription').value.trim(),
      accessRight: this.root.querySelector('#smbCreateAccess').value,
      accounts: this.root.querySelector('#smbCreateAccounts').value.split(/[,;\n]/).map(value => value.trim()).filter(Boolean)
    };
    const button = this.root.querySelector('#smbCreate');
    button.disabled = true;
    try {
      await IPC.send('smb_operate', { operation: 'create', parameters }, { requestTimeoutMs: 5 * 60 * 1000 });
      Toast.show('共享文件夹已创建', 'success');
      this.toggleCreate(false);
      this.root.querySelector('#smbCreateName').value = '';
      this.root.querySelector('#smbCreatePath').value = '';
      this.root.querySelector('#smbCreateDescription').value = '';
      await this.load(parameters.name);
    } catch (error) { Toast.show('创建失败: ' + error.message, 'error', 4200); }
    finally { button.disabled = false; }
  },

  async operate(operation, parameters, successMessage) {
    try {
      await IPC.send('smb_operate', { operation, parameters }, { requestTimeoutMs: 5 * 60 * 1000 });
      Toast.show(successMessage, 'success');
      await this.load();
    } catch (error) { Toast.show('操作失败: ' + error.message, 'error', 4200); }
  },

  handleShareListClick(event) {
    const action = event.target.closest('[data-smb-action]');
    if (action) {
      const share = (this.state.shares || []).find(item => item.name === action.dataset.name);
      if (!share) return;
      if (action.dataset.smbAction === 'copy') DeveloperToolUi.copy(share.uncPath, '共享路径');
      if (action.dataset.smbAction === 'open') IPC.send('smb_open_location', { path: share.uncPath }).catch(error => Toast.show('打开失败: ' + error.message, 'error'));
      if (action.dataset.smbAction === 'remove' && confirm(`确定删除共享“${share.name}”吗？本地文件不会被删除。`)) this.operate('remove', { name: share.name }, '共享已删除，本地文件保持不变');
      return;
    }
    const row = event.target.closest('[data-smb-name]');
    if (row) this.selectShare(row.dataset.smbName);
  },

  handlePermissionClick(event) {
    const button = event.target.closest('[data-smb-revoke]');
    if (!button) return;
    const account = button.dataset.smbRevoke;
    if (confirm(`确定撤销 ${account} 对“${this.selectedName}”的共享权限吗？`)) this.operate('revoke', { name: this.selectedName, account }, '共享权限已撤销');
  },

  grant() {
    const account = this.root.querySelector('#smbGrantAccount').value.trim();
    if (!account) { Toast.show('请输入账户名称', 'warning'); return; }
    this.operate('grant', { name: this.selectedName, account, accessRight: this.root.querySelector('#smbGrantRight').value }, '共享权限已授予');
    this.root.querySelector('#smbGrantAccount').value = '';
  },

  handleSessionClick(event) {
    const button = event.target.closest('[data-smb-session]');
    if (button && confirm('确定断开这个 SMB 会话吗？对方正在使用的共享连接会中断。')) this.operate('closeSession', { sessionId: button.dataset.smbSession }, 'SMB 会话已断开');
  },

  handleFileClick(event) {
    const button = event.target.closest('[data-smb-file]');
    if (button && confirm('确定强制关闭这个远程文件吗？未保存的数据可能丢失。')) this.operate('closeFile', { fileId: button.dataset.smbFile }, '远程文件已关闭');
  },

  copySelectedUnc() {
    const share = this.selectedShare();
    if (share) DeveloperToolUi.copy(share.uncPath, '共享路径');
  }
};
