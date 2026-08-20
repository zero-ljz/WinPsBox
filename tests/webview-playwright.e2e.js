const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');

const playwrightCorePath = process.env.PLAYWRIGHT_CORE_PATH;
if (!playwrightCorePath) {
  throw new Error('PLAYWRIGHT_CORE_PATH must point to an installed playwright-core package.');
}

const { chromium } = require(playwrightCorePath);

const cdpUrl = process.env.WINPSBOX_CDP_URL;
if (!cdpUrl) throw new Error('WINPSBOX_CDP_URL is required.');

const results = [];
const runtimeErrors = [];
const stepFilter = process.env.WINPSBOX_E2E_FILTER || '';

async function step(name, action) {
  if (stepFilter && !name.includes(stepFilter)) return;
  const startedAt = Date.now();
  try {
    const detail = await action();
    results.push({ name, status: 'passed', durationMs: Date.now() - startedAt, detail });
  } catch (error) {
    results.push({ name, status: 'failed', durationMs: Date.now() - startedAt, error: error.stack || error.message });
  }
}

async function callIpc(page, action, payload = {}, timeoutMs = 120000) {
  return page.evaluate(async ({ action, payload, timeoutMs }) => {
    try {
      const data = await IPC.send(action, payload, { requestTimeoutMs: timeoutMs });
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : String(error),
        cancelled: Boolean(error && error.cancelled),
        needsAdmin: Boolean(error && error.needsAdmin),
        data: error && error.data ? error.data : null
      };
    }
  }, { action, payload, timeoutMs });
}

function assertIpcSuccess(result, action) {
  assert.equal(result.ok, true, `${action} failed: ${result.error || 'unknown error'}`);
  return result.data;
}

async function waitForToast(page, expected, timeoutMs = 5000) {
  await page.waitForFunction(text => Array.from(document.querySelectorAll('#toastContainer .custom-toast span'))
    .some(element => element.textContent.includes(text)), expected, { timeout: timeoutMs });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  await new Promise(resolve => server.close(resolve));
}

