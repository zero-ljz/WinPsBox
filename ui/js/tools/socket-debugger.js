const SocketDebuggerTool = {
  root: null,
  protocol: 'websocket',
  encoding: 'text',
  inspectorMode: 'text',
  filter: 'all',
  frames: [],
  selectedFrameId: null,
  frameCounter: 0,
  socket: null,
  tcpSessionId: null,
  pollTimer: null,
  durationTimer: null,
  connectedAt: null,
  state: 'disconnected',
  sentBytes: 0,
  receivedBytes: 0,

  render(container) {
    this.destroy(true);
    this.root = container;
    this.frames = [];
    this.selectedFrameId = null;
    this.frameCounter = 0;
    this.sentBytes = 0;
    this.receivedBytes = 0;
    this.state = 'disconnected';

    container.innerHTML = `
      <div class="socket-debugger">
        <section class="socket-connect-strip" aria-label="连接设置">
          <div class="socket-protocol-switch" role="tablist" aria-label="协议">
            <button class="socket-protocol-btn active" data-protocol="websocket" role="tab">
              <i data-lucide="radio-tower"></i><span>WebSocket</span>
            </button>
            <button class="socket-protocol-btn" data-protocol="tcp" role="tab">
              <i data-lucide="cable"></i><span>TCP Socket</span>
            </button>
          </div>

          <div class="socket-target socket-target-ws">
            <input class="socket-input socket-url-input font-mono" id="socketWsUrl" value="ws://127.0.0.1:8080" spellcheck="false" aria-label="WebSocket URL">
            <input class="socket-input socket-protocol-input font-mono" id="socketWsProtocols" placeholder="子协议，可用逗号分隔" spellcheck="false" aria-label="WebSocket 子协议">
          </div>

          <div class="socket-target socket-target-tcp d-none">
            <input class="socket-input socket-host-input font-mono" id="socketTcpHost" value="127.0.0.1" spellcheck="false" aria-label="TCP 主机">
            <span class="socket-target-separator">:</span>
            <input class="socket-input socket-port-input font-mono" id="socketTcpPort" type="number" value="9000" min="1" max="65535" aria-label="TCP 端口">
          </div>

          <button class="socket-connect-btn" id="socketConnectBtn">
            <i data-lucide="plug-zap"></i><span>连接</span>
          </button>
        </section>

        <section class="socket-status-strip" aria-label="连接状态">
          <div class="socket-live-state">
            <span class="socket-state-dot"></span>
            <strong id="socketStateText">未连接</strong>
            <span class="socket-endpoint font-mono" id="socketEndpoint">-</span>
          </div>
          <div class="socket-metrics">
            <span><i data-lucide="arrow-up"></i><b id="socketSentMetric">0 B</b></span>
            <span><i data-lucide="arrow-down"></i><b id="socketReceivedMetric">0 B</b></span>
            <span><i data-lucide="timer"></i><b id="socketDurationMetric">00:00</b></span>
          </div>
        </section>

        <div class="socket-workbench">
          <section class="socket-panel socket-compose-panel">
            <header class="socket-panel-header">
              <div class="socket-panel-title"><i data-lucide="square-pen"></i><span>消息编辑器</span></div>
              <select class="socket-preset-select" id="socketPreset" aria-label="消息预设">
                <option value="">载入预设</option>
                <option value="json-ping">JSON Ping</option>
                <option value="socketio-ping">Socket.IO Ping</option>
                <option value="stomp-connect">STOMP CONNECT</option>
                <option value="http-get" disabled>HTTP GET</option>
              </select>
            </header>
            <div class="socket-panel-body socket-compose-body">
              <div class="socket-mode-switch" role="group" aria-label="发送编码">
                <button class="socket-mode-btn active" data-encoding="text">Text</button>
                <button class="socket-mode-btn" data-encoding="hex">Hex</button>
                <button class="socket-mode-btn" data-encoding="base64">Base64</button>
              </div>
              <textarea class="socket-payload-editor font-mono" id="socketPayload" spellcheck="false" placeholder="输入要发送的文本...">{"type":"ping","time":${Date.now()}}</textarea>
              <div class="socket-compose-actions">
                <select class="socket-line-ending" id="socketLineEnding" aria-label="行尾">
                  <option value="none">不追加行尾</option>
                  <option value="lf">追加 LF</option>
                  <option value="crlf">追加 CRLF</option>
                </select>
                <span class="socket-payload-size font-mono" id="socketPayloadSize">0 B</span>
                <button class="socket-send-btn" id="socketSendBtn" disabled title="发送消息 (Ctrl+Enter)">
                  <i data-lucide="send"></i><span>发送</span>
                </button>
              </div>
            </div>
          </section>

          <section class="socket-panel socket-traffic-panel">
            <header class="socket-panel-header socket-traffic-header">
              <div class="socket-panel-title"><i data-lucide="list-tree"></i><span>通信记录</span><span class="socket-count" id="socketFrameCount">0</span></div>
              <div class="socket-log-actions">
                <label class="socket-autoscroll"><input type="checkbox" id="socketAutoScroll" checked><span>自动滚动</span></label>
                <button class="socket-icon-btn" id="socketExportBtn" title="导出记录"><i data-lucide="download"></i></button>
                <button class="socket-icon-btn" id="socketClearBtn" title="清空记录"><i data-lucide="trash-2"></i></button>
              </div>
            </header>
            <div class="socket-filter-bar" role="group" aria-label="记录筛选">
              <button class="socket-filter-btn active" data-filter="all">全部</button>
              <button class="socket-filter-btn" data-filter="sent"><i data-lucide="arrow-up"></i>发送</button>
              <button class="socket-filter-btn" data-filter="received"><i data-lucide="arrow-down"></i>接收</button>
              <button class="socket-filter-btn" data-filter="system"><i data-lucide="info"></i>事件</button>
            </div>
            <div class="socket-frame-list" id="socketFrameList">
              <div class="socket-empty-log" id="socketEmptyLog"><i data-lucide="radio"></i><span>等待连接</span></div>
            </div>
          </section>

          <section class="socket-panel socket-inspector-panel">
            <header class="socket-panel-header">
              <div class="socket-panel-title"><i data-lucide="scan-search"></i><span>帧检查器</span></div>
              <button class="socket-icon-btn" id="socketCopyInspectorBtn" title="复制当前内容"><i data-lucide="copy"></i></button>
            </header>
            <div class="socket-inspector-meta" id="socketInspectorMeta">
              <span>未选择帧</span>
            </div>
            <div class="socket-mode-switch socket-inspector-tabs" role="tablist" aria-label="检查格式">
              <button class="socket-mode-btn active" data-inspector="text">Text</button>
              <button class="socket-mode-btn" data-inspector="hex">Hex</button>
              <button class="socket-mode-btn" data-inspector="base64">Base64</button>
            </div>
            <pre class="socket-inspector-content font-mono" id="socketInspectorContent">选择一条通信记录查看完整内容</pre>
          </section>
        </div>
      </div>
    `;

    this.bindEvents();
    this.updatePayloadSize();
    this.updateConnectionUi();
    if (window.lucide) lucide.createIcons({ root: container });
  },

  bindEvents() {
    this.root.querySelectorAll('[data-protocol]').forEach(button => {
      button.addEventListener('click', () => this.setProtocol(button.dataset.protocol));
    });
    this.root.querySelectorAll('[data-encoding]').forEach(button => {
      button.addEventListener('click', () => this.setEncoding(button.dataset.encoding));
    });
    this.root.querySelectorAll('[data-filter]').forEach(button => {
      button.addEventListener('click', () => this.setFilter(button.dataset.filter));
    });
    this.root.querySelectorAll('[data-inspector]').forEach(button => {
      button.addEventListener('click', () => {
        this.inspectorMode = button.dataset.inspector;
        this.root.querySelectorAll('[data-inspector]').forEach(item => item.classList.toggle('active', item === button));
        this.renderInspector();
      });
    });

    this.root.querySelector('#socketConnectBtn').addEventListener('click', () => {
      if (this.state === 'connected' || this.state === 'connecting') this.disconnect();
      else this.connect();
    });
    this.root.querySelector('#socketSendBtn').addEventListener('click', () => this.send());
    this.root.querySelector('#socketClearBtn').addEventListener('click', () => this.clearFrames());
    this.root.querySelector('#socketExportBtn').addEventListener('click', () => this.exportFrames());
    this.root.querySelector('#socketCopyInspectorBtn').addEventListener('click', () => this.copyInspector());
    this.root.querySelector('#socketPayload').addEventListener('input', () => this.updatePayloadSize());
    this.root.querySelector('#socketLineEnding').addEventListener('change', () => this.updatePayloadSize());
    this.root.querySelector('#socketPreset').addEventListener('change', event => this.loadPreset(event.target.value));
    this.root.querySelector('#socketFrameList').addEventListener('click', event => {
      const row = event.target.closest('.socket-frame-row');
      if (row) this.selectFrame(Number(row.dataset.frameId));
    });
    this.root.querySelector('#socketPayload').addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        this.send();
      }
    });
  },

  setProtocol(protocol) {
    if (this.state !== 'disconnected' || protocol === this.protocol) return;
    this.protocol = protocol;
    this.root.querySelectorAll('[data-protocol]').forEach(button => button.classList.toggle('active', button.dataset.protocol === protocol));
    this.root.querySelector('.socket-target-ws').classList.toggle('d-none', protocol !== 'websocket');
    this.root.querySelector('.socket-target-tcp').classList.toggle('d-none', protocol !== 'tcp');
    this.root.querySelector('#socketPreset option[value="http-get"]').disabled = protocol !== 'tcp';
    this.updateConnectionUi();
  },

  setEncoding(encoding) {
    this.encoding = encoding;
    this.root.querySelectorAll('[data-encoding]').forEach(button => button.classList.toggle('active', button.dataset.encoding === encoding));
    const payload = this.root.querySelector('#socketPayload');
    payload.placeholder = encoding === 'hex' ? '例如: 48 65 6C 6C 6F' : encoding === 'base64' ? '例如: SGVsbG8=' : '输入要发送的文本...';
    this.root.querySelector('#socketLineEnding').disabled = encoding !== 'text';
    this.updatePayloadSize();
  },

  setFilter(filter) {
    this.filter = filter;
    this.root.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
    this.renderFrames();
  },

  async connect() {
    if (this.protocol === 'websocket') await this.connectWebSocket();
    else await this.connectTcp();
  },

  async connectWebSocket() {
    const url = this.root.querySelector('#socketWsUrl').value.trim();
    if (!/^wss?:\/\//i.test(url)) {
      Toast.show('WebSocket 地址需以 ws:// 或 wss:// 开头', 'warning');
      return;
    }

    const protocols = this.root.querySelector('#socketWsProtocols').value.split(',').map(item => item.trim()).filter(Boolean);
    this.setState('connecting', url);
    try {
      const ws = protocols.length ? new WebSocket(url, protocols) : new WebSocket(url);
      this.socket = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        if (this.socket !== ws) return;
        this.connectedAt = Date.now();
        this.setState('connected', url);
        this.addSystemFrame(`WebSocket 已连接${ws.protocol ? ` · ${ws.protocol}` : ''}`);
        this.startDurationTimer();
      };
      ws.onmessage = async event => {
        if (this.socket !== ws) return;
        if (typeof event.data === 'string') {
          this.addDataFrame('received', new TextEncoder().encode(event.data), 'text', event.data);
        } else {
          const buffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
          this.addDataFrame('received', new Uint8Array(buffer), 'binary');
        }
      };
      ws.onerror = () => {
        if (this.socket === ws) this.addSystemFrame('WebSocket 连接发生错误', 'error');
      };
      ws.onclose = event => {
        if (this.socket !== ws) return;
        this.socket = null;
        this.stopDurationTimer();
        this.setState('disconnected');
        const suffix = event.code ? ` · ${event.code}${event.reason ? ` ${event.reason}` : ''}` : '';
        this.addSystemFrame(`WebSocket 已断开${suffix}`, event.wasClean ? 'info' : 'warning');
      };
    } catch (error) {
      this.socket = null;
      this.setState('disconnected');
      Toast.show('连接失败: ' + error.message, 'error');
    }
  },

  async connectTcp() {
    const host = this.root.querySelector('#socketTcpHost').value.trim();
    const port = Number(this.root.querySelector('#socketTcpPort').value);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      Toast.show('请输入有效的主机和端口', 'warning');
      return;
    }

    this.setState('connecting', `${host}:${port}`);
    try {
      const result = await IPC.send('net_tcp_connect', { host, port, timeoutMs: 5000 });
      this.tcpSessionId = result.sessionId;
      this.connectedAt = Date.now();
      this.setState('connected', result.remoteEndpoint || `${host}:${port}`);
      this.addSystemFrame(`TCP 已连接 · ${result.localEndpoint} → ${result.remoteEndpoint}`);
      this.startDurationTimer();
      this.pollTcp();
    } catch (error) {
      this.tcpSessionId = null;
      this.setState('disconnected');
      Toast.show('TCP 连接失败: ' + error.message, 'error');
    }
  },

  async disconnect(silent = false) {
    if (this.socket) {
      const ws = this.socket;
      this.socket = null;
      ws.onclose = null;
      ws.onerror = null;
      try { ws.close(1000, 'Client disconnect'); } catch (_) { }
      if (!silent) this.addSystemFrame('WebSocket 已主动断开');
    }

    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    if (this.tcpSessionId) {
      const sessionId = this.tcpSessionId;
      this.tcpSessionId = null;
      try { await IPC.send('net_tcp_disconnect', { sessionId }); } catch (_) { }
      if (!silent && this.root) this.addSystemFrame('TCP 已主动断开');
    }

    this.stopDurationTimer();
    if (this.root) this.setState('disconnected');
  },

  async pollTcp() {
    const sessionId = this.tcpSessionId;
    if (!sessionId || this.state !== 'connected') return;
    try {
      const result = await IPC.send('net_tcp_receive', { sessionId, maxBytes: 65536 });
      if (this.tcpSessionId !== sessionId) return;
      if (result.dataBase64) {
        this.addDataFrame('received', this.base64ToBytes(result.dataBase64), 'binary');
      }
      if (result.closed || !result.connected) {
        this.tcpSessionId = null;
        this.stopDurationTimer();
        this.setState('disconnected');
        this.addSystemFrame('TCP 远端已关闭连接', 'warning');
        return;
      }
    } catch (error) {
      if (this.tcpSessionId !== sessionId) return;
      this.tcpSessionId = null;
      this.stopDurationTimer();
      this.setState('disconnected');
      this.addSystemFrame('TCP 接收失败 · ' + error.message, 'error');
      return;
    }
    this.pollTimer = setTimeout(() => this.pollTcp(), 120);
  },

  async send() {
    if (this.state !== 'connected') return;
    let parsed;
    try {
      parsed = this.parsePayload();
    } catch (error) {
      Toast.show(error.message, 'warning');
      return;
    }

    try {
      if (this.protocol === 'websocket') {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket 未连接');
        this.socket.send(parsed.wireValue);
      } else {
        if (!this.tcpSessionId) throw new Error('TCP Socket 未连接');
        await IPC.send('net_tcp_send', { sessionId: this.tcpSessionId, dataBase64: this.bytesToBase64(parsed.bytes) });
      }
      this.addDataFrame('sent', parsed.bytes, parsed.wireType, parsed.text);
    } catch (error) {
      Toast.show('发送失败: ' + error.message, 'error');
    }
  },

  parsePayload() {
    const value = this.root.querySelector('#socketPayload').value;
    if (this.encoding === 'text') {
      const ending = this.root.querySelector('#socketLineEnding').value;
      const text = value + (ending === 'lf' ? '\n' : ending === 'crlf' ? '\r\n' : '');
      const bytes = new TextEncoder().encode(text);
      return { bytes, wireValue: this.protocol === 'websocket' ? text : bytes, wireType: 'text', text };
    }
    if (this.encoding === 'hex') {
      const compact = value.replace(/0x/gi, '').replace(/[\s,:_-]/g, '');
      if (!compact || !/^[0-9a-f]+$/i.test(compact) || compact.length % 2 !== 0) {
        throw new Error('Hex 数据必须是完整的字节序列，例如 48 65 6C 6C 6F');
      }
      const bytes = new Uint8Array(compact.match(/.{2}/g).map(item => parseInt(item, 16)));
      return { bytes, wireValue: bytes, wireType: 'binary' };
    }
    try {
      const bytes = this.base64ToBytes(value.replace(/\s/g, ''));
      if (!bytes.length && value.trim()) throw new Error();
      return { bytes, wireValue: bytes, wireType: 'binary' };
    } catch (_) {
      throw new Error('Base64 数据格式无效');
    }
  },

  addDataFrame(direction, bytes, wireType, text = null) {
    const normalized = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (direction === 'sent') this.sentBytes += normalized.length;
    else this.receivedBytes += normalized.length;
    this.addFrame({ direction, bytes: normalized, wireType, text });
    this.updateMetrics();
  },

  addSystemFrame(text, level = 'info') {
    this.addFrame({ direction: 'system', bytes: new Uint8Array(), wireType: 'event', text, level });
  },

  addFrame(frame) {
    const item = {
      id: ++this.frameCounter,
      timestamp: new Date(),
      protocol: this.protocol,
      ...frame
    };
    this.frames.push(item);
    if (this.frames.length > 500) this.frames.shift();
    this.selectedFrameId = item.id;
    this.renderFrames();
    this.renderInspector();
  },

  renderFrames() {
    if (!this.root) return;
    const list = this.root.querySelector('#socketFrameList');
    const visible = this.frames.filter(frame => this.filter === 'all' || frame.direction === this.filter);
    this.root.querySelector('#socketFrameCount').textContent = this.frames.length;
    if (!visible.length) {
      list.innerHTML = `<div class="socket-empty-log"><i data-lucide="radio"></i><span>${this.frames.length ? '当前筛选无记录' : '等待连接'}</span></div>`;
      if (window.lucide) lucide.createIcons({ root: list });
      return;
    }

    list.innerHTML = visible.map(frame => {
      const icon = frame.direction === 'sent' ? 'arrow-up' : frame.direction === 'received' ? 'arrow-down' : frame.level === 'error' ? 'circle-x' : 'info';
      const directionLabel = frame.direction === 'sent' ? 'SEND' : frame.direction === 'received' ? 'RECV' : 'EVENT';
      const preview = frame.direction === 'system'
        ? frame.text
        : frame.wireType === 'text'
          ? frame.text
          : this.bytesToHex(frame.bytes.slice(0, 32));
      return `
        <button class="socket-frame-row ${frame.direction} ${frame.level || ''} ${frame.id === this.selectedFrameId ? 'selected' : ''}" data-frame-id="${frame.id}">
          <span class="socket-frame-icon"><i data-lucide="${icon}"></i></span>
          <span class="socket-frame-direction">${directionLabel}</span>
          <span class="socket-frame-time font-mono">${this.formatTime(frame.timestamp)}</span>
          <span class="socket-frame-preview font-mono">${this.escapeHtml(preview || '(empty)')}</span>
          <span class="socket-frame-size font-mono">${frame.direction === 'system' ? '' : this.formatBytes(frame.bytes.length)}</span>
        </button>`;
    }).join('');
    if (window.lucide) lucide.createIcons({ root: list });
    if (this.root.querySelector('#socketAutoScroll').checked) list.scrollTop = list.scrollHeight;
  },

  selectFrame(id) {
    this.selectedFrameId = id;
    this.renderFrames();
    this.renderInspector();
  },

  renderInspector() {
    if (!this.root) return;
    const frame = this.frames.find(item => item.id === this.selectedFrameId);
    const meta = this.root.querySelector('#socketInspectorMeta');
    const content = this.root.querySelector('#socketInspectorContent');
    if (!frame) {
      meta.innerHTML = '<span>未选择帧</span>';
      content.textContent = '选择一条通信记录查看完整内容';
      return;
    }

    const direction = frame.direction === 'sent' ? '发送' : frame.direction === 'received' ? '接收' : '事件';
    meta.innerHTML = `<span class="socket-meta-direction ${frame.direction}">${direction}</span><span>${this.escapeHtml(frame.protocol.toUpperCase())}</span><span>${this.formatTime(frame.timestamp, true)}</span><span>${frame.direction === 'system' ? '-' : this.formatBytes(frame.bytes.length)}</span>`;
    if (frame.direction === 'system') {
      content.textContent = frame.text;
    } else if (this.inspectorMode === 'hex') {
      content.textContent = this.bytesToHexDump(frame.bytes);
    } else if (this.inspectorMode === 'base64') {
      content.textContent = this.bytesToBase64(frame.bytes);
    } else {
      content.textContent = frame.text != null ? frame.text : new TextDecoder('utf-8').decode(frame.bytes);
    }
  },

  setState(state, endpoint = '') {
    this.state = state;
    if (!this.root) return;
    const stateText = this.root.querySelector('#socketStateText');
    const endpointEl = this.root.querySelector('#socketEndpoint');
    const connectBtn = this.root.querySelector('#socketConnectBtn');
    const labels = { disconnected: '未连接', connecting: '连接中', connected: '已连接' };
    this.root.querySelector('.socket-status-strip').dataset.state = state;
    stateText.textContent = labels[state];
    endpointEl.textContent = endpoint || '-';
    connectBtn.classList.toggle('disconnect', state === 'connected' || state === 'connecting');
    connectBtn.disabled = state === 'connecting';
    connectBtn.innerHTML = state === 'connecting'
      ? '<span class="spinner-border spinner-border-sm"></span><span>连接中</span>'
      : state === 'connected'
        ? '<i data-lucide="unplug"></i><span>断开</span>'
        : '<i data-lucide="plug-zap"></i><span>连接</span>';
    this.root.querySelector('#socketSendBtn').disabled = state !== 'connected';
    this.root.querySelectorAll('[data-protocol], #socketWsUrl, #socketWsProtocols, #socketTcpHost, #socketTcpPort').forEach(control => {
      control.disabled = state !== 'disconnected';
    });
    if (window.lucide) lucide.createIcons({ root: connectBtn });
  },

  updateConnectionUi() {
    if (!this.root) return;
    const endpoint = this.protocol === 'websocket'
      ? this.root.querySelector('#socketWsUrl').value.trim()
      : `${this.root.querySelector('#socketTcpHost').value.trim()}:${this.root.querySelector('#socketTcpPort').value}`;
    this.setState(this.state, this.state === 'disconnected' ? '' : endpoint);
  },

  updatePayloadSize() {
    if (!this.root) return;
    const target = this.root.querySelector('#socketPayloadSize');
    try {
      target.textContent = this.formatBytes(this.parsePayload().bytes.length);
      target.classList.remove('invalid');
    } catch (_) {
      target.textContent = '格式无效';
      target.classList.add('invalid');
    }
  },

  updateMetrics() {
    if (!this.root) return;
    this.root.querySelector('#socketSentMetric').textContent = this.formatBytes(this.sentBytes);
    this.root.querySelector('#socketReceivedMetric').textContent = this.formatBytes(this.receivedBytes);
  },

  startDurationTimer() {
    this.stopDurationTimer();
    const update = () => {
      if (!this.root || !this.connectedAt) return;
      const seconds = Math.floor((Date.now() - this.connectedAt) / 1000);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      this.root.querySelector('#socketDurationMetric').textContent = `${hours ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };
    update();
    this.durationTimer = setInterval(update, 1000);
  },

  stopDurationTimer() {
    if (this.durationTimer) clearInterval(this.durationTimer);
    this.durationTimer = null;
    this.connectedAt = null;
  },

  clearFrames() {
    this.frames = [];
    this.selectedFrameId = null;
    this.renderFrames();
    this.renderInspector();
  },

  loadPreset(name) {
    if (!name) return;
    const presets = {
      'json-ping': { encoding: 'text', value: JSON.stringify({ type: 'ping', time: Date.now() }, null, 2) },
      'socketio-ping': { encoding: 'text', value: '2' },
      'stomp-connect': { encoding: 'text', value: 'CONNECT\naccept-version:1.2\nhost:localhost\n\n\u0000' },
      'http-get': { encoding: 'text', value: 'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' }
    };
    const preset = presets[name];
    if (!preset) return;
    this.setEncoding(preset.encoding);
    this.root.querySelector('#socketPayload').value = preset.value;
    this.root.querySelector('#socketLineEnding').value = 'none';
    this.root.querySelector('#socketPreset').value = '';
    this.updatePayloadSize();
  },

  exportFrames() {
    if (!this.frames.length) {
      Toast.show('暂无通信记录可导出', 'info');
      return;
    }
    const data = this.frames.map(frame => ({
      id: frame.id,
      timestamp: frame.timestamp.toISOString(),
      protocol: frame.protocol,
      direction: frame.direction,
      type: frame.wireType,
      bytes: frame.bytes.length,
      text: frame.direction === 'system' ? frame.text : frame.text != null ? frame.text : null,
      hex: frame.direction === 'system' ? null : this.bytesToHex(frame.bytes),
      base64: frame.direction === 'system' ? null : this.bytesToBase64(frame.bytes)
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `socket-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  },

  async copyInspector() {
    const content = this.root?.querySelector('#socketInspectorContent')?.textContent || '';
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      Toast.show('已复制帧内容', 'success', 1200);
    } catch (_) {
      Toast.show('复制失败', 'error');
    }
  },

  destroy(silent = true) {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.stopDurationTimer();
    if (this.socket) {
      const ws = this.socket;
      this.socket = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(1000, 'Workspace closed'); } catch (_) { }
    }
    if (this.tcpSessionId) {
      const sessionId = this.tcpSessionId;
      this.tcpSessionId = null;
      IPC.send('net_tcp_disconnect', { sessionId }).catch(() => {});
    }
    if (!silent && this.root) this.setState('disconnected');
    this.root = null;
  },

  bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  },

  bytesToHexDump(bytes) {
    if (!bytes.length) return '(empty)';
    const lines = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const slice = bytes.slice(offset, offset + 16);
      const hex = Array.from(slice, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ').padEnd(47, ' ');
      const ascii = Array.from(slice, byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('');
      lines.push(`${offset.toString(16).padStart(8, '0').toUpperCase()}  ${hex}  |${ascii}|`);
    }
    return lines.join('\n');
  },

  bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  },

  base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  },

  formatBytes(value) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  },

  formatTime(date, includeMs = false) {
    const base = date.toLocaleTimeString('zh-CN', { hour12: false });
    return includeMs ? `${base}.${String(date.getMilliseconds()).padStart(3, '0')}` : base;
  },

  escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }
};
