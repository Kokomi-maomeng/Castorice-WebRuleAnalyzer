import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium, firefox, webkit } = require('playwright-core');
const browserOptions = {
  chromium: [chromium, {}],
  chrome: [chromium, { channel: 'chrome' }],
  msedge: [chromium, { channel: 'msedge' }],
  firefox: [firefox, {}],
  webkit: [webkit, {}],
};
const requested = process.argv.slice(2);
const engines = requested.length ? requested : ['chromium'];
for (const engine of engines) assert(Object.hasOwn(browserOptions, engine), 'Use chromium, chrome, msedge, firefox or webkit.');
const runtime = path.join(root, '.runtime');
await mkdir(runtime, { recursive: true });
const stage = await mkdtemp(path.join(runtime, 'local-acceptance-'));
const processes = [];
const report = { browsers: [], passed: false };
let base;

function run(command, args, options) {
  return spawn(command, args, { cwd: root, windowsHide: true, ...options });
}

async function build(name) {
  const exe = path.join(stage, name + (process.platform === 'win32' ? '.exe' : ''));
  const command = run('go', ['-C', 'backend', 'build', '-o', exe, './cmd/' + name], { stdio: 'inherit' });
  const [code] = await once(command, 'exit');
  assert.equal(code, 0, `Go build failed for ${name}`);
  return exe;
}

async function start(exe, args) {
  const process = run(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  processes.push(process);
  let output = '';
  process.stdout.on('data', (chunk) => { output += chunk.toString(); });
  process.stderr.on('data', (chunk) => { output += chunk.toString(); });
  process.on('error', (error) => { output += error.message; });
  for (let i = 0; i < 150; i++) {
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) return url;
    if (process.exitCode !== null) break;
    await delay(100);
  }
  throw new Error(`Could not start isolated ${path.basename(exe)}:\n${output}`);
}