(async () => {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages().find(candidate => candidate.url().includes('/ui/index.html')) || context.pages()[0];

  page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
  });

  await step('真实 WebView2 与 IPC 已连接', async () => {
    assert.equal(await page.title(), 'WinPsBox - 开发者与系统管理员工具箱');
    assert.equal(await page.evaluate(() => IPC.isWebView), true);
    assert.equal(await page.evaluate(() => Boolean(window.chrome && window.chrome.webview)), true);
    return { url: page.url() };
  });

  await step('工具注册表和分类计数一致', async () => {
    const state = await page.evaluate(() => ({
      registered: ToolRegistry.tools.length,
      rendered: document.querySelectorAll('.tool-card').length,
      categoryCounts: Object.fromEntries(
        ['all', 'network', 'system', 'developer'].map(category => [
          category,
          Number(document.getElementById(`count-${category}`).textContent)
        ])
      )
    }));
    assert.equal(state.registered, 20);
    assert.equal(state.rendered, state.registered);
    assert.deepEqual(state.categoryCounts, { all: 20, network: 9, system: 8, developer: 3 });
    return state;
  });

  await step('搜索、分类、标签和空状态', async () => {
    const search = page.locator('#toolSearchInput');
    try {
      await search.fill('DNS');
      assert.equal(await page.locator('.tool-card').count(), 3);
      await search.fill('不存在的工具关键字');
      assert.equal(await page.locator('#emptyState').isVisible(), true);
      await search.fill('');
      await page.locator('[data-category="developer"]').click();
      assert.equal(await page.locator('.tool-card').count(), 3);
      assert.equal(await page.locator('#headerTitleText').innerText(), '开发工具');
      await page.locator('[data-category="all"]').click();
      await page.locator('[data-tag="DNS"]').click();
      assert.equal(await page.locator('.tool-card').count(), 2);
    } finally {
      await page.evaluate(() => {
        ToolRegistry.searchQuery = '';
        ToolRegistry.activeCategory = 'all';
        ToolRegistry.activeTag = 'all';
        const input = document.getElementById('toolSearchInput');
        if (input) input.value = '';
        document.querySelectorAll('.tag-chip').forEach(chip => chip.classList.toggle('active', chip.dataset.tag === 'all'));
        ToolRegistry.renderToolGrid();
        ToolRegistry.updateHeaderAndHero();
      });
    }
  });

  await step('收藏、收藏筛选和持久化', async () => {
    await page.locator('[data-category="all"]').click();
    const favoriteId = 'developer-text-toolbox';
    const wasFavorite = await page.evaluate(id => ToolRegistry.favorites.has(id), favoriteId);
    await page.locator(`[data-star-id="${favoriteId}"]`).click();
    assert.notEqual(await page.evaluate(id => ToolRegistry.favorites.has(id), favoriteId), wasFavorite);
    await page.locator('[data-category="fav"]').click();
    assert.equal(await page.locator(`[data-tool-id="${favoriteId}"]`).count(), wasFavorite ? 0 : 1);
    await page.locator('[data-category="all"]').click();
    await page.locator(`[data-star-id="${favoriteId}"]`).click();
    assert.equal(await page.evaluate(id => ToolRegistry.favorites.has(id), favoriteId), wasFavorite);
  });

  await step('主题切换和设置导航', async () => {
    const originalTheme = await page.evaluate(() => ThemeManager.currentTheme);
    await page.locator('#btnQuickTheme').click();
    assert.notEqual(await page.evaluate(() => ThemeManager.currentTheme), originalTheme);
    await page.locator('#btnHeaderSettings').click();
    assert.equal(await page.locator('#viewSettings').isVisible(), true);
    await page.locator('[data-theme-val="dark"]').click();
    assert.equal(await page.locator('html').getAttribute('data-bs-theme'), 'dark');
    await page.evaluate(theme => ThemeManager.setTheme(theme, true), originalTheme);
    await page.locator('#btnHeaderSettings').click();
    assert.equal(await page.locator('#viewTools').isVisible(), true);
  });

  await step('键盘快捷键和 Escape 返回', async () => {
    await page.locator('[data-category="all"]').click();
    await page.keyboard.press('Control+K');
    assert.equal(await page.locator('#toolSearchInput').evaluate(element => document.activeElement === element), true);
    await page.locator('[data-tool-id="developer-text-toolbox"]').click();
    assert.equal(await page.locator('#viewWorkspace').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#viewTools').isVisible(), true);
  });

  await step('20 个工具均可打开并渲染真实工作区', async () => {
    const tools = await page.evaluate(() => ToolRegistry.tools.map(tool => ({ id: tool.id, title: tool.title })));
    const rendered = [];
    for (const tool of tools) {
      await page.evaluate(id => ToolRegistry.openToolWorkspace(id), tool.id);
      await page.locator('#workspaceToolMount').waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#wsToolTitle').innerText(), tool.title);
      const workspace = await page.locator('#workspaceToolMount').evaluate(element => ({
        textLength: element.innerText.trim().length,
        controls: element.querySelectorAll('button,input,select,textarea').length,
        placeholder: Boolean(element.querySelector('.placeholder-tool'))
      }));
      assert.ok(workspace.textLength > 20, `${tool.id} rendered too little content`);
      assert.ok(workspace.controls > 0, `${tool.id} has no interactive controls`);
      assert.equal(workspace.placeholder, false, `${tool.id} rendered the fallback placeholder`);
      rendered.push({ ...tool, ...workspace });
      await page.locator('#btnBackToGrid').click();
    }
    return rendered;
  });

  const readOnlyCalls = [
    ['get_config'],
    ['get_autostart'],
    ['get_system_info'],
    ['get_privilege_info'],
    ['net_get_local_ports'],
    ['cert_get_defaults'],
    ['cert_get_ca_status'],
    ['net_get_adapters'],
    ['net_get_portproxy_rules'],
    ['net_get_portproxy_targets', {}, 180000],
    ['net_get_proxy'],
    ['net_get_route_table'],
    ['sys_get_env_vars'],
    ['sys_get_hosts'],
    ['sys_get_services'],
    ['sys_get_scheduled_tasks'],
    ['sys_get_context_menu_items'],
    ['winget_get_status', {}, 180000],
    ['winget_get_packages', { mode: 'installed' }, 300000],
    ['winget_get_packages', { mode: 'updates' }, 300000],
    ['winget_search', { query: 'PowerShell' }, 300000],
    ['ssh_get_status', {}, 180000],
    ['wsl_get_status', {}, 180000],
    ['wsl_get_online', {}, 180000]
  ];

  for (const [action, payload = {}, timeoutMs = 120000] of readOnlyCalls) {
    await step(`真实后端读取: ${action}`, async () => {
      const data = assertIpcSuccess(await callIpc(page, action, payload, timeoutMs), action);
      assert.notEqual(data, undefined);
      return Array.isArray(data) ? { count: data.length } : data;
    });
  }

  await step('真实网络诊断、局域网扫描和报告导出', async () => {
    const adapters = assertIpcSuccess(await callIpc(page, 'net_get_adapters'), 'net_get_adapters');
    const localIp = adapters.flatMap(adapter => adapter.ipAddresses || [])
      .find(address => /^\d+\.\d+\.\d+\.\d+$/.test(address) && !address.startsWith('127.'));
    const subnet = localIp ? localIp.split('.').slice(0, 3).join('.') : '192.168.1';

    const ssl = assertIpcSuccess(await callIpc(page, 'net_check_ssl', {
      host: 'github.com', port: 443, timeoutMs: 8000
    }, 60000), 'net_check_ssl');
    assert.ok(ssl.subject && ssl.validTo);

    const dns = assertIpcSuccess(await callIpc(page, 'net_dns_deep_diagnostic', {
      name: 'example.com', recordType: 'A'
    }, 180000), 'net_dns_deep_diagnostic');
    assert.ok(Array.isArray(dns.records));
    assert.ok(dns.comparison && Array.isArray(dns.comparison.providers));
    assert.ok(Array.isArray(dns.doh));

    const intel = assertIpcSuccess(await callIpc(page, 'net_intel_lookup', {
      target: '1.1.1.1'
    }, 180000), 'net_intel_lookup');
    assert.ok(intel.primaryIp || intel.query);

    const lan = assertIpcSuccess(await callIpc(page, 'net_scan_lan', { subnet }, 180000), 'net_scan_lan');
    assert.equal(lan.subnet, subnet);
    assert.ok(Array.isArray(lan.devices));

    const report = assertIpcSuccess(await callIpc(page, 'diag_run', {
      target: 'example.com'
    }, 180000), 'diag_run');
    assert.ok(Array.isArray(report.checks));
    const exported = assertIpcSuccess(await callIpc(page, 'diag_export', {
      report, format: 'json'
    }), 'diag_export');
    assert.match(exported.filePath, /\.json$/i);
    const fs = require('node:fs');
    assert.equal(fs.existsSync(exported.filePath), true);
    fs.unlinkSync(exported.filePath);

    assertIpcSuccess(await callIpc(page, 'net_flush_dns_winsock'), 'net_flush_dns_winsock');
    return {
      subnet,
      lanDevices: lan.devices.length,
      sslSubject: ssl.subject,
      diagnosticChecks: report.checks.length,
      reportExportCleaned: !fs.existsSync(exported.filePath)
    };
  });

  await step('本机 TCP 端口探测、连接、收发和断开', async () => {
    const server = net.createServer(socket => socket.on('data', chunk => socket.write(chunk)));
    const port = await listen(server);
    let sessionId;
    try {
      const probe = assertIpcSuccess(await callIpc(page, 'net_check_remote_port', {
        host: '127.0.0.1', ports: [port], timeoutMs: 1500
      }), 'net_check_remote_port');
      assert.equal(probe[0].isOpen, true);

      await page.evaluate(() => ToolRegistry.openToolWorkspace('port-checker'));
      await page.locator('#tabPortRemote').click();
      await page.locator('#remoteHostInput').fill('127.0.0.1');
      await page.locator('#remotePortsInput').fill(String(port));
      await page.locator('#btnStartRemoteScan').click();
      await page.waitForFunction(() => {
        const button = document.getElementById('btnStartRemoteScan');
        return button && !button.disabled && document.getElementById('remoteSummaryText')?.textContent.includes('开放: 1');
      }, null, { timeout: 10000 });
      assert.match(await page.locator('#remotePortsTableBody').innerText(), new RegExp(`${port}.*开放`, 's'));

      const connected = assertIpcSuccess(await callIpc(page, 'net_tcp_connect', {
        host: '127.0.0.1', port, timeoutMs: 3000
      }), 'net_tcp_connect');
      sessionId = connected.sessionId;
      assert.ok(sessionId);
      const payload = Buffer.from('WinPsBox E2E', 'utf8').toString('base64');
      assertIpcSuccess(await callIpc(page, 'net_tcp_send', { sessionId, dataBase64: payload }), 'net_tcp_send');
      await new Promise(resolve => setTimeout(resolve, 100));
      const received = assertIpcSuccess(await callIpc(page, 'net_tcp_receive', { sessionId }), 'net_tcp_receive');
      assert.equal(Buffer.from(received.dataBase64, 'base64').toString('utf8'), 'WinPsBox E2E');
      assertIpcSuccess(await callIpc(page, 'net_tcp_disconnect', { sessionId }), 'net_tcp_disconnect');
      sessionId = null;

      const sshProbe = assertIpcSuccess(await callIpc(page, 'ssh_test_endpoint', {
        host: '127.0.0.1', port, user: 'winpsbox'
      }), 'ssh_test_endpoint');
      assert.equal(sshProbe.reachable, true);
      return { port };
    } finally {
      if (sessionId) await callIpc(page, 'net_tcp_disconnect', { sessionId });
      await closeServer(server);
    }
  });

  await step('真实 Ping 与本机路由追踪', async () => {
    const ping = assertIpcSuccess(await callIpc(page, 'net_ping', {
      host: '127.0.0.1', count: 2, timeoutMs: 1000
    }), 'net_ping');
    assert.ok(Array.isArray(ping.records));
    const trace = assertIpcSuccess(await callIpc(page, 'net_trace_route', {
      host: '127.0.0.1', maxHops: 3, timeoutMs: 500
    }), 'net_trace_route');
    assert.ok(Array.isArray(trace.hops));
  });

  await step('环境变量通过 UI 创建、检索、编辑和删除可回滚', async () => {
    const name = `WINPSBOX_E2E_${Date.now()}`;
    const firstValue = 'first <img id="winpsbox-e2e-injection" src=x onerror="window.__winpsboxInjected=true"> & " \' \\ ' + String.fromCharCode(96);
    const secondValue = 'second <tag> & " \' \\ ' + String.fromCharCode(96);
    try {
      await page.evaluate(() => ToolRegistry.openToolWorkspace('env-viewer'));
      await page.waitForFunction(() => Array.isArray(EnvTool.envData.userVars));
      await page.locator('#btnAddEnv').click();
      await page.locator('#envModalName').fill(name);
      await page.locator('#envModalValue').fill(firstValue);
      await page.locator('#envModalScope').selectOption('User');
      await page.locator('#btnSaveEnvModal').click();
      await page.waitForTimeout(2000);
      const saveState = await page.evaluate(envName => ({
        modalHidden: document.getElementById('envVarModal').classList.contains('d-none'),
        toasts: Array.from(document.querySelectorAll('#toastContainer .custom-toast span')).map(item => item.textContent),
        variable: EnvTool.envData.userVars.find(item => item.name === envName) || null
      }), name);
      assert.ok(saveState.variable, `Environment variable did not appear after UI save: ${JSON.stringify(saveState)}`);
      const storedFirstValue = await page.evaluate(envName => EnvTool.envData.userVars
        .find(item => item.name === envName)?.value, name);
      assert.equal(storedFirstValue, firstValue);

      await page.locator('#envSearchInput').fill(name);
      assert.equal(await page.locator('#envTableBody tr').count(), 1);
      assert.match(await page.locator('#envTableBody').innerText(), new RegExp(name));
      assert.match(await page.locator('#envTableBody').innerText(), /<img id="winpsbox-e2e-injection"/);
      assert.equal(await page.locator('#winpsbox-e2e-injection').count(), 0);
      assert.equal(await page.evaluate(() => Boolean(window.__winpsboxInjected)), false);

      await page.locator('[data-env-action="edit"]').click();
      assert.equal(await page.locator('#envModalValue').evaluate(element => element.value), firstValue);
      await page.locator('#envModalValue').fill(secondValue);
      await page.locator('#btnSaveEnvModal').click();
      await page.waitForFunction(({ envName, value }) => EnvTool.envData.userVars
        .some(item => item.name === envName && item.value === value), { envName: name, value: secondValue });
      const storedSecondValue = await page.evaluate(envName => EnvTool.envData.userVars
        .find(item => item.name === envName)?.value, name);
      assert.equal(storedSecondValue, secondValue);

      await page.locator('#envSearchInput').fill(name);
      page.once('dialog', dialog => dialog.accept());
      await page.locator('[data-env-action="delete"]').click();
      await page.waitForFunction(envName => !EnvTool.envData.userVars.some(item => item.name === envName), name);
      const vars = assertIpcSuccess(await callIpc(page, 'sys_get_env_vars'), 'sys_get_env_vars');
      assert.equal(vars.userVars.some(item => item.name === name), false);
      return { name, specialCharactersPreserved: true };
    } finally {
      await page.evaluate(() => document.getElementById('envVarModal')?.classList.add('d-none'));
      await callIpc(page, 'sys_delete_env_var', { name, scope: 'User' });
    }
  });

  await step('无害计划任务创建、停用、启用和删除可回滚', async () => {
    const runAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    let taskId;
    try {
      const created = assertIpcSuccess(await callIpc(page, 'sys_create_scheduled_task', {
        name: `WinPsBox E2E ${Date.now()}`,
        taskAction: 'program',
        scheduleType: 'once',
        runAt,
        programPath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
        arguments: '/c exit 0',
        workingDirectory: process.env.TEMP || ''
      }), 'sys_create_scheduled_task');
      taskId = created.id;
      assert.ok(taskId && taskId.startsWith('WinPsBox_'));
      assertIpcSuccess(await callIpc(page, 'sys_set_scheduled_task_state', { id: taskId, enabled: false }), 'sys_set_scheduled_task_state');
      assertIpcSuccess(await callIpc(page, 'sys_set_scheduled_task_state', { id: taskId, enabled: true }), 'sys_set_scheduled_task_state');
    } finally {
      if (taskId) await callIpc(page, 'sys_remove_scheduled_task', { id: taskId });
    }
  });

  await step('SSH 测试密钥生成、读取和清理', async () => {
    const keyName = `winpsbox-e2e-${Date.now()}`;
    const sshFolder = path.join(process.env.USERPROFILE, '.ssh');
    const privatePath = path.join(sshFolder, keyName);
    const publicPath = `${privatePath}.pub`;
    try {
      const created = await callIpc(page, 'ssh_generate_key', {
        algorithm: 'ed25519', keyName, comment: 'WinPsBox E2E'
      }, 120000);
      if (!created.ok && /not installed/i.test(created.error)) return { skipped: created.error };
      assertIpcSuccess(created, 'ssh_generate_key');
      const publicKey = assertIpcSuccess(await callIpc(page, 'ssh_read_public_key', { keyName }), 'ssh_read_public_key');
      assert.match(publicKey.content, /^ssh-ed25519 /);
    } finally {
      const fs = require('node:fs');
      for (const file of [privatePath, publicPath]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
  });

  await step('破坏性后端操作拒绝非法输入', async () => {
    const cases = [
      ['net_set_adapter_dns', { interfaceAlias: '__WINPSBOX_E2E_MISSING__', dnsServers: ['999.999.999.999'], isDhcp: false }],
      ['net_add_portproxy_rule', { listenAddress: 'invalid', listenPort: 0, connectAddress: 'invalid', connectPort: 0 }],
      ['sys_kill_process', { pid: -1 }],
      ['sys_set_service_state', { name: '__WINPSBOX_E2E_MISSING__', action: 'invalid' }],
      ['sys_set_service_start_type', { name: '__WINPSBOX_E2E_MISSING__', startType: 'invalid' }],
      ['sys_set_env_var', { name: '', value: 'invalid', scope: 'User' }],
      ['sys_set_env_var', { name: '__WINPSBOX_E2E_INVALID_SCOPE__', value: 'invalid', scope: 'Unknown' }],
      ['sys_delete_env_var', { name: '__WINPSBOX_E2E_INVALID_SCOPE__', scope: 'Unknown' }],
      ['sys_save_hosts', { content: null }],
      ['ssh_service_action', { serviceAction: 'invalid' }],
      ['wsl_action', { wslAction: 'invalid', distro: '', version: 2 }]
    ];
    const accepted = [];
    for (const [action, payload] of cases) {
      const result = await callIpc(page, action, payload, 30000);
      if (result.ok) accepted.push({ action, data: result.data });
    }
    assert.deepEqual(accepted, [], `Invalid destructive requests unexpectedly succeeded: ${JSON.stringify(accepted)}`);
  });

  await step('高风险表单非法输入在 UI 层拦截', async () => {
    await page.evaluate(() => {
      window.__winpsboxE2eIpcCalls = [];
      window.__winpsboxE2eOriginalSend = IPC.send;
      IPC.send = function (action, ...args) {
        window.__winpsboxE2eIpcCalls.push(action);
        return window.__winpsboxE2eOriginalSend.call(this, action, ...args);
      };
    });
    try {
      await page.evaluate(() => ToolRegistry.openToolWorkspace('hosts-editor'));
      await page.waitForFunction(() => Boolean(HostsTool.hostsPath));
      await page.locator('#btnAddHostRule').click();
      await page.locator('#hostModalIp').fill('');
      await page.locator('#hostModalDomain').fill('');
      await page.locator('#btnSaveHostModal').click();
      await waitForToast(page, 'IP 与域名不能为空');
      await page.locator('#btnCancelHostModal').click();
      await page.evaluate(() => {
        HostsTool.rawContent = '127.0.0.1 example.test # <img id="hosts-e2e-injection" src=x onerror="window.__hostsInjected=true">';
        HostsTool.renderRulesTable();
      });
      assert.equal(await page.locator('#hosts-e2e-injection').count(), 0);
      assert.equal(await page.evaluate(() => Boolean(window.__hostsInjected)), false);
      assert.match(await page.locator('#hostsRulesTbody').innerText(), /<img id="hosts-e2e-injection"/);

      await page.evaluate(() => ToolRegistry.openToolWorkspace('scheduled-tasks'));
      await page.locator('#scheduleAction').selectOption('program');
      await page.locator('#scheduleProgram').fill('');
      await page.locator('#btnCreateSchedule').click();
      await waitForToast(page, '请输入程序或脚本路径');

      await page.evaluate(() => ToolRegistry.openToolWorkspace('portproxy-manager'));
      await page.locator('#portProxyListenAddress').fill('999.1.1.1');
      await page.locator('#portProxyListenPort').fill('0');
      await page.locator('#portProxyConnectAddress').fill('invalid');
      await page.locator('#portProxyConnectPort').fill('70000');
      await page.locator('#btnAddPortProxy').click();
      await waitForToast(page, '请输入有效的 IPv4 监听地址');

      await page.evaluate(() => ToolRegistry.openToolWorkspace('local-cert-generator'));
      await page.locator('#certGenerateButton').waitFor({ state: 'visible' });
      await page.evaluate(() => { LocalCertificateTool.status = { exists: false }; });
      await page.locator('#certGenerateButton').click();
      await waitForToast(page, '请先创建本地 Root CA');

      await page.evaluate(() => ToolRegistry.openToolWorkspace('wsl-manager'));
      await page.locator('#wslInstallName').fill('');
      await page.locator('#wslInstall').click();
      await waitForToast(page, '请先选择或输入发行版名称');

      await page.evaluate(() => ToolRegistry.openToolWorkspace('openssh-manager'));
      await page.locator('#sshKeyName').fill('../bad');
      await page.locator('#sshGenerate').click();
      await waitForToast(page, '密钥名称仅允许');

      const calls = await page.evaluate(() => window.__winpsboxE2eIpcCalls);
      const prohibited = ['sys_save_hosts', 'sys_create_scheduled_task', 'net_add_portproxy_rule',
        'cert_generate_server', 'wsl_action', 'ssh_generate_key'];
      assert.deepEqual(calls.filter(action => prohibited.includes(action)), []);
      return { intercepted: prohibited };
    } finally {
      await page.evaluate(() => {
        if (window.__winpsboxE2eOriginalSend) IPC.send = window.__winpsboxE2eOriginalSend;
        delete window.__winpsboxE2eOriginalSend;
        delete window.__winpsboxE2eIpcCalls;
      });
    }
  });

  await step('开发文本工具 7 个模式的真实 UI 操作', async () => {
    await page.evaluate(() => ToolRegistry.openToolWorkspace('developer-text-toolbox'));

    await page.locator('[data-text-mode="json"]').click();
    await page.locator('#textInput').fill('{"z":1,"a":{"b":2}}');
    await page.locator('[data-json-action="sort"]').click();
    assert.deepEqual(JSON.parse(await page.locator('#textOutput').evaluate(element => element.value)), { a: { b: 2 }, z: 1 });
    assert.match(await page.locator('#textStatus').innerText(), /JSON 有效/);

    await page.locator('[data-text-mode="base64"]').click();
    await page.locator('#textInput').fill('WinPsBox 测试');
    await page.locator('[data-b64-action="encode"]').click();
    const encoded = await page.locator('#textOutput').evaluate(element => element.value);
    assert.equal(encoded, Buffer.from('WinPsBox 测试', 'utf8').toString('base64'));
    await page.locator('#textInput').fill(encoded);
    await page.locator('[data-b64-action="decode"]').click();
    assert.equal(await page.locator('#textOutput').evaluate(element => element.value), 'WinPsBox 测试');

    await page.locator('[data-text-mode="url"]').click();
    await page.locator('#textInput').fill('https://example.com/a path?q=WinPsBox%20测试#part');
    await page.locator('[data-url-action="parse"]').click();
    const parsedUrl = JSON.parse(await page.locator('#textOutput').evaluate(element => element.value));
    assert.equal(parsedUrl.host, 'example.com');
    assert.equal(parsedUrl.query.q, 'WinPsBox 测试');

    const jwtHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const jwtPayload = Buffer.from(JSON.stringify({ sub: 'winpsbox', iat: 1700000000 })).toString('base64url');
    await page.locator('[data-text-mode="jwt"]').click();
    await page.locator('#textInput').fill(`${jwtHeader}.${jwtPayload}.signature`);
    await page.locator('[data-jwt-decode]').click();
    assert.equal(JSON.parse(await page.locator('#textOutput').evaluate(element => element.value)).payload.sub, 'winpsbox');

    await page.locator('[data-text-mode="time"]').click();
    await page.locator('#timeValue').fill('0');
    await page.locator('#timeUnit').selectOption('seconds');
    await page.locator('#timeConvert').click();
    assert.match(await page.locator('#timeResult').innerText(), /1970/);

    await page.locator('[data-text-mode="hash"]').click();
    await page.locator('#textInput').fill('abc');
    await page.locator('[data-hash="SHA-256"]').click();
    await page.waitForFunction(() => document.getElementById('textOutput')?.value.length === 64);
    assert.equal(await page.locator('#textOutput').evaluate(element => element.value), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    await page.locator('[data-text-mode="uuid"]').click();
    await page.locator('#uuidCount').fill('3');
    await page.locator('#uuidUpper').check();
    await page.locator('#uuidNoHyphen').check();
    await page.locator('#uuidGenerate').click();
    const uuids = (await page.locator('#uuidOutput').evaluate(element => element.value)).split('\n');
    assert.equal(uuids.length, 3);
    assert.equal(uuids.every(value => /^[0-9A-F]{32}$/.test(value)), true);
    return { modes: ['json', 'base64', 'url', 'jwt', 'time', 'hash', 'uuid'] };
  });

  await step('桌面最小尺寸无横向溢出和控件遮挡', async () => {
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const visibleControls = Array.from(document.querySelectorAll('button,input,select,textarea'))
        .filter(element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        horizontalOverflow: root.scrollWidth - root.clientWidth,
        zeroSizedControls: visibleControls.filter(element => {
          if (element.matches('input[type="checkbox"], input[type="radio"]')) return false;
          const rect = element.getBoundingClientRect();
          return rect.width < 20 || rect.height < 20;
        }).map(element => element.id || element.className).slice(0, 20)
      };
    });
    assert.ok(metrics.viewport.width >= 880, `Unexpected WebView width: ${metrics.viewport.width}`);
    assert.ok(metrics.viewport.height >= 540, `Unexpected WebView height: ${metrics.viewport.height}`);
    assert.ok(metrics.horizontalOverflow <= 1, `Horizontal overflow: ${metrics.horizontalOverflow}px`);
    assert.deepEqual(metrics.zeroSizedControls, []);
    return metrics;
  });

  await browser.close();

  const failures = results.filter(result => result.status === 'failed');
  const report = {
    summary: { passed: results.length - failures.length, failed: failures.length, runtimeErrors: runtimeErrors.length },
    runtimeErrors: [...new Set(runtimeErrors)],
    results
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length || runtimeErrors.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
