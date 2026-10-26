import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { chromium } = require('playwright-core');
const base = process.env.CASTORICE_TEST_URL || 'http://127.0.0.1:19120';
const output = process.env.CASTORICE_UI_OUTPUT || path.join(root, '.runtime/v1.2-ui');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const report = { layouts: [], ruleContent: false, errors };
try {
 await page.goto(base);
 await page.getByRole('button', { name: '开始分析', exact: true }).waitFor();
 await page.waitForFunction(() => !document.body.textContent.includes('连接本地服务…'));
 for (const [width, height] of [[1920,1080],[1440,900],[1280,720],[1024,640],[820,600],[390,844],[640,360],[760,480]]) {
  await page.setViewportSize({ width, height });
  const metrics = await page.evaluate(() => {
   const workspace = document.querySelector('.workspace').getBoundingClientRect();
   const button = [...document.querySelectorAll('button')].find(e => e.textContent.includes('预览与导出规则')).getBoundingClientRect();
   return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, workspaceBottom: workspace.bottom, exportBottom: button.bottom };
  });
  report.layouts.push(metrics);
  assert(metrics.scrollWidth <= width && metrics.scrollHeight <= height, 'whole-page overflow: '+JSON.stringify(metrics));
  assert(metrics.workspaceBottom <= height + 1 && metrics.exportBottom <= height + 1, 'action clipped: '+JSON.stringify(metrics));
  await page.screenshot({ path: path.join(output, `layout-${width}x${height}.png`) });
 }
 await page.setViewportSize({ width: 1440, height: 900 });
 for (const scale of [1.25, 1.5]) {
  await page.evaluate(value => { document.documentElement.style.fontSize = `${16 * value}px`; }, scale);
  const bounds = await page.getByRole('button', { name: '预览与导出规则', exact: true }).boundingBox();
  assert(bounds && bounds.y + bounds.height <= 900, 'export clipped by text scaling');
 }
 await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
 const before = await page.locator('.workspace').boundingBox();
 await page.getByRole('button', { name: '高级设置', exact: true }).click();
 assert.equal(await page.getByRole('dialog').count(), 1);
 await page.getByRole('button', { name: '关闭高级设置' }).click();
 assert.deepEqual(await page.locator('.workspace').boundingBox(), before, 'advanced options changed workspace layout');
 await page.getByRole('button', { name: '开源规则库', exact: true }).click();
 await page.getByRole('textbox', { name: '搜索规则分类' }).fill('Facebook');
 const facebook = page.getByRole('button', { name: /^Facebook blackmatrix7/ });
 await facebook.waitFor(); await facebook.click();
 const editor = page.getByRole('textbox', { name: '规则原文编辑区' });
 await editor.waitFor();
 const raw = await editor.inputValue();
 assert(raw.includes('payload:') && raw.includes('DOMAIN-SUFFIX,facebook.com') && raw.includes('IP-CIDR'), 'original YAML incomplete');
 await page.getByRole('button', { name: '全选文本', exact: true }).click();
 assert.equal(await editor.evaluate(e => e.selectionEnd - e.selectionStart), raw.length);
 await page.getByRole('button', { name: '复制', exact: true }).click();
 assert((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n') === raw.replace(/\r\n/g, '\n'), 'clipboard text changed beyond platform newline conversion');
 await editor.fill(raw + '\n# temporary editor change\n');
 await page.getByRole('button', { name: '恢复原文' }).click();
 assert.equal(await editor.inputValue(), raw);
 const download = page.waitForEvent('download');
 await page.getByRole('button', { name: '下载', exact: true }).click();
 const file = await download;
 assert.equal(await fs.readFile(await file.path(), 'utf8'), raw);
 await editor.evaluate(e => { e.scrollTop = 0; });
 await page.screenshot({ path: path.join(output, 'facebook-original.png') });
 await page.getByRole('button', { name: '规则库设置', exact: true }).click();
 await page.getByLabel('自动更新到本地', { exact: true }).first().waitFor();
 assert.equal(await page.getByLabel('自动更新到本地', { exact: true }).count(), 2);
 await page.getByRole('button', { name: '完成', exact: true }).click();
 await page.setViewportSize({ width: 390, height: 844 });
 await page.screenshot({ path: path.join(output, 'facebook-phone.png') });
 const editorRect = await editor.boundingBox();
 assert(editorRect && editorRect.height > 200 && editorRect.x + editorRect.width <= 391, 'phone reader clipped');
 report.ruleContent = true;
 assert.equal(errors.length, 0, 'browser errors');
 console.log(JSON.stringify(report));
} finally {
 await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
 await browser.close();
}
