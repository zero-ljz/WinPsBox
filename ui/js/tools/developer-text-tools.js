const DeveloperTextTool = {
  root: null,
  activeMode: 'json',

  modes: [
    { id: 'json', label: 'JSON', icon: 'braces' },
    { id: 'base64', label: 'Base64', icon: 'binary' },
    { id: 'url', label: 'URL', icon: 'link' },
    { id: 'jwt', label: 'JWT', icon: 'key-round' },
    { id: 'time', label: '时间戳', icon: 'clock-3' },
    { id: 'hash', label: '摘要', icon: 'fingerprint' },
    { id: 'uuid', label: 'UUID', icon: 'scan-line' }
  ],

  render(container) {
    this.root = container;
    container.innerHTML = `
      <div class="text-tool-shell">
        <div class="text-tool-tabs" role="tablist">
          ${this.modes.map(mode => `<button type="button" data-text-mode="${mode.id}" class="${mode.id === this.activeMode ? 'active' : ''}"><i data-lucide="${mode.icon}"></i><span>${mode.label}</span></button>`).join('')}
        </div>
        <div class="text-tool-workspace" id="textToolWorkspace"></div>
      </div>`;
    container.querySelector('.text-tool-tabs').onclick = event => {
      const button = event.target.closest('[data-text-mode]');
      if (!button) return;
      this.activeMode = button.dataset.textMode;
      container.querySelectorAll('[data-text-mode]').forEach(item => item.classList.toggle('active', item === button));
      this.renderMode();
    };
    this.renderMode();
    if (window.lucide) lucide.createIcons({ root: container });
  },

  renderMode() {
    const workspace = this.root.querySelector('#textToolWorkspace');
    const renderers = {
      json: () => this.renderJson(workspace),
      base64: () => this.renderBase64(workspace),
      url: () => this.renderUrl(workspace),
      jwt: () => this.renderJwt(workspace),
      time: () => this.renderTime(workspace),
      hash: () => this.renderHash(workspace),
      uuid: () => this.renderUuid(workspace)
    };
    renderers[this.activeMode]();
    if (window.lucide) lucide.createIcons({ root: workspace });
  },

  editorLayout({ inputLabel, outputLabel, inputPlaceholder = '', inputValue = '', actions = '' }) {
    return `
      <div class="text-editor-toolbar">${actions}</div>
      <div class="text-editor-grid">
        <section class="text-editor-pane">
          <header><span>${inputLabel}</span><button class="dev-icon-button" data-clear-input title="清空"><i data-lucide="eraser"></i></button></header>
          <textarea class="text-area font-mono" id="textInput" spellcheck="false" placeholder="${DeveloperToolUi.escape(inputPlaceholder)}">${DeveloperToolUi.escape(inputValue)}</textarea>
        </section>
        <section class="text-editor-pane">
          <header><span>${outputLabel}</span><button class="dev-icon-button" data-copy-output title="复制结果"><i data-lucide="copy"></i></button></header>
          <textarea class="text-area font-mono" id="textOutput" spellcheck="false" readonly></textarea>
        </section>
      </div>
      <div class="text-status" id="textStatus"><i data-lucide="circle-dot"></i><span>就绪</span></div>`;
  },

  bindEditors(handler) {
    const input = this.root.querySelector('#textInput');
    const output = this.root.querySelector('#textOutput');
    const clear = this.root.querySelector('[data-clear-input]');
    const copy = this.root.querySelector('[data-copy-output]');
    if (clear) clear.onclick = () => { input.value = ''; output.value = ''; this.setStatus('就绪'); input.focus(); };
    if (copy) copy.onclick = () => DeveloperToolUi.copy(output.value, '结果');
    if (handler) input.oninput = () => handler(input.value, output);
  },

  setStatus(text, type = 'neutral') {
    const status = this.root.querySelector('#textStatus');
    if (!status) return;
    status.className = `text-status ${type}`;
    status.querySelector('span').textContent = text;
  },

  renderJson(workspace) {
    workspace.innerHTML = this.editorLayout({
      inputLabel: 'JSON 输入', outputLabel: '处理结果', inputPlaceholder: '{\n  "name": "WinPsBox"\n}',
      actions: `
        <button class="dev-primary-button" data-json-action="format"><i data-lucide="align-left"></i><span>格式化</span></button>
        <button class="dev-secondary-button" data-json-action="minify"><i data-lucide="minimize-2"></i><span>压缩</span></button>
        <button class="dev-secondary-button" data-json-action="sort"><i data-lucide="arrow-down-a-z"></i><span>键排序</span></button>`
    });
    this.bindEditors();
    workspace.querySelector('.text-editor-toolbar').onclick = event => {
      const button = event.target.closest('[data-json-action]');
      if (!button) return;
      try {
        const parsed = JSON.parse(workspace.querySelector('#textInput').value);
        if (button.dataset.jsonAction === 'sort') {
          const sortObject = value => Array.isArray(value) ? value.map(sortObject) : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])])) : value;
          workspace.querySelector('#textOutput').value = JSON.stringify(sortObject(parsed), null, 2);
        } else {
          workspace.querySelector('#textOutput').value = JSON.stringify(parsed, null, button.dataset.jsonAction === 'format' ? 2 : 0);
        }
        this.setStatus('JSON 有效', 'pass');
      } catch (error) {
        workspace.querySelector('#textOutput').value = '';
        this.setStatus(error.message, 'error');
      }
    };
  },

  renderBase64(workspace) {
    workspace.innerHTML = this.editorLayout({
      inputLabel: '文本 / Base64', outputLabel: '转换结果', inputPlaceholder: '输入 UTF-8 文本或 Base64 字符串',
      actions: `
        <button class="dev-primary-button" data-b64-action="encode"><i data-lucide="arrow-right"></i><span>编码</span></button>
        <button class="dev-secondary-button" data-b64-action="decode"><i data-lucide="arrow-left"></i><span>解码</span></button>
        <label class="text-inline-toggle"><input type="checkbox" id="base64UrlSafe"><span>URL Safe</span></label>`
    });
    this.bindEditors();
    workspace.querySelector('.text-editor-toolbar').onclick = event => {
      const button = event.target.closest('[data-b64-action]');
      if (!button) return;
      const input = workspace.querySelector('#textInput').value;
      const urlSafe = workspace.querySelector('#base64UrlSafe').checked;
      try {
        if (button.dataset.b64Action === 'encode') {
          const bytes = new TextEncoder().encode(input);
          let binary = '';
          bytes.forEach(byte => { binary += String.fromCharCode(byte); });
          let encoded = btoa(binary);
          if (urlSafe) encoded = encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
          workspace.querySelector('#textOutput').value = encoded;
        } else {
          let encoded = input.trim().replaceAll('-', '+').replaceAll('_', '/');
          encoded += '='.repeat((4 - encoded.length % 4) % 4);
          const binary = atob(encoded);
          workspace.querySelector('#textOutput').value = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
        }
        this.setStatus('转换完成', 'pass');
      } catch (error) { this.setStatus('输入不是有效的 Base64', 'error'); }
    };
  },

  renderUrl(workspace) {
    workspace.innerHTML = this.editorLayout({
      inputLabel: '文本 / URL', outputLabel: '转换结果', inputPlaceholder: 'https://example.com/search?q=WinPsBox&lang=zh-CN',
      actions: `
        <button class="dev-primary-button" data-url-action="encode"><i data-lucide="lock-keyhole"></i><span>编码组件</span></button>
        <button class="dev-secondary-button" data-url-action="decode"><i data-lucide="lock-keyhole-open"></i><span>解码</span></button>
        <button class="dev-secondary-button" data-url-action="parse"><i data-lucide="list-tree"></i><span>解析 URL</span></button>`
    });
    this.bindEditors();
    workspace.querySelector('.text-editor-toolbar').onclick = event => {
      const button = event.target.closest('[data-url-action]');
      if (!button) return;
      const value = workspace.querySelector('#textInput').value;
      try {
        if (button.dataset.urlAction === 'encode') workspace.querySelector('#textOutput').value = encodeURIComponent(value);
        if (button.dataset.urlAction === 'decode') workspace.querySelector('#textOutput').value = decodeURIComponent(value.replaceAll('+', ' '));
        if (button.dataset.urlAction === 'parse') {
          const url = new URL(value);
          workspace.querySelector('#textOutput').value = JSON.stringify({
            protocol: url.protocol, host: url.host, pathname: url.pathname,
            query: Object.fromEntries(url.searchParams.entries()), hash: url.hash
          }, null, 2);
        }
        this.setStatus('转换完成', 'pass');
      } catch (error) { this.setStatus(error.message, 'error'); }
    };
  },

  renderJwt(workspace) {
    workspace.innerHTML = this.editorLayout({
      inputLabel: 'JWT Token', outputLabel: 'Header 与 Payload', inputPlaceholder: 'eyJhbGciOi...',
      actions: `<button class="dev-primary-button" data-jwt-decode><i data-lucide="scan-text"></i><span>解析 JWT</span></button><span class="text-toolbar-note">仅解码，不验证签名</span>`
    });
    this.bindEditors();
    workspace.querySelector('[data-jwt-decode]').onclick = () => {
      try {
        const parts = workspace.querySelector('#textInput').value.trim().split('.');
        if (parts.length !== 3) throw new Error('JWT 必须包含三个部分');
        const decodePart = part => {
          let base64 = part.replaceAll('-', '+').replaceAll('_', '/');
          base64 += '='.repeat((4 - base64.length % 4) % 4);
          const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
          return JSON.parse(new TextDecoder().decode(bytes));
        };
        const header = decodePart(parts[0]);
        const payload = decodePart(parts[1]);
        const result = { header, payload };
        if (payload.iat) result.issuedAt = new Date(payload.iat * 1000).toISOString();
        if (payload.exp) {
          result.expiresAt = new Date(payload.exp * 1000).toISOString();
          result.expired = payload.exp * 1000 < Date.now();
        }
        workspace.querySelector('#textOutput').value = JSON.stringify(result, null, 2);
        this.setStatus(result.expired ? 'Token 已过期' : 'Token 已解析', result.expired ? 'warn' : 'pass');
      } catch (error) { workspace.querySelector('#textOutput').value = ''; this.setStatus(error.message, 'error'); }
    };
  },

  renderTime(workspace) {
    const now = Date.now();
    workspace.innerHTML = `
      <div class="time-tool-grid">
        <section class="dev-panel time-now"><header class="dev-panel-header"><div><i data-lucide="radio-tower"></i><strong>当前时间</strong></div><button class="dev-icon-button" data-refresh-time title="刷新"><i data-lucide="refresh-cw"></i></button></header><strong id="timeNowSeconds">${Math.floor(now / 1000)}</strong><span id="timeNowIso">${new Date(now).toISOString()}</span></section>
        <section class="dev-panel"><header class="dev-panel-header"><div><i data-lucide="arrow-right-left"></i><strong>时间转换</strong></div></header><div class="time-form"><input class="dev-input font-mono" id="timeValue" value="${Math.floor(now / 1000)}"><select class="dev-select" id="timeUnit"><option value="auto">自动识别</option><option value="seconds">秒</option><option value="milliseconds">毫秒</option><option value="date">日期文本</option></select><button class="dev-primary-button" id="timeConvert"><i data-lucide="repeat-2"></i><span>转换</span></button></div><div class="time-result" id="timeResult"></div></section>
      </div>`;
    const refresh = () => {
      const value = Date.now();
      workspace.querySelector('#timeNowSeconds').textContent = Math.floor(value / 1000);
      workspace.querySelector('#timeNowIso').textContent = new Date(value).toISOString();
    };
    workspace.querySelector('[data-refresh-time]').onclick = refresh;
    workspace.querySelector('#timeConvert').onclick = () => {
      const raw = workspace.querySelector('#timeValue').value.trim();
      const unit = workspace.querySelector('#timeUnit').value;
      let date;
      if (unit === 'date' || (unit === 'auto' && !/^\d+$/.test(raw))) date = new Date(raw);
      else {
        const number = Number(raw);
        date = new Date(unit === 'seconds' || (unit === 'auto' && raw.length <= 10) ? number * 1000 : number);
      }
      const result = workspace.querySelector('#timeResult');
      if (Number.isNaN(date.getTime())) { result.innerHTML = '<span class="text-danger">无法识别该时间</span>'; return; }
      result.innerHTML = `<div><span>本地时间</span><strong>${DeveloperToolUi.escape(date.toLocaleString('zh-CN', { hour12: false }))}</strong></div><div><span>ISO 8601</span><strong class="font-mono">${date.toISOString()}</strong></div><div><span>Unix 秒</span><strong class="font-mono">${Math.floor(date.getTime() / 1000)}</strong></div><div><span>Unix 毫秒</span><strong class="font-mono">${date.getTime()}</strong></div>`;
    };
  },

  renderHash(workspace) {
    workspace.innerHTML = this.editorLayout({
      inputLabel: '原始文本', outputLabel: '消息摘要', inputPlaceholder: '输入要计算摘要的文本',
      actions: `<button class="dev-primary-button" data-hash="SHA-256"><i data-lucide="fingerprint"></i><span>SHA-256</span></button><button class="dev-secondary-button" data-hash="SHA-1"><span>SHA-1</span></button>`
    });
    this.bindEditors();
    workspace.querySelector('.text-editor-toolbar').onclick = async event => {
      const button = event.target.closest('[data-hash]');
      if (!button) return;
      try {
        const bytes = new TextEncoder().encode(workspace.querySelector('#textInput').value);
        const digest = await crypto.subtle.digest(button.dataset.hash, bytes);
        workspace.querySelector('#textOutput').value = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        this.setStatus(`${button.dataset.hash} 计算完成`, 'pass');
      } catch (error) { this.setStatus(error.message, 'error'); }
    };
  },

  renderUuid(workspace) {
    workspace.innerHTML = `
      <div class="uuid-tool">
        <div class="uuid-controls"><div class="dev-input-group"><label for="uuidCount">生成数量</label><input class="dev-input compact font-mono" id="uuidCount" type="number" min="1" max="100" value="10"></div><label class="text-inline-toggle"><input type="checkbox" id="uuidUpper"><span>大写</span></label><label class="text-inline-toggle"><input type="checkbox" id="uuidNoHyphen"><span>移除连字符</span></label><button class="dev-primary-button" id="uuidGenerate"><i data-lucide="sparkles"></i><span>生成 UUID v4</span></button><button class="dev-icon-button" id="uuidCopy" title="复制全部"><i data-lucide="copy"></i></button></div>
        <textarea class="text-area uuid-output font-mono" id="uuidOutput" readonly></textarea>
      </div>`;
    const generate = () => {
      const count = Math.min(100, Math.max(1, Number(workspace.querySelector('#uuidCount').value) || 1));
      const upper = workspace.querySelector('#uuidUpper').checked;
      const noHyphen = workspace.querySelector('#uuidNoHyphen').checked;
      const fallbackUuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
        const random = Math.random() * 16 | 0;
        return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
      });
      const values = Array.from({ length: count }, () => crypto.randomUUID ? crypto.randomUUID() : fallbackUuid()).map(value => {
        if (noHyphen) value = value.replaceAll('-', '');
        return upper ? value.toUpperCase() : value;
      });
      workspace.querySelector('#uuidOutput').value = values.join('\n');
    };
    workspace.querySelector('#uuidGenerate').onclick = generate;
    workspace.querySelector('#uuidCopy').onclick = () => DeveloperToolUi.copy(workspace.querySelector('#uuidOutput').value, ' UUID');
    generate();
  }
};
