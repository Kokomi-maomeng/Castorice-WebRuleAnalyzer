// Only operates on an explicitly instrumented local acceptance window.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const port = Number(process.env.CASTORICE_DESKTOP_TEST_PORT || 19230);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test port');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
 const pages = browser.contexts().flatMap(c => c.pages());
 const candidates = [];
 for (const page of pages) {
  if (/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(page.url()) && await page.evaluate(() => typeof window.__castoriceTestClose === 'function')) candidates.push(page);
 }
 if (candidates.length !== 1) throw new Error('Expected one explicitly instrumented application window');
 const page = candidates[0];
 await page.getByRole('button', { name: '关闭窗口', exact: true }).waitFor();
 if (process.env.CASTORICE_DESKTOP_SCREENSHOT) {
  await page.reload();
  await page.getByText('等待首次发现', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '要分析的网站' }).inputValue(), '');
  const systemDark = await page.evaluate(() => window.castoriceWindow.systemDark);
  assert.equal(typeof systemDark, 'boolean', 'Native Windows app theme must be passed to WebView2');
  await page.getByRole('button', { name: '软件设置' }).click();
  const settings = page.getByRole('dialog', { name: '软件设置' });
  await settings.getByRole('combobox', { name: '主题' }).click();
  await page.getByRole('option', { name: '跟随系统' }).click();
  await settings.getByRole('button', { name: '保存设置' }).click();
  await settings.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).colorScheme), systemDark ? 'dark' : 'light');
  const zoom = (percent) => page.getByRole('button', { name: `缩放 ${percent}%，恢复默认缩放` });
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await zoom(110).waitFor();
  await page.keyboard.press('Control+=');
  await zoom(125).waitFor();
  await page.keyboard.press('Control+-');
  await zoom(110).waitFor();
  await zoom(110).click();
  await zoom(100).waitFor();
  await page.getByRole('button', { name: '扫描历史', exact: true }).click();
  await page.getByRole('button', { name: /^打开历史 / }).first().click();
  await candidates[0].getByRole('button', { name: '预览与导出规则', exact: true }).click();
  const dialog = candidates[0].getByRole('dialog');
  const filename = dialog.getByRole('textbox', { name: '文件名称', exact: true });
  const save = dialog.getByRole('button', { name: '保存到软件目录', exact: true });
  assert.equal(await filename.inputValue(), 'castorice-rules');
  await filename.fill('');
  assert(await save.isDisabled(), 'The desktop save action must require a filename');
  await filename.fill('castorice-rules');
  await save.click();
  const exportDir = await candidates[0].evaluate(() => window.castoriceDesktop.exportDir);
  const file = path.join(exportDir, 'castorice-rules.yaml');
  for (let attempt = 0; attempt < 30; attempt++) {
   try { if ((await fs.readFile(file, 'utf8')).includes('DOMAIN,example.com')) break; }
   catch { /* Wait for the real desktop export request. */ }
   if (attempt === 29) throw new Error('Native UI export file missing');
   await new Promise(resolve => setTimeout(resolve, 100));
  }
  await candidates[0].locator('.MuiSnackbar-root').waitFor({ state: 'hidden', timeout: 7000 });
  await candidates[0].screenshot({ path: process.env.CASTORICE_DESKTOP_SCREENSHOT.replace(/\.png$/, '-export.png') });
  await dialog.getByRole('button', { name: '关闭导出', exact: true }).click();
  await candidates[0].getByRole('button', { name: '清空工作区', exact: true }).click();
  await candidates[0].getByText('等待首次发现', { exact: true }).waitFor();
  await candidates[0].reload();
  await candidates[0].getByText('等待首次发现', { exact: true }).waitFor();
  assert(await candidates[0].getByRole('button', { name: '预览与导出规则', exact: true }).isDisabled());
  await candidates[0].screenshot({ path: process.env.CASTORICE_DESKTOP_SCREENSHOT });
  console.log(`Native UI theme (${systemDark ? 'dark' : 'light'}), zoom, export, reset and reload: PASS`);
 }
 await page.getByRole('button', { name: '关闭窗口', exact: true }).evaluate(button => {
  setTimeout(() => button.click(), 100);
 });
} finally { await browser.close(); }
