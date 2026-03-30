const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'TEST_REPORT.md');
const now = new Date().toISOString();

const requiredFiles = [
  'README.md',
  'app-core.js',
  'main.js',
  'preload.js',
  'renderer-config.js',
  'sound-player.js',
  'control.html',
  'control.js',
  'pet.html',
  'pet.js',
  'styles.css',
  'package.json',
  'build-windows.bat',
  'build.yml',
  '.github/workflows/build.yml',
  'scripts/qa-check.js'
];

const syntaxFiles = [
  'app-core.js',
  'main.js',
  'preload.js',
  'renderer-config.js',
  'sound-player.js',
  'control.js',
  'pet.js',
  'scripts/qa-check.js'
];

const results = [];
let failed = false;

function addResult(status, title, details = '') {
  results.push({ status, title, details: String(details || '').trim() });
  const icon = status === 'pass' ? '✓' : status === 'warn' ? '!' : '✗';
  const log = status === 'fail' ? console.error : console.log;
  log(`${icon} ${title}${details ? `\n${details}` : ''}`);
  if (status === 'fail') failed = true;
}

function pass(title, details = '') {
  addResult('pass', title, details);
}

function warn(title, details = '') {
  addResult('warn', title, details);
}

function fail(title, details = '') {
  addResult('fail', title, details);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options
  });
}

function collectIds(html) {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  return {
    ids: new Set(ids),
    duplicates: [...new Set(duplicates)]
  };
}

