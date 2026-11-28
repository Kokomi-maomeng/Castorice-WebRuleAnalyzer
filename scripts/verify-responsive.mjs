import assert from 'node:assert/strict';
import path from 'node:path';

const close = (page, label) => page.getByRole('button', { name: label, exact: true });
const dialog = (page, label) => page.getByRole('dialog', { name: label, exact: true });
const zoomFactors = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

async function setZoom(page, steps) {
  await page.keyboard.press('Control+0');
  for (let step = 0; step < Math.abs(steps); step++) {
    await page.keyboard.press(steps < 0 ? 'Control+-' : 'Control+=');
  }
  await page.waitForFunction(factor =>
    Number(document.documentElement.style.getPropertyValue('--app-zoom')) === factor,
    zoomFactors[4 + steps]);
}

async function reachable(control) {
  await control.scrollIntoViewIfNeeded();
  await control.click({ trial: true });
  const bounds = await control.boundingBox();
  assert(bounds && bounds.width > 0 && bounds.height > 0);
}

export async function verifyModes(page) {
  const group = page.getByRole('radiogroup', { name: '扫描模式' });
  const address = page.getByRole('textbox', { name: '要分析的网站' });
  const [groupBounds, addressBounds] = await Promise.all([group.boundingBox(), address.boundingBox()]);
  assert(groupBounds.x + groupBounds.width < addressBounds.x, 'Scan mode precedes address on desktop');
  const quick = group.getByRole('radio', { name: '快速' });
  const depth = group.getByRole('radio', { name: '深度' });
  const hint = page.getByRole('tooltip').filter({ hasText: '同源链接' });
  await depth.hover();
  await hint.waitFor();
  assert(await quick.isChecked(), 'Hover does not change mode');
  await depth.click();
  await page.mouse.move(0, 0);
  await hint.waitFor();
  assert(await depth.isChecked(), 'Click selects the mode and pins its hint');
  await address.click();
  await hint.waitFor({ state: 'hidden' });
  await quick.click();
  await address.click();
}

export async function verifyRuleLibrary(page, output) {
  const source = {
    id: 'v2fly', name: 'v2fly', status: 'ready', loaded_count: 1, category_count: 1,
    version: '0123456789abcdef', auto_update: false, license: 'MIT',
    repository: 'https://github.com/v2fly/domain-list-community',
  };
  const raw = '# QA\ndomain:example.com\nfull:search.example.com\n';
  const category = {
    id: 'v2fly:example', source: source.id, name: 'Example', format: 'text',
    path: 'data/example', version: source.version, loaded: true, rule_count: 2, raw, warnings: [],
  };
  let cleared = 0;
  const routes = [
    [/\/api\/rules\/sources$/, () => [{ ...source, status: cleared ? 'not_initialized' : 'ready', category_count: cleared ? 0 : 1 }]],
    [/\/api\/rules\/categories\?/, () => cleared ? [] : [category]],
    [/\/api\/rules\/content\?/, () => category],
    [/\/api\/rules\/cache$/, (request) => {
      assert.equal(request.method(), 'DELETE');
      cleared++;
      return { cleared: true };
    }],
  ];
  for (const [url, respond] of routes) await page.route(url, route => route.fulfill({ json: { data: respond(route.request()) } }));

  const library = dialog(page, '开源规则库');
  const settings = library.getByRole('complementary', { name: '规则库设置' });
  const editor = library.getByRole('textbox', { name: '规则原文编辑区' });
  const openPanel = () => close(library, '展开规则库设置');
  const closePanel = () => close(library, '收起规则库设置');
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await close(page, '开源规则库').click();
    await library.getByRole('button', { name: /Example/ }).click();
    await editor.waitFor();
    const [reader, panel, copy, toggle] = await Promise.all([
      editor.boundingBox(), settings.boundingBox(), close(library, '复制').boundingBox(), closePanel().boundingBox(),
    ]);
    assert(panel.x >= reader.x + reader.width && toggle.x >= copy.x + copy.width, 'Settings and their toggle are to the right');
    assert.equal(await library.getByRole('dialog', { name: '规则库设置' }).count(), 0);
    if (output) await page.screenshot({ path: path.join(output, 'rule-library-wide.png') });
    await editor.fill(raw + '# draft\n');
    await editor.press('Control+a');
    assert(await editor.evaluate(input => input.selectionStart === 0 && input.selectionEnd === input.value.length));
    await closePanel().click();
    await settings.waitFor({ state: 'hidden' });
    assert((await editor.boundingBox()).width > reader.width + 120);
    await openPanel().click();
    await settings.focus();
    await setZoom(page, 3);
    await openPanel().waitFor();
    assert(await openPanel().evaluate(button => button === document.activeElement), 'Automatic collapse restores focus');
    await setZoom(page, 0);
    await closePanel().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await openPanel().waitFor();
    assert((await editor.boundingBox()).width > 300, 'Editor uses the available phone width');
    if (output) await page.screenshot({ path: path.join(output, 'rule-library-portrait.png') });
    await openPanel().click();
    await editor.waitFor({ state: 'hidden' });
    await closePanel().click();
    assert.equal(await editor.inputValue(), raw + '# draft\n');
    await openPanel().click();
    await close(settings, '清理规则库').click();
    const confirmation = dialog(page, '清理规则库');
    await close(confirmation, '取消').click();
    assert.equal(cleared, 0);
    await close(settings, '清理规则库').click();
    await close(confirmation, '确认清理').click();
    await confirmation.waitFor({ state: 'hidden' });
    assert.equal(cleared, 1);
    await closePanel().click();
    await library.getByText('尚未下载规则库').waitFor();
    await editor.waitFor({ state: 'hidden' });
    await close(library, '关闭规则库').click();
    await library.waitFor({ state: 'hidden' });
  } finally {
    for (const [url] of routes) await page.unroute(url);
    await setZoom(page, 0);
    await page.setViewportSize({ width: 1220, height: 800 });
  }
}