async function request(endpoint, options) {
  const response = await fetch(base + '/api' + endpoint, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  return (await response.json()).data;
}

async function waitFor(fn, message, timeout = 20000) {
  const until = Date.now() + timeout;
  do {
    if (await fn()) return;
    await delay(120);
  } while (Date.now() < until);
  throw new Error(message);
}

async function verify(name, fixturePort) {
  const [engine, options] = browserOptions[name];
  const browser = await engine.launch({ ...options, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1220, height: 800 }, reducedMotion: 'reduce' });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(base);
    const target = page.getByRole('textbox', { name: '要分析的网站' });
    await target.waitFor();
    assert.equal(await target.inputValue(), '', 'Blank workspace');
    await page.getByRole('button', { name: '高级配置' }).click();
    await page.getByRole('spinbutton', { name: '每页观察 / 秒' }).fill('1');
    await page.getByRole('button', { name: '完成' }).click();
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.getByRole('button', { name: '高级配置' }).click();
    assert.equal(await page.getByRole('spinbutton', { name: '每页观察 / 秒' }).inputValue(), '1');
    await page.getByRole('button', { name: '完成' }).click();
    let domainReads = 0;
    await page.route(/\/api\/scans\/[^/]+\/domains$/, async (route) => {
      if (++domainReads === 1) {
        const first = await route.fetch();
        await delay(5500);
        await route.fulfill({ response: first });
      } else {
        await route.continue();
      }
    });
    await target.fill(`http://scan.test:${fixturePort}/?lang=zh`);
    const created = page.waitForResponse((r) => r.url() === base + '/api/scans' && r.status() === 201);
    await page.getByRole('button', { name: '开始采集' }).click();
    const { data: { id } } = await (await created).json();
    await page.getByText('正在补取最终采集结果…').waitFor();
    await page.getByRole('button', { name: 'api.scan.test', exact: true }).waitFor();
    assert(domainReads >= 2, 'Fetch again after terminal update');
    const all = await request(`/scans/${id}/requests?limit=200`);
    const exact = await request(`/scans/${id}/requests?host=scan.test&exact_host=true&limit=200`);
    assert(all.total > exact.total && exact.total > 0 && exact.items.every(({ hostname }) => hostname === 'scan.test'));
    await page.getByRole('button', { name: 'scan.test', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '精确主机' }).inputValue(), 'scan.test');
    await page.getByRole('tab', { name: '抓取流程' }).click();
    const recent = page.getByRole('region', { name: '最近采集事件' });
    await recent.focus();
    assert(await recent.evaluate((node) => node === document.activeElement), 'Keyboard can focus recent events');

    await page.setViewportSize({ width: 320, height: 256 });
    await page.getByRole('button', { name: '域名', exact: true }).click();
    const workspace = page.getByRole('main', { name: '扫描工作区' });
    await workspace.evaluate((node) => { node.scrollTop = 0; });
    await workspace.focus();
    await page.keyboard.press('PageDown');
    await waitFor(() => workspace.evaluate((node) => node.scrollTop > 0), 'Keyboard work area cannot scroll');
    await workspace.evaluate((node) => { node.scrollTop = 0; });
    await page.mouse.move(150, 110);
    await page.mouse.wheel(0, 480);
    await waitFor(() => workspace.evaluate((node) => node.scrollTop > 0), 'Wheel work area cannot scroll');
    await page.getByRole('button', { name: '预览与导出规则' }).click();
    const files = [];
    for (const [i, format] of ['Clash / Mihomo', 'Rule Provider', 'sing-box'].entries()) {
      if (i === 1) await page.setViewportSize({ width: 1220, height: 800 });
      if (i > 0) {
        await page.getByRole('combobox', { name: '输出格式', exact: true }).click();
        await page.getByRole('option', { name: new RegExp(format, 'i') }).click();
      }
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载文件', exact: true }).click();
      const output = await download;
      const content = await readFile(await output.path(), 'utf8');
      assert(content.includes('scan.test'), `${format} contains observations`);
      if (format === 'sing-box') assert.equal(JSON.parse(content).version, 3);
      if (format === 'Rule Provider') assert(content.includes('payload:'));
      files.push(format);
    }
    await page.getByRole('button', { name: '关闭导出', exact: true }).click();
    await page.getByRole('button', { name: '扫描历史' }).click();
    await page.getByRole('button', { name: '打开', exact: true }).first().click();
    await page.getByText(/已脱敏，重新采集时请输入原网址/).waitFor();
    assert.equal(await target.inputValue(), '');
    assert(await page.getByRole('button', { name: '开始采集' }).isDisabled());
    await page.getByRole('button', { name: '清空工作区' }).click();
    await page.getByText('等待首次发现').waitFor();
    assert.deepEqual(pageErrors, []);
    return { engine: name, requests: all.total, exact: exact.total, exports: files, viewport: [320, 256], weakNetworkReads: domainReads, passed: true };
  } finally {
    await browser.close();
  }
}

try {
  await readFile(path.join(root, 'backend/internal/webui/dist/index.html'));
  const [fixture, analyzer] = await Promise.all([build('testsite'), build('castorice')]);
  const target = await start(fixture, ['--listen', '127.0.0.1:0', '--mapped-hosts']);
  const port = new URL(target).port;
  const mappings = ['scan.test', 'api.scan.test', 'assets.scan.test'].map((host) => `${host}:${port}=127.0.0.1`).join(',');
  const data = path.join(stage, 'data');
  base = await start(analyzer, ['--server', '--no-open', '--listen', '127.0.0.1:0', '--data-dir', data, '--test-map-loopback', mappings, ...(process.env.CASTORICE_TEST_BROWSER ? ['--browser-path', process.env.CASTORICE_TEST_BROWSER] : [])]);
  const health = await request('/health');
  assert(health.browser_available, 'Install a Chromium-family browser on the service host.');
  report.version = health.version;
  for (const engine of engines) {
    const result = await verify(engine, port);
    report.browsers.push(result);
    console.log(JSON.stringify(result));
  }
  report.passed = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  if (base) {
    try {
      const task = await request('/scans/active');
      if (task) {
        const { token } = await request('/session');
        await request(`/scans/${task.id}/stop`, { method: 'POST', headers: { 'X-Castorice-Token': token } });
        await waitFor(async () => !(await request('/scans/active')), 'Scan has not stopped', 8000);
      }
    } catch { /* The process is still stopped below if the service has exited. */ }
  }
  for (const child of processes.reverse()) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      const exited = once(child, 'exit');
      child.kill();
      await Promise.race([exited, delay(5000, undefined, { ref: false })]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }
  const output = path.join(stage, 'acceptance.json');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(path.relative(root, output));
}
