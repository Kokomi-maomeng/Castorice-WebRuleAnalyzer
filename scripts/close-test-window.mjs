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
 if (process.env.CASTORICE_DESKTOP_SCREENSHOT) {
  await candidates[0].reload();
  await candidates[0].locator('.workspace').waitFor();
  await candidates[0].getByRole('button', { name: '预览与导出规则', exact: true }).click();
  const dialog = candidates[0].getByRole('dialog');
  await dialog.getByRole('button', { name: '保存到软件目录', exact: true }).click();
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
  console.log('Native UI export/reset/reload: PASS');
 }
 await candidates[0].evaluate(() => { setTimeout(() => window.__castoriceTestClose(), 100); });
} finally { await browser.close(); }
