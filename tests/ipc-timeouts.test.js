const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'js', 'core', 'ipc.js'), 'utf8');
const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  window: {}
});
vm.runInContext(`${source}\nglobalThis.__IPC = IPC;`, context);
const IPC = context.__IPC;

assert.equal(IPC.getTimeoutMs('net_check_ssl'), 30_000);
assert.equal(IPC.getTimeoutMs('net_dns_deep_diagnostic'), 180_000);
assert.equal(IPC.getTimeoutMs('ssh_install_capability'), 1_800_000);
assert.equal(
  IPC.getTimeoutMs('net_trace_route', { maxHops: 100, timeoutMs: 5_000 }),
  530_000
);
assert.equal(
  IPC.getTimeoutMs('winget_batch_action', { packageIds: Array(50).fill('package') }),
  7_200_000
);
assert.equal(IPC.getTimeoutMs('anything', {}, { requestTimeoutMs: 12_345 }), 12_345);

(async () => {
  IPC.isWebView = true;
  context.window.chrome = {
    webview: {
      postMessage() {
        throw new Error('WebView is disposed');
      }
    }
  };
  await assert.rejects(IPC.send('get_config'), /WebView is disposed/);
  assert.equal(IPC.callbacks.size, 0);
  console.log('IPC reliability tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
