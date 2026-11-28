// Real service/UI acceptance. The optional density case is explicitly a browser fixture.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { chromium } = require(process.env.CASTORICE_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.CASTORICE_TEST_URL || 'http://127.0.0.1:19131';
const releaseTag = 'v' + (await fs.readFile(path.join(root, 'VERSION'), 'utf8')).trim().replace(/\.0$/, '');
const output = process.env.CASTORICE_UI_OUTPUT || path.join(root, `.runtime/${releaseTag}-export-ui`);
await fs.mkdir(output, { recursive: true });
const browser = process.env.CASTORICE_UI_CDP ? await chromium.connectOverCDP(process.env.CASTORICE_UI_CDP) : await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
let latest;
let latestJob;
let closing = false;
page.on('response', async response => {
 if (response.url().endsWith('/api/export') && response.ok()) {
  try { const value=(await response.json()).data; latestJob=response.request().postDataJSON(); latest=value; }
  catch (error) { if (!closing) errors.push(error.message); }
 }
});
const report = { passed: false, real: {}, layouts: [], fixture: {}, motion: {}, errors };
async function ready(expectedFormat) {
 await page.getByRole('button', { name: '下载文件', exact: true }).waitFor();
 await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '下载文件' && !b.disabled));
 // The response observer's JSON read can finish after the application enables download.
 // Correlate the expected content with its request before comparing the downloaded file.
 if (expectedFormat) {
  for (let i=0;i<100 && latestJob?.format!==expectedFormat;i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(latestJob?.format,expectedFormat,'export observer did not receive the selected format');
 }
}
try {
 await page.goto(base);
 await page.getByRole('button', { name: '预览与导出规则', exact: true }).waitFor();
 await page.getByRole('button', { name: '扫描历史', exact: true }).click();
 await page.getByRole('button', { name: /^打开历史 / }).first().click();
 await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '预览与导出规则' && !b.disabled));
 await page.getByRole('button', { name: '预览与导出规则', exact: true }).click();
 await ready();
 const dialog = page.getByRole('dialog');
 const merge = dialog.getByRole('radio', { name: '抓取结果+开源规则库', exact: true });
 const category = dialog.getByRole('combobox', { name: '规则分类', exact: true });
 await merge.check();
 if (process.env.CASTORICE_INIT_RULES === '1') {
  const downloadLibrary = dialog.getByRole('button', { name: '下载规则库', exact: true });
  await downloadLibrary.waitFor();
  assert.equal(await category.getAttribute('aria-invalid'), 'true');
  assert(await page.getByRole('checkbox', { name: /^导出 DOMAIN,/ }).count() > 0, 'empty cache hid captured entries');
  assert(await page.getByRole('button', { name: '下载文件' }).isDisabled(), 'empty merge enabled download');
  const help = dialog.getByRole('button', { name: '查看规则库下载提示' });
  await help.hover();
  const tip = page.getByRole('tooltip').filter({ hasText: '本地暂无可用的规则分类，下载后可搜索并合并' });
  await tip.waitFor();
  await help.click();
  await page.mouse.move(0, 0);
  await tip.waitFor();
  await help.press('Escape');
  await tip.waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(output, 'missing-library.png') });
  await downloadLibrary.click();
  const progress = dialog.locator('.export-library-field').getByRole('progressbar', { name: '正在下载规则库' });
  await progress.waitFor();
  const relation = await progress.evaluate(element => {
    const bar = element.getBoundingClientRect();
    const field = element.parentElement.querySelector('.MuiOutlinedInput-root').getBoundingClientRect();
    return { alignment: Math.abs(bar.left - field.left), widthDifference: Math.abs(bar.width - field.width), gap: bar.top - field.bottom };
  });
  assert(relation.alignment < 1 && relation.widthDifference < 1 && Math.abs(relation.gap) < 2, JSON.stringify(relation));
  await progress.waitFor({ state: 'hidden', timeout: 360000 });
  assert(await page.evaluate(async () => (await (await fetch('/api/rules/categories')).json()).data.length > 0), 'a catalog must be available');
  assert.equal(await category.getAttribute('aria-invalid'), 'false');
  assert.equal(await downloadLibrary.count(), 0);
  report.real.initialization = true;
 }
 const filename = dialog.getByRole('textbox', { name: '文件名称', exact: true });
 assert.equal(await filename.inputValue(), 'castorice-rules');
 assert(await filename.evaluate(input => input.closest('.MuiFormControl-root').nextElementSibling.textContent.trim() === '下载文件'));
 assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).count(), 0);
 await category.click();
 assert.equal(await page.getByRole('listbox').count(), 0, 'empty category input showed arbitrary options');
 await category.fill('Facebook');
 await page.waitForTimeout(6500); // Cross two real library polls, including new JSON objects.
 assert.equal(await category.inputValue(), 'Facebook', 'library polling erased search');
 await page.getByRole('option', { name: /^Facebook blackmatrix7/ }).click();
 await ready();
 assert.equal(await page.getByRole('button', { name: '导出设置', exact: true }).getAttribute('aria-expanded'), 'true');
 assert.equal(await page.getByRole('checkbox', { name: /^导出 DOMAIN/ }).count(), 30);
 report.real.previewEntries = latest.entries.length;
 assert(latest.entries.length > 500 && latest.content.includes('facebook.com'), 'real category content missing');
 const first = (await page.getByRole('checkbox', { name: /^导出 DOMAIN/ }).first().getAttribute('aria-label'));
 await page.getByRole('checkbox', { name: '选择本页', exact: true }).click();
 await ready();
 await page.getByRole('button', { name: '下一页', exact: true }).click();
 assert(await page.getByRole('checkbox', { name: /^导出 DOMAIN/ }).first().isChecked());
 await page.getByRole('button', { name: '上一页', exact: true }).click();
 assert(!(await page.getByRole('checkbox', { name: first, exact: true }).isChecked()), 'page change lost exclusions');
 await page.getByRole('textbox', { name: '搜索预览条目' }).fill('facebook.com');
 assert(await page.getByRole('checkbox', { name: /^导出 DOMAIN/ }).count() > 0);
 await page.getByRole('textbox', { name: '搜索预览条目' }).fill('blackmatrix7/Facebook');
 assert.equal(await page.getByRole('checkbox', { name: /^导出 DOMAIN/ }).count(), 30);
 await page.getByRole('textbox', { name: '搜索预览条目' }).fill('no-such-domain.invalid');
 await page.getByText('没有符合筛选条件的条目', { exact: true }).waitFor();
 await page.getByRole('textbox', { name: '搜索预览条目' }).fill('');
 await page.getByRole('button', { name: '恢复全选', exact: true }).click(); await ready();
 report.real.paginationAndSelection = true;
 for (const [width, height] of [[1920,1080],[1440,900],[1280,800],[1280,720],[1024,640],[820,600],[390,844],[640,360],[760,480]]) {
  await page.setViewportSize({ width, height });
  await page.locator('.preview-panel').scrollIntoViewIfNeeded();
  const metrics = await page.evaluate(() => { const panel = document.querySelector('.preview-scroll').getBoundingClientRect(); const action = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '下载文件').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, listHeight: panel.height, actionBottom: action.bottom }; });
  report.layouts.push(metrics);
  assert(metrics.scrollWidth <= width && metrics.scrollHeight <= height && metrics.actionBottom <= height && metrics.listHeight >= 99, JSON.stringify(metrics));
  await page.screenshot({ path: path.join(output, `export-${width}x${height}.png`) });
 }
 await page.setViewportSize({ width: 1440, height: 900 });
 for (const scale of [1.25, 1.5]) {
  await page.evaluate(scale => document.documentElement.style.fontSize = `${16 * scale}px`, scale);
  await page.getByRole('button', { name: '下载文件' }).scrollIntoViewIfNeeded();
  const rect = await page.getByRole('button', { name: '下载文件' }).boundingBox();
  assert(rect && rect.y + rect.height <= 900);
 }
 await page.evaluate(() => document.documentElement.style.fontSize = '');
 await page.getByRole('tab', { name: '文件内容', exact: true }).click();
 const numbers = page.locator('.line-number');
 const previewText = page.locator('.preview-file-text');
 assert.equal((await numbers.textContent()).split('\n').length, 200);
 await page.getByRole('button', { name: '下一页', exact: true }).click();
 assert.equal((await numbers.textContent()).split('\n')[0], '201');
 const originalFontSize = await previewText.evaluate(node => getComputedStyle(node).fontSize);
 const lineTotal = latest.content.replace(/\n$/, '').split('\n').length;
 assert.equal(await page.getByLabel('总行数', { exact: true }).textContent(), String(lineTotal));
 const lineSize = dialog.getByRole('combobox', { name: '每页行数', exact: true });
 await lineSize.click();
 await page.getByRole('option', { name: '完整显示', exact: true }).click();
 const allNumbers = (await numbers.textContent()).split('\n');
 assert.equal(allNumbers.length, lineTotal);
 assert.equal(allNumbers.at(-1), String(lineTotal));
 assert.equal(await previewText.textContent(), latest.content.replace(/\n$/, ''));
 assert.equal(await previewText.evaluate(node => getComputedStyle(node).fontSize), originalFontSize);
 assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).count(), 0);
 await lineSize.click();
 await page.getByRole('option', { name: '200', exact: true }).click();
 report.real.fullNumberedPreview = true;
 const formatControl = dialog.getByRole('radiogroup', { name: '输出格式', exact: true });
 const formatWidth = (await formatControl.boundingBox()).width;
 for (const [label, format] of [['Clash / Mihomo YAML','clash'],['Mihomo Rule Provider','provider'],['sing-box Source Rule Set v3','singbox']]) {
  await formatControl.getByRole('radio', { name: label, exact: true }).check(); await ready(format);
  assert(Math.abs((await formatControl.boundingBox()).width - formatWidth) < 1);
  assert(await formatControl.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  const content = latest.content;
  if (format === 'singbox') assert.equal(JSON.parse(content).version, 3);
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: '下载文件', exact: true }).click(); const file = await promise;
  assert.equal(await fs.readFile(await file.path(), 'utf8'), content, 'download differs from complete response');
  await page.getByRole('button', { name: '校验并准备复制', exact: true }).click();
  await page.getByRole('button', { name: '复制内容', exact: true }).click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g,'\n'), content.replace(/\r\n/g,'\n'));
 }
 report.real.completeDownloads = ['clash','provider','singbox'];
 await page.screenshot({ path: path.join(output, 'file-preview.png') });
 await page.getByRole('tab', { name: '条目与来源', exact: true }).click();
 const available = await page.evaluate(async () => (await (await fetch('/api/rules/categories')).json()).data);
 const largest = available.reduce((a, b) => a.rule_count > b.rule_count ? a : b);
 await category.fill(largest.name);
 const started = performance.now();
 await page.getByRole('option', { name: new RegExp(`^${largest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${largest.source}`) }).click();
 await ready();
 assert(latest.entries.length >= largest.rule_count, 'large real category was truncated');
 report.real.largeCategory = { id: largest.id, rules: largest.rule_count, previewEntries: latest.entries.length, elapsedMs: Math.round(performance.now() - started) };
 report.real.sources = await page.evaluate(async () => (await (await fetch('/api/rules/sources')).json()).data.map(s => ({ id: s.id, version: s.version, category_count: s.category_count })));
 await page.getByRole('button', { name: '关闭导出', exact: true }).click();
 await page.getByRole('button', { name: '重置工作区', exact: true }).click();
 await page.getByText('等待首次发现', { exact: true }).waitFor();
 assert.equal(await page.getByRole('textbox', { name: '要分析的网站' }).inputValue(), '');
 await page.reload(); await page.getByText('等待首次发现', { exact: true }).waitFor();
 assert(await page.getByRole('button', { name: '预览与导出规则' }).isDisabled());
 await page.getByRole('button', { name: '扫描历史', exact: true }).click();
 await page.getByRole('button', { name: /^打开历史 / }).first().click();
 await page.getByRole('button', { name: '预览与导出规则', exact: true }).click(); await ready();
 report.real.resetAndHistory = true;
 const content = Array.from({ length: 5000 }, (_, i) => `  - DOMAIN,fixture-${i}.example.com,Proxy`).join('\n')+'\n';
 const dense = { ...latest, content, final_rules: 5000, entries: Array.from({ length: 5000 }, (_, i) => ({ rule_type:'DOMAIN', rule_value:`fixture-${i}.example.com`, label:'本次抓取', selected:true, origins:[] })) };
 await page.getByRole('button', { name: '关闭导出', exact: true }).click();
 await page.route('**/api/export', route => route.fulfill({ json: { data: dense } }));
 await page.getByRole('button', { name: '预览与导出规则', exact: true }).click(); await ready();
 assert.equal(await page.getByRole('checkbox', { name: /^导出 DOMAIN/ }).count(), 30);
 await page.getByRole('textbox', { name: '搜索预览条目' }).fill('fixture-4999');
 assert.equal(await page.getByRole('checkbox', { name: /^导出 DOMAIN/ }).count(), 1);
 report.fixture = { explicitlySynthetic: true, entries: 5000, renderedPerPage: 30, tailSearch: true };
 const settingsButton = page.getByRole('button', { name: '导出设置', exact: true });
 await settingsButton.hover(); await page.mouse.down();
 await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '导出设置'); const t = getComputedStyle(b).transform; return t.startsWith('matrix(') && Number(t.slice(7).split(',')[0]) <= .971; });
 await page.mouse.up();
 await page.emulateMedia({ reducedMotion: 'reduce' });
 assert((await page.locator('.export-dialog .preview-row').first().evaluate(e => getComputedStyle(e).transitionDuration)).split(',').every(duration => duration.trim() === '0s'));
 await page.getByRole('button', { name: '关闭导出', exact: true }).click();
 await page.getByRole('button', { name: '软件设置', exact: true }).click();
 assert.equal(await page.locator('.MuiSwitch-switchBase').first().evaluate(e => getComputedStyle(e).transitionDuration), '0s');
 await page.emulateMedia({ reducedMotion: 'no-preference' });
 assert.notEqual(await page.locator('.MuiSwitch-switchBase').first().evaluate(e => getComputedStyle(e).transitionDuration), '0s');
 report.motion = { heldButtonFeedback: true, normalSwitchTransition: true, reducedMotion: true };
 assert.equal(errors.length, 0, JSON.stringify(errors)); report.passed = true;
 console.log(JSON.stringify(report));
} catch (error) {
 await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
 throw error;
} finally {
 closing = true;
 await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
 await browser.close();
}