export async function verifyResponsive(page, output) {
  const layouts = [];
  const cases = [
    [1920, 1080, 0], [1280, 720, 0], [1024, 600, 0],
    [667, 375, 0], [390, 844, 0], [320, 568, 0],
    [1100, 720, 5], [390, 844, 3], [1024, 600, -4],
  ];
  const main = page.getByRole('main', { name: '扫描工作区' });
  for (const [width, height, zoom] of cases) {
    await page.setViewportSize({ width, height });
    await setZoom(page, zoom);
    await reachable(close(page, '重置工作区'));
    const state = await main.evaluate(node => ({
      wide: node.clientWidth, scroll: node.scrollWidth,
      zoom: getComputedStyle(node).getPropertyValue('--app-zoom').trim(),
    }));
    const compact = width / Number(state.zoom) <= 850;
    assert(state.scroll <= state.wide + 2, 'Workspace does not scroll horizontally: ' + JSON.stringify({ width, height, state }));
    if (compact) await close(page, '分析 / 规则命中').click();
    for (const label of [/网络请求/, /运行日志/, /规则命中/, /抓取流程/]) {
      const tab = page.getByRole('tab', { name: label });
      await tab.click();
      await page.getByRole('tabpanel', { name: label }).waitFor();
      if (label.source === '网络请求') {
        const request = page.getByRole('region', { name: '网络请求列表' }).getByRole('row').nth(1);
        if (await request.count() && await request.getAttribute('tabindex') === '0') {
          await request.press('Enter');
          await close(dialog(page, '请求详情'), '关闭请求详情').click();
        }
      }
      if (label.source === '运行日志') await reachable(close(page, '复制日志'));
    }
    if (compact) await close(page, '域名').click();
    await reachable(close(page, '预览与导出规则'));
    for (const [open, title, action, dismiss] of [
      ['软件设置', '软件设置', '保存设置', '关闭设置'],
      ['网络诊断', '网络诊断', '用于下次扫描', '关闭网络诊断'],
      ['扫描历史', '扫描历史', '关闭历史', '关闭历史'],
      ['开源规则库', '开源规则库', '关闭规则库', '关闭规则库'],
      ['预览与导出规则', '预览与导出规则', '下载文件', '关闭导出'],
    ]) {
      await close(page, open).click();
      const panel = dialog(page, title);
      await panel.waitFor();
      const bounds = await panel.boundingBox();
      assert(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= width + 1 &&
        bounds.y + bounds.height <= height + 1, 'Dialog fits: ' + JSON.stringify({ title, width, height, bounds }));
      await reachable(close(panel, action));
      if (title === '预览与导出规则') {
        await panel.getByRole('tab', { name: '文件内容' }).click();
        await reachable(close(panel, '编辑文件内容'));
      }
      if (output && title === '预览与导出规则' && width === 390 && zoom === 0) {
        await page.screenshot({ path: path.join(output, 'preview-portrait.png') });
      }
      await close(panel, dismiss).click();
      await panel.waitFor({ state: 'hidden' });
    }
    layouts.push({ width, height, zoom: Number(state.zoom) * 100 });
  }
  await setZoom(page, 0);
  await page.setViewportSize({ width: 1220, height: 800 });
  return layouts;
}