function collectDollarRefs(js) {
  return [...js.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
}

function collectGetElementByIdRefs(js) {
  return [...js.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);
}

function collectExposedMethods(js) {
  const exposeMatch = js.match(/exposeInMainWorld\('desktopPet',\s*\{([\s\S]*?)\}\);/);
  if (!exposeMatch) return [];
  return [...exposeMatch[1].matchAll(/\n\s*([a-zA-Z0-9_]+)\s*:/g)].map((match) => match[1]);
}

function collectRendererApiUses(js) {
  return [...js.matchAll(/window\.desktopPet\.([a-zA-Z0-9_]+)\s*\(/g)].map((match) => match[1]);
}

function requireContains(file, snippets) {
  const text = read(file);
  const missing = snippets.filter((snippet) => !text.includes(snippet));
  return missing;
}

function writeReport() {
  const grouped = {
    pass: results.filter((item) => item.status === 'pass'),
    warn: results.filter((item) => item.status === 'warn'),
    fail: results.filter((item) => item.status === 'fail')
  };

  const lines = [
    '# 测试与检查报告',
    '',
    `生成时间：${now}`,
    '',
    `总体结论：${failed ? '**未通过，需修复失败项。**' : '**全部通过。**'}`,
    '',
    '## 结果汇总',
    '',
    `- 通过：${grouped.pass.length}`,
    `- 警告：${grouped.warn.length}`,
    `- 失败：${grouped.fail.length}`,
    ''
  ];

  for (const section of ['pass', 'warn', 'fail']) {
    const titleMap = { pass: '通过项', warn: '警告项', fail: '失败项' };
    lines.push(`## ${titleMap[section]}`, '');
    if (!grouped[section].length) {
      lines.push('- 无', '');
      continue;
    }
    for (const item of grouped[section]) {
      lines.push(`- ${item.title}`);
      if (item.details) {
        lines.push('', '```text', item.details, '```');
      }
    }
    lines.push('');
  }

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
}

try {
  requiredFiles.forEach((file) => {
    if (exists(file)) pass(`必要文件存在：${file}`);
    else fail(`缺少必要文件：${file}`);
  });

  syntaxFiles.forEach((file) => {
    const result = run(process.execPath, ['--check', path.join(root, file)]);
    if (result.status === 0) {
      pass(`语法检查通过：${file}`);
    } else {
      fail(`语法检查失败：${file}`, result.stderr || result.stdout);
    }
  });

  const controlHtml = read('control.html');
  const petHtml = read('pet.html');
  const controlJs = read('control.js');
  const petJs = read('pet.js');
  const preloadJs = read('preload.js');
  const mainJs = read('main.js');
  const packageJson = JSON.parse(read('package.json'));

  const controlIds = collectIds(controlHtml);
  const petIds = collectIds(petHtml);
  if (!controlIds.duplicates.length) pass('control.html 没有重复 ID');
  else fail('control.html 存在重复 ID', controlIds.duplicates.join(', '));

  if (!petIds.duplicates.length) pass('pet.html 没有重复 ID');
  else fail('pet.html 存在重复 ID', petIds.duplicates.join(', '));

  const missingControlIds = [...new Set(collectDollarRefs(controlJs).filter((id) => !controlIds.ids.has(id)))];
  if (!missingControlIds.length) pass('control.js 的 DOM 引用完整');
  else fail('control.js 引用了不存在的 DOM ID', missingControlIds.join(', '));

  const missingPetIds = [...new Set(collectGetElementByIdRefs(petJs).filter((id) => !petIds.ids.has(id)))];
  if (!missingPetIds.length) pass('pet.js 的 DOM 引用完整');
  else fail('pet.js 引用了不存在的 DOM ID', missingPetIds.join(', '));

  if (packageJson.main && exists(packageJson.main)) pass(`package.json main 指向有效文件：${packageJson.main}`);
  else fail('package.json main 字段无效', packageJson.main || '(empty)');

  if ((packageJson.scripts || {}).check === 'node scripts/qa-check.js') pass('package.json 已接入 QA 检查脚本');
  else fail('package.json 未正确配置 check 脚本', JSON.stringify(packageJson.scripts || {}, null, 2));

  const exposedMethods = collectExposedMethods(preloadJs);
  const usedMethods = [...new Set([...collectRendererApiUses(controlJs), ...collectRendererApiUses(petJs)])].sort();
  const missingExposed = usedMethods.filter((method) => !exposedMethods.includes(method));
  if (!missingExposed.length) pass('渲染层调用的 desktopPet API 均已在 preload 暴露');
  else fail('存在未暴露的 desktopPet API', missingExposed.join(', '));

  const requiredPreloadMethods = [
    'getState',
    'saveState',
    'updateFocus',
    'generateAvatar',
    'chatAvatar',
    'selectImage',
    'showControlWindow',
    'testLLMConnection',
    'getWeatherNow',
    'openPreviewUrl',
    'triggerVisitor',
    'playSound',
    'onStateUpdated',
    'onVisitor',
    'onPlaySound',
    'startDrag',
    'dragging',
    'endDrag'
  ];
  const missingPreloadMethods = requiredPreloadMethods.filter((method) => !exposedMethods.includes(method));
  if (!missingPreloadMethods.length) pass('preload API 功能面完整');
  else fail('preload API 缺少必要方法', missingPreloadMethods.join(', '));

  const mainFeatureSnippets = [
    "ipcMain.handle('get-state'",
    "ipcMain.handle('save-state'",
    "ipcMain.handle('update-focus'",
    "ipcMain.handle('generate-avatar'",
    "ipcMain.handle('chat-avatar'",
    "ipcMain.handle('test-llm-connection'",
    "ipcMain.handle('get-weather-now'",
    "ipcMain.handle('open-preview-url'",
    "ipcMain.handle('trigger-visitor'",
    "ipcMain.on('start-drag'",
    "ipcMain.on('dragging'",
    "ipcMain.on('end-drag'",
    'defaultSession.webRequest.onBeforeRequest',
    "sendToWindow(petWindow, 'show-visitor'",
    "target.send('play-sound'"
  ];
  const missingMainFeatures = requireContains('main.js', mainFeatureSnippets);
  if (!missingMainFeatures.length) pass('主进程 IPC、网站屏蔽、访客与音效通道完整');
  else fail('主进程缺少关键功能接线', missingMainFeatures.join('\n'));

  const htmlScriptChecks = [
    { file: 'control.html', snippets: ['renderer-config.js', 'sound-player.js', 'control.js'] },
    { file: 'pet.html', snippets: ['renderer-config.js', 'sound-player.js', 'pet.js'] }
  ];
  htmlScriptChecks.forEach(({ file, snippets }) => {
    const missing = requireContains(file, snippets);
    if (!missing.length) pass(`${file} 已加载所需脚本`);
    else fail(`${file} 缺少脚本引用`, missing.join(', '));
  });

  const core = require(path.join(root, 'app-core.js'));
  try {
    assert.strictEqual(core.normalizeDomain('https://www.YouTube.com/watch?v=1'), 'youtube.com');
    assert.strictEqual(core.normalizeDomain('www.baidu.com'), 'baidu.com');
    assert.deepStrictEqual(core.normalizeBlockedSites([' youtube.com ', 'https://www.youtube.com']), ['youtube.com']);
    assert.strictEqual(core.hostMatchesBlocked('m.youtube.com', ['youtube.com']), true);
    assert.strictEqual(core.hostMatchesBlocked('youtube.com.cn', ['youtube.com']), false);
    assert.strictEqual(core.isWeatherQuery('今天天气怎么样'), true);
    assert.strictEqual(core.isWeatherQuery('今天专注多久'), false);
    const weatherLine = core.buildWeatherSummary({ city: '上海', description: '晴', temp: 26, feelsLike: 27, humidity: 60, windSpeed: 3.2 });
    assert.ok(weatherLine.includes('上海'));
    assert.ok(weatherLine.includes('26°C'));
    const normalized = core.normalizeState({
      settings: { llmApiUrl: 'https://example.com/v1/chat/completions', llmApiKey: 'abc123' },
      imageApiUrl: 'https://image.example.com',
      imageApiKey: 'img-key',
      blockedSites: ['https://www.youtube.com', 'youtube.com'],
      activeTheme: 'non-existent',
      avatars: [{ id: '1', name: 'A', style: 'cute', mood: 'happy', energy: 70, prompt: 'x', messages: [] }],
      activeAvatarId: '404'
    });
    assert.strictEqual(normalized.settings.customApiUrl, 'https://example.com/v1/chat/completions');
    assert.strictEqual(normalized.settings.apiKey, 'abc123');
    assert.strictEqual(normalized.settings.imageApiUrl, 'https://image.example.com');
    assert.strictEqual(normalized.settings.imageApiKey, 'img-key');
    assert.deepStrictEqual(normalized.blockedSites, ['youtube.com']);
    assert.strictEqual(normalized.activeTheme, 'default');
    assert.strictEqual(normalized.activeAvatarId, '1');
    pass('app-core.js 的核心兼容与业务规则测试通过');
  } catch (error) {
    fail('app-core.js 规则测试失败', error.stack || error.message);
  }

  if (exists('build.yml') && exists('.github/workflows/build.yml')) {
    const workflowRoot = read('build.yml');
    const workflowGitHub = read('.github/workflows/build.yml');
    if (workflowRoot === workflowGitHub) pass('根目录 build.yml 与 .github/workflows/build.yml 已保持一致');
    else warn('根目录 build.yml 与 .github/workflows/build.yml 不一致', '建议保持一致，避免发布流程混淆。');
  }
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packResult = run(npmCommand, ['pack', '--dry-run']);

if (packResult.status === 0) {
  pass('npm pack --dry-run 通过', (packResult.stdout || '').trim());
} else {
  const packError = packResult.error ? `${packResult.error.message}\n` : '';
  fail('npm pack --dry-run 失败', `${packError}${(packResult.stderr || packResult.stdout || '').trim()}`.trim());
}
} catch (error) {
  fail('QA 脚本执行异常', error.stack || error.message);
}

writeReport();

if (failed) {
  process.exit(1);
}
