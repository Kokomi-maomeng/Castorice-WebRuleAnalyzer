// Real cached categories and exports; requires a completed scan and both rule sources.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { chromium } = require(process.env.CASTORICE_PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.CASTORICE_TEST_URL || 'http://127.0.0.1:19135';
const output = process.env.CASTORICE_UI_OUTPUT || path.join(root, '.runtime/export-compact-ui');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CASTORICE_UI_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, screen: { width: 2560, height: 1600 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const report = { passed: false, scalingModel: '2560x1600 physical, 200% device scale; 1280x800/720 CSS viewports', layouts: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
const download = page.getByRole('button', { name: '下载文件', exact: true });
const category = page.getByRole('combobox', { name: '规则分类', exact: true });
async function ready() {
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '下载文件' && !button.disabled));
}
async function select(field, option) {
  await page.getByRole('combobox', { name: field, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function choose(name, source = 'blackmatrix7') {
  await category.fill(name);
  await page.getByRole('option', { name: new RegExp(`^${name} ${source} `) }).click();
  await ready();
}
async function geometry() {
  return page.evaluate(() => {
    const list = document.querySelector('.preview-scroll').getBoundingClientRect();
    const head = document.querySelector('.preview-scroll thead').getBoundingClientRect();
    const input = document.querySelector('[aria-label="规则分类"]').getBoundingClientRect();
    const root = document.querySelector('[aria-label="规则分类"]').closest('.MuiOutlinedInput-root').getBoundingClientRect();
    const action = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '下载文件').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.preview-row')].map(row => row.getBoundingClientRect());
    return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, listTop: list.top, listHeight: list.height, visibleRows: rows.filter(r => r.top >= head.bottom - 1 && r.bottom <= list.bottom + 1).length, categoryHeight: root.height, inputWidth: input.width, actionBottom: action.bottom, bodyWidth: document.documentElement.scrollWidth, contentScrollTop: document.querySelector('.export-dialog .MuiDialogContent-root').scrollTop };
  });
}
try {
  await page.goto(base);
  await page.getByRole('button', { name: '预览与导出规则', exact: true }).click();
  await ready();
  const dialog = page.getByRole('dialog');
  for (const text of ['结果来源：', '需与客户端已有策略组名称一致', '个本地分类 ·', '导出包含 rules 段，合并到现有客户端配置']) {
    assert(!(await dialog.innerText()).includes(text), `unwanted helper remains: ${text}`);
  }
  await select('导出范围', '抓取 + 开源规则库');
  await category.click();
  assert.equal(await page.getByRole('listbox').count(), 0);
  const before = await geometry();
  await category.fill('Facebook');
  await page.waitForTimeout(6500);
  assert.equal(await category.inputValue(), 'Facebook');
  assert.equal(await page.getByRole('option', { name: /^Facebook blackmatrix7/ }).count(), 1);
  // Sample through async selection/recomputation, not just its final layout.
  await page.evaluate(() => {
    window.exportLayoutSamples = [];
    window.exportLayoutSampling = true;
    function sample() {
      const content = document.querySelector('.export-dialog .MuiDialogContent-root');
      const box = document.querySelector('.preview-scroll')?.getBoundingClientRect();
      if (box) window.exportLayoutSamples.push({ top: box.top, height: box.height, scrollTop: content.scrollTop });
      if (window.exportLayoutSampling) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.getByRole('option', { name: /^Facebook blackmatrix7/ }).click();
  await ready();
  await page.waitForTimeout(250);
  const samples = await page.evaluate(() => { window.exportLayoutSampling = false; return window.exportLayoutSamples; });
  const after = await geometry();
  const jump = Math.max(...samples.map(s => Math.abs(s.top - before.listTop)), Math.abs(after.listTop - before.listTop));
  report.categorySelection = { before, after, searchSurvivedPolls: true, sampleCount: samples.length, maxListShift: jump, scrollStayed: samples.every(s => s.scrollTop === before.contentScrollTop) };
  assert(jump <= 2, `category selection shifted preview by ${jump}px`);
  assert(samples.every(s => s.scrollTop === before.contentScrollTop));
  assert.equal(await page.getByRole('button', { name: '导出设置', exact: true }).getAttribute('aria-expanded'), 'true');
  await category.fill('Face');
  await page.waitForTimeout(6500);
  assert.equal(await category.inputValue(), 'Face');
  assert.equal(await page.locator('.export-category-tags .MuiChip-root').count(), 1);
  await category.fill('');
  await category.press('Tab');
  for (const [width, height] of [[1280,800],[1280,720]]) {
    await page.setViewportSize({ width, height });
    const metrics = await geometry();
    assert.equal(metrics.dpr, 2);
    assert(metrics.bodyWidth <= width && metrics.actionBottom <= height);
    assert(metrics.visibleRows >= (height === 800 ? 7 : 5), JSON.stringify(metrics));
    report.layouts.push(metrics);
    await page.screenshot({ path: path.join(output, `export-dpr2-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const suffix = page.getByRole('button', { name: '查看 DOMAIN-SUFFIX 提示' });
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await suffix.hover();
  await page.getByRole('tooltip').waitFor();
  assert((await page.getByRole('tooltip').innerText()).includes('默认精确 DOMAIN 更保守'));
  await page.mouse.move(10, 10);
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  await page.getByRole('checkbox', { name: '观察域名使用 DOMAIN-SUFFIX', exact: true }).click();
  await ready();
  await suffix.click();
  await page.getByRole('tooltip').waitFor();
  assert((await page.getByRole('tooltip').innerText()).includes('已主动选择 DOMAIN-SUFFIX'));
  await page.screenshot({ path: path.join(output, 'suffix-tooltip.png') });
  await suffix.press('Escape');
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('dialog').count(), 1);
  await suffix.click();
  await page.getByRole('tooltip').waitFor();
  await page.locator('.export-title > span').click();
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  const captureHint = page.getByRole('button', { name: '查看抓取与范围提示' });
  if (await captureHint.count()) {
    const title = await captureHint.boundingBox();
    const heading = await page.locator('.export-title > span').boundingBox();
    assert(title.x >= heading.x + heading.width && Math.abs(title.y - heading.y) < 12);
    await captureHint.click();
    await page.getByRole('tooltip').waitFor();
    assert((await page.getByRole('tooltip').innerText()).length > 0);
    await captureHint.press('Escape');
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    report.captureHint = true;
  }
  report.hints = { hover: true, click: true, escape: true, outsideClick: true };
  await page.getByRole('checkbox', { name: '观察域名使用 DOMAIN-SUFFIX', exact: true }).click();
  await ready();
  await page.getByRole('combobox', { name: '显示条目', exact: true }).click();
  assert.equal(await page.getByRole('option', { name: '已勾选', exact: true }).count(), 0);
  assert.equal(await page.getByRole('option', { name: '未勾选', exact: true }).count(), 0);
  await page.getByRole('option', { name: '本次抓取', exact: true }).click();
  assert.equal(await page.locator('.preview-row').count(), 1);
  await select('显示条目', '规则库补充');
  assert.equal(await page.locator('.preview-row').count(), 30);
  await select('显示条目', '被覆盖');
  await page.getByText('没有符合筛选条件的条目', { exact: true }).waitFor();
  await select('显示条目', '全部条目');
  for (const name of ['YouTube','Telegram','Google']) await choose(name);
  const multiple = await geometry();
  assert.equal(await page.locator('.export-category-tags .MuiChip-root').count(), 4);
  assert.equal(multiple.categoryHeight, after.categoryHeight);
  assert(multiple.inputWidth >= 100, JSON.stringify(multiple));
  report.multipleCategories = { count: 4, inputWidth: multiple.inputWidth, height: multiple.categoryHeight };
  await select('导出范围', '仅抓取结果');
  await ready();
  await page.getByRole('combobox', { name: '显示条目', exact: true }).click();
  assert.equal(await page.getByRole('option', { name: '规则库补充', exact: true }).count(), 0);
  assert.equal(await page.getByRole('option', { name: '全部条目', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('option', { name: '全部条目', exact: true }).click();
  report.filters = true;
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.passed = true;
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
