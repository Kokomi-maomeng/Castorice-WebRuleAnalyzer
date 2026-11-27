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

async function verifyHistoryLayout(page, baseTask) {
  const route = /\/api\/scans\/history\?/;
  const rows = Array.from({ length: 67 }, (_, i) => ({
    ...baseTask, id: 'history-fixture-' + i, target_url: `entry-${i}.example.com`, status: 'completed',
  }));
  await page.route(route, async (request) => {
    const params = new URL(request.request().url()).searchParams;
    const start = Number(params.get('offset'));
    const query = params.get('q') ?? '';
    const matches = rows.filter(row => row.target_url.includes(query));
    if (query) await new Promise(resolve => setTimeout(resolve, 270));
    return request.fulfill({ json: { data: {
      items: matches.slice(start, start + 30), total: matches.length, finished_count: rows.length,
    } } });
  });
  try {
    await page.getByRole('button', { name: '扫描历史' }).click();
    const dialog = page.getByRole('dialog', { name: /扫描历史/ });
    const footer = dialog.locator('.history-footer');
    const list = dialog.locator('.history-content');
    const next = dialog.getByRole('button', { name: '下一页历史' });
    await footer.getByText('1–30 / 67').waitFor();
    const search = dialog.getByRole('textbox', { name: '搜索历史地址' });
    assert(await search.evaluate(input => {
      const wrapper = input.closest('.MuiFormControl-root');
      const field = wrapper.querySelector('.MuiOutlinedInput-root').getBoundingClientRect();
      const label = wrapper.querySelector('label').getBoundingClientRect();
      return Math.abs((field.top + field.height / 2) - (label.top + label.height / 2)) <= 1.5;
    }), 'History text field label is vertically centered');
    const first = dialog.getByRole('button', { name: '打开历史 entry-0.example.com' });
    await first.click({ modifiers: ['Control'] });
    await dialog.getByRole('button', { name: '打开历史 entry-4.example.com' }).click({ modifiers: ['Shift'] });
    assert.equal(await dialog.locator('.history-content input:checked').count(), 5, 'Shift includes every visible record in the range');
    assert(await first.evaluate(row => {
      const badge = row.querySelector('.MuiChip-root');
      const badgeRect = badge.getBoundingClientRect();
      const time = row.querySelector('time').getBoundingClientRect();
      return badge.classList.contains('MuiChip-colorPrimary') && badge.classList.contains('MuiChip-filled') && badgeRect.right <= time.left && badgeRect.top <= time.top;
    }), 'Completed history badge is filled and sits before the timestamp');
    const normalBounds = await dialog.boundingBox();
    const queryRequest = page.waitForRequest(req => new URL(req.url()).searchParams.get('q') === 'entry-66');
    await search.fill('entry-66');
    await queryRequest;
    assert(await first.isVisible(), 'Search retains displayed rows while waiting for results');
    await dialog.getByRole('button', { name: '打开历史 entry-66.example.com' }).waitFor();
    assert.deepEqual(await dialog.boundingBox(), normalBounds, 'Filtering leaves dialog geometry unchanged');
    assert(await search.evaluate(input => document.activeElement === input), 'Filtering preserves search focus');
    await search.clear();
    await first.waitFor();
    for (const [width, height] of [[1220, 800], [640, 360], [320, 256]]) {
      await page.setViewportSize({ width, height });
      await list.evaluate(node => { node.scrollTop = 0; });
      const before = await footer.boundingBox();
      assert(before && before.y >= 0 && before.y + before.height <= height, 'History footer fits viewport');
      assert(await dialog.getByRole('button', { name: '删除历史 entry-0.example.com' }).evaluate(node => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 43 && rect.height >= 43;
      }), 'History delete retains its hit area at narrow widths');
      assert(await next.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), 'History next page button is reachable without scrolling');
      const scroll = await list.evaluate(node => (node.scrollTop = node.scrollHeight, node.scrollTop));
      assert(scroll > 0, 'History list scrolls');
      assert.deepEqual(await footer.boundingBox(), before, 'History footer stays fixed while records scroll');
    }
    await next.click();
    await footer.getByText('31–60 / 67').waitFor();
    await dialog.getByText('entry-30.example.com', { exact: true }).waitFor();
    assert.equal(await list.evaluate(node => node.scrollTop), 0);
    await dialog.getByRole('button', { name: '关闭历史' }).click();
    await dialog.waitFor({ state: 'hidden' });
  } finally {
    await page.unroute(route);
    await page.setViewportSize({ width: 1220, height: 800 });
  }
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
    const help = page.getByRole('button', { name: '查看地址问题' });
    for (const [raw, hint] of [
      ['hostname', /域名后缀/],
      ['example。com', /英文点/],
      ['example.zzzzzz', /顶级域名/],
    ]) {
      await target.fill(raw);
      await target.press('Tab');
      await help.waitFor();
      await help.hover();
      await page.getByRole('tooltip').filter({ hasText: hint }).waitFor();
      assert.equal(await target.getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('main').getByRole('alert').count(), 0);
      await help.click();
      await page.mouse.move(0, 0);
      await page.getByRole('tooltip').filter({ hasText: hint }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('tooltip').filter({ hasText: hint }).waitFor({ state: 'hidden' });
    }
    await target.fill('');
    await page.getByRole('button', { name: '软件设置' }).click();
    await page.getByRole('spinbutton', { name: '每页观察 / 秒' }).fill('1');
    await page.getByRole('button', { name: '保存设置' }).click();
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: '软件设置' }).click();
    const settings = page.getByRole('dialog', { name: '软件设置' });
    const theme = settings.getByRole('combobox', { name: '主题' });
    await theme.click();
    await page.getByRole('option', { name: '跟随系统' }).click();
    assert.equal(await theme.locator('svg').count(), 1, 'Theme value has an icon');
    await settings.getByRole('button', { name: '查看扫描参数生效范围' }).click();
    await page.getByRole('tooltip').filter({ hasText: '保存后的参数用于之后启动的扫描' }).waitFor();
    await settings.getByRole('button', { name: '保存设置' }).click();
    await waitFor(() => page.locator('body').evaluate(node => getComputedStyle(node).colorScheme === 'dark'), 'Follow system theme');
    await settings.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: '切换主题' }).count(), 0);

    const zoom = (percent) => page.getByRole('button', { name: `缩放 ${percent}%，恢复默认缩放` });
    await zoom(100).click();
    const originalWidth = (await page.getByRole('button', { name: '放大', exact: true }).boundingBox()).width;
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await zoom(110).waitFor();
    assert((await page.getByRole('button', { name: '放大', exact: true }).boundingBox()).width > originalWidth);
    await page.keyboard.press('Control+=');
    await zoom(125).waitFor();
    await page.getByRole('button', { name: '软件设置' }).click();
    await theme.waitFor();
    await theme.scrollIntoViewIfNeeded();
    const themeHandle = await theme.elementHandle();
    await theme.click();
    const systemOption = page.getByRole('option', { name: '跟随系统' });
    await systemOption.waitFor();
    await delay(180);
    const anchor = await themeHandle.evaluate(node => node.parentElement.getBoundingClientRect().toJSON());
    const menu = await systemOption.evaluate(node => node.closest('.MuiPopover-paper').getBoundingClientRect().toJSON());
    assert(
      Math.abs(anchor.left + anchor.width / 2 - menu.left - menu.width / 2) < 5 &&
      Math.abs(anchor.bottom - menu.top) < 5,
      `Theme menu remains anchored at 125% zoom: ${JSON.stringify({ anchor, menu })}`,
    );
    await page.keyboard.press('Escape');
    await settings.getByRole('button', { name: '关闭设置' }).click();
    await settings.waitFor({ state: 'hidden' });
    await page.keyboard.press('Control+-');
    await zoom(110).waitFor();
    await zoom(110).click();
    await zoom(100).waitFor();

    await page.getByRole('button', { name: '软件设置' }).click();
    assert.equal(await page.getByRole('spinbutton', { name: '每页观察 / 秒' }).inputValue(), '1');
    await page.getByRole('button', { name: '关闭设置' }).click();
    await page.getByRole('button', { name: '网络诊断' }).click();
    const network = page.getByRole('dialog', { name: '网络诊断' });
    await network.waitFor();
    await network.getByRole('button', { name: '关闭网络诊断' }).click();
    await page.locator('[data-dialog-motion="exit"]').filter({ has: page.getByText('网络诊断', { exact: true }) }).waitFor();
    await network.waitFor({ state: 'hidden' });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    let domainReads = 0;
    const releaseDomains = Promise.withResolvers();
    await page.route(/\/api\/scans\/[^/]+\/domains$/, async (route) => {
      if (++domainReads === 1) {
        const first = await route.fetch();
        await releaseDomains.promise;
        await route.fulfill({ response: first });
      } else {
        await route.continue();
      }
    });
    await target.fill(String.raw`https\://http\://scan.test:${fixturePort}/discard-this?lang=zh#ignored`);
    const created = page.waitForResponse((r) => r.url() === base + '/api/scans' && r.status() === 201);
    await page.getByRole('button', { name: '开始采集' }).click();
    const { data: scan } = await (await created).json();
    const { id } = scan;
    assert.equal(scan.target_url, 'scan.test');
    assert.equal(scan.target_scheme, 'http');
    assert.equal(scan.target_port, fixturePort);
    assert.equal(await target.inputValue(), 'scan.test');
    try {
      await page.getByText('已自动清除前缀、路径或参数').waitFor();
      await page.getByText('正在补取最终采集结果…').waitFor({ timeout: 25000 });
      const finished = await request(`/scans/${id}`);
      assert.equal(finished.status, 'completed', finished.error || finished.end_reason);
    } finally {
      releaseDomains.resolve();
    }
    await page.getByRole('button', { name: 'api.scan.test', exact: true }).waitFor();
    await waitFor(() => domainReads >= 2, 'Fetch again after terminal update');
    await page.getByText('正在补取最终采集结果…').waitFor({ state: 'hidden' });
    const all = await request(`/scans/${id}/requests?limit=200`);
    const exact = await request(`/scans/${id}/requests?host=scan.test&exact_host=true&limit=200`);
    assert(all.total > exact.total && exact.total > 0 && exact.items.every(({ hostname }) => hostname === 'scan.test'));
    assert(all.items.some(({ url }) => url === `http://scan.test:${fixturePort}/`), 'Scan started from the site root');
    assert(!JSON.stringify(await request(`/scans/${id}`)).includes('discard-this'), 'Pasted path did not enter the record');
    const domainSort = page.getByRole('combobox', { name: '域名排序' });
    for (const choice of ['请求次数', '发现时间', '字母顺序']) {
      await domainSort.click();
      await page.getByRole('option', { name: choice, exact: true }).click();
      assert.equal(await domainSort.innerText(), choice);
      assert(await domainSort.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const style = getComputedStyle(element);
        return range.getBoundingClientRect().width <= element.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd) + 1;
      }), `${choice} fits in the sort field`);
    }
    const row = page.locator('.domain-row').filter({ has: page.getByRole('button', { name: 'scan.test', exact: true }) });
    const checkbox = row.getByRole('checkbox', { name: '选择 scan.test' });
    const selectTarget = await checkbox.evaluate(input => {
      const {width, height} = input.closest('.domain-row-action').getBoundingClientRect();
      return {width, height};
    });
    const copyTarget = await row.getByRole('button', { name: '复制 scan.test' }).boundingBox();
    assert(selectTarget.width >= 44 && selectTarget.height >= 44);
    assert.equal(copyTarget.width, selectTarget.width);
    assert.equal(copyTarget.height, selectTarget.height);
    await checkbox.click();
    assert.equal(await page.getByRole('tab', { name: '网络请求' }).getAttribute('aria-selected'), 'false');
    await checkbox.click();
    await row.getByText(/次 ·/).click();
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
        await page.getByRole('radiogroup', { name: '输出格式', exact: true }).getByRole('radio', { name: new RegExp(format, 'i') }).check();
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
    await verifyHistoryLayout(page, await request(`/scans/${id}`));
    await page.getByRole('button', { name: '扫描历史' }).click();
    await page.getByRole('button', { name: /^打开历史 / }).first().press('Enter');
    await page.getByRole('dialog', { name: '扫描历史' }).waitFor({ state: 'hidden' });
    assert.equal(await target.inputValue(), 'scan.test');
    assert(await page.getByRole('button', { name: '开始采集' }).isEnabled());
    await page.getByRole('button', { name: '清空工作区' }).click();
    await page.getByText('等待首次发现').waitFor();
    assert.deepEqual(pageErrors, []);
    return { engine: name, requests: all.total, exact: exact.total, exports: files, viewport: [320, 256], historyRows: 67, inlineAddressChecks: 3, rootAddress: true, weakNetworkReads: domainReads, passed: true };
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
