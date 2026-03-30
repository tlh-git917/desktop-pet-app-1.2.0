const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, session } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  APP_TITLE,
  clamp,
  normalizeState,
  getFocusSnapshot,
  isFocusBlockingActive,
  hostMatchesBlocked,
  isWeatherQuery,
  buildWeatherSummary,
  pickRandom
} = require('./app-core');

const statePath = path.join(app.getPath('userData'), 'app-state.json');
const VISITOR_MIN_INTERVAL_MS = 30 * 60 * 1000;
const VISITOR_MAX_INTERVAL_MS = 60 * 60 * 1000;
const WEATHER_CACHE_MS = 10 * 60 * 1000;

let petWindow = null;
let controlWindow = null;
let tray = null;
let previewWindow = null;
let refreshTrayMenu = () => {};
let visitorTimer = null;
let tickerHandle = null;
let isQuitting = false;
let state = loadState();
const dragSessions = new Map();
const weatherCache = new Map();

function loadState() {
  try {
    if (!fs.existsSync(statePath)) {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      const created = normalizeState({});
      fs.writeFileSync(statePath, JSON.stringify(created, null, 2));
      return created;
    }

    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return normalizeState(parsed);
  } catch (error) {
    console.error('Failed to load state:', error);
    return normalizeState({});
  }
}

function saveState() {
  try {
    state = normalizeState(state);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Failed to save state:', error);
  }
}

function getActiveAvatar(currentState = state) {
  const avatars = Array.isArray(currentState.avatars) ? currentState.avatars : [];
  return avatars.find((avatar) => avatar.id === currentState.activeAvatarId) || avatars[0] || null;
}

function getStatePayload() {
  state = normalizeState(state);
  return {
    state: {
      ...state,
      focus: getFocusSnapshot(state)
    },
    activeAvatar: getActiveAvatar(state)
  };
}

function sendToWindow(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function broadcastState() {
  const payload = getStatePayload();
  sendToWindow(petWindow, 'state-updated', payload);
  sendToWindow(controlWindow, 'state-updated', payload);
}

function constrainPetBounds(bounds = state.petBounds) {
  const width = clamp(bounds.width, 180, 420, 240);
  const height = clamp(bounds.height, 180, 420, 240);
  const point = {
    x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : 40,
    y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : 40
  };
  const display = screen.getDisplayNearestPoint(point) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  const x = Math.min(Math.max(point.x, area.x), maxX);
  const y = Math.min(Math.max(point.y, area.y), maxY);
  return { x, y, width, height };
}

function setPetAlwaysOnTop() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setAlwaysOnTop(!!state.settings.alwaysOnTop);
}

function createPetWindow() {
  const bounds = constrainPetBounds(state.petBounds);
  state.petBounds = bounds;

  petWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: !!state.settings.alwaysOnTop,
    title: APP_TITLE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  petWindow.loadFile(path.join(__dirname, 'pet.html'));

  petWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      petWindow.hide();
    }
  });

  petWindow.on('moved', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const [x, y] = petWindow.getPosition();
    const [width, height] = petWindow.getSize();
    state.petBounds = constrainPetBounds({ x, y, width, height });
    saveState();
  });

  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: APP_TITLE,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  controlWindow.loadFile(path.join(__dirname, 'control.html'));

  controlWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      controlWindow.hide();
    }
  });

  controlWindow.on('closed', () => {
    controlWindow = null;
  });
}

function showControlWindow() {
  if (!controlWindow || controlWindow.isDestroyed()) {
    createControlWindow();
  }
  controlWindow.show();
  controlWindow.focus();
}

function createPreviewWindow(urlToOpen) {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.close();
  }

  previewWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    title: '专注模式验证页',
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  previewWindow.loadURL(urlToOpen);
  previewWindow.on('closed', () => {
    previewWindow = null;
  });
}

function createTray() {
  const image = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAA90lEQVR4AWP4TwAw/P//PwMDA8P///8ZGBiYwMDA4P///xkYGBjw////GQYGBkYGBgYe/fv3fwYGBib/////gYGBgYEhIyPjP2JjY7+ysrL/4+Pj/8LCwv9WVlb/FxcX/1NTU/+5ubn/6urq/1dXV/+dnZ3/2NjY/8HBwf+Wlpb/7e3t/39/f/9mZmb/0tLS/8fHx/+goKD/9vb2/5WVlf+hoaH/5+fn/+Dg4P8pKSn/FRUV/8zMzP9RUVH/9fX1/9DQ0P8YGBhQYGBg8P///5GRkf8YGBgYGBgYGLi4uP8fHx8YGBgYGBgYGOA/AKzrN9tWBv7uAAAAAElFTkSuQmCC'
  );

  tray = new Tray(image);

  const updateMenu = () => {
    if (!tray) return;
    const focus = getFocusSnapshot(state);
    const startPauseLabel = !focus.isRunning ? '开始专注' : focus.isPaused ? '继续专注' : '暂停专注';

    const menu = Menu.buildFromTemplate([
      {
        label: '显示桌宠',
        click: () => {
          if (petWindow) petWindow.show();
        }
      },
      {
        label: '打开主控制台',
        click: () => showControlWindow()
      },
      { type: 'separator' },
      {
        label: startPauseLabel,
        click: () => toggleFocusFromTray()
      },
      {
        label: state.settings.alwaysOnTop ? '关闭始终置顶' : '开启始终置顶',
        click: () => {
          state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
          saveState();
          setPetAlwaysOnTop();
          broadcastState();
          updateMenu();
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip(APP_TITLE);
    tray.setContextMenu(menu);
  };

  tray.on('double-click', () => {
    if (petWindow) petWindow.show();
    showControlWindow();
  });

  updateMenu();
  return updateMenu;
}

function chooseSoundTarget(preferredWebContents = null) {
  if (preferredWebContents && !preferredWebContents.isDestroyed()) {
    return preferredWebContents;
  }

  if (controlWindow && !controlWindow.isDestroyed() && controlWindow.isVisible()) {
    return controlWindow.webContents;
  }

  if (petWindow && !petWindow.isDestroyed()) {
    return petWindow.webContents;
  }

  return null;
}

function playSound(soundId, preferredWebContents = null) {
  const target = chooseSoundTarget(preferredWebContents);
  if (target) {
    target.send('play-sound', soundId);
  }
}

function updateLastInteraction() {
  state.lastInteractionTime = Date.now();
}

function applyStatePatch(patch = {}) {
  const previousCompletedPlans = state.plans.filter((plan) => plan.done).length;
  const merged = normalizeState({
    ...state,
    ...patch,
    settings: patch.settings ? { ...state.settings, ...patch.settings } : state.settings,
    focus: patch.focus ? { ...state.focus, ...patch.focus } : state.focus
  });

  const nextCompletedPlans = merged.plans.filter((plan) => plan.done).length;
  const completedDiff = nextCompletedPlans - previousCompletedPlans;

  if (completedDiff > 0) {
    merged.happiness = clamp(merged.happiness + completedDiff * 10, 0, 100, merged.happiness);
  } else if (completedDiff < 0) {
    merged.happiness = clamp(merged.happiness + completedDiff * 5, 0, 100, merged.happiness);
  }

  if (patch.blockedSites) {
    merged.blockedSites = patch.blockedSites;
  }

  merged.lastInteractionTime = Date.now();
  state = normalizeState(merged);
  saveState();
  setPetAlwaysOnTop();
  if (refreshTrayMenu) refreshTrayMenu();
  broadcastState();

  return { completedDiff };
}

function updateFocusState(focusPatch = {}) {
  state = normalizeState({
    ...state,
    focus: {
      ...state.focus,
      ...focusPatch
    }
  });
  updateLastInteraction();
  saveState();
  if (refreshTrayMenu) refreshTrayMenu();
  broadcastState();
  return getFocusSnapshot(state);
}

function toggleFocusFromTray() {
  const focus = getFocusSnapshot(state);
  if (!focus.isRunning) {
    updateFocusState({
      isRunning: true,
      isPaused: false,
      mode: 'focus',
      remainingSeconds: state.focus.focusMinutes * 60,
      startedAt: Date.now(),
      pausedAt: null
    });
    return;
  }

  if (!focus.isPaused) {
    updateFocusState({
      isPaused: true,
      remainingSeconds: focus.currentRemainingSeconds || focus.remainingSeconds,
      startedAt: null,
      pausedAt: Date.now()
    });
    return;
  }

  updateFocusState({
    isPaused: false,
    startedAt: Date.now(),
    pausedAt: null
  });
}

function completeFocusTransition() {
  const focus = getFocusSnapshot(state);
  if (!focus.isRunning || focus.currentRemainingSeconds > 0) return;

  if (focus.mode === 'focus') {
    state.focus.completedSessions += 1;
    state.focusCoins += state.focus.focusMinutes;
    state.happiness = clamp(state.happiness + 4, 0, 100, state.happiness);
    state.focus.mode = 'break';
    state.focus.remainingSeconds = state.focus.breakMinutes * 60;
    state.focus.startedAt = Date.now();
    state.focus.isPaused = false;
    state.focus.isRunning = true;
    playSound('focus-complete');
  } else {
    state.focus.mode = 'focus';
    state.focus.remainingSeconds = state.focus.focusMinutes * 60;
    state.focus.startedAt = null;
    state.focus.isPaused = false;
    state.focus.isRunning = false;
    state.focus.pausedAt = null;
  }

  saveState();
  if (refreshTrayMenu) refreshTrayMenu();
  broadcastState();
}

function startTicker() {
  if (tickerHandle) return;
  let secondsElapsed = 0;
  tickerHandle = setInterval(() => {
    secondsElapsed += 1;
    completeFocusTransition();

    if (secondsElapsed % 600 === 0) {
      const twoHoursMs = 2 * 60 * 60 * 1000;
      if (Date.now() - state.lastInteractionTime > twoHoursMs) {
        state.happiness = clamp(state.happiness - 1, 0, 100, state.happiness);
        saveState();
      }
    }

    broadcastState();
  }, 1000);
}

function randomVisitorDelay() {
  const delta = VISITOR_MAX_INTERVAL_MS - VISITOR_MIN_INTERVAL_MS;
  return VISITOR_MIN_INTERVAL_MS + Math.floor(Math.random() * delta);
}

function scheduleNextVisitorCheck() {
  if (visitorTimer) clearTimeout(visitorTimer);
  visitorTimer = setTimeout(() => {
    triggerVisitor(false).catch((error) => {
      console.error('Visitor check failed:', error);
    }).finally(() => {
      scheduleNextVisitorCheck();
    });
  }, randomVisitorDelay());
}

function buildVisitorPayload(visitor, activeAvatar) {
  const opener = activeAvatar ? `${activeAvatar.name}，我来串门啦。` : '我来看看你今天过得怎么样。';
  const visitorLine = pickRandom([
    `${opener}别太绷着，记得呼吸一下。`,
    `${opener}看到你还在努力，我也想给你打个气。`,
    `${opener}今天也要温柔地推进一点点。`
  ]);
  return {
    avatar: {
      id: visitor.id,
      name: visitor.name,
      imageUrl: visitor.imageUrl || '',
      mood: visitor.mood,
      style: visitor.style
    },
    bubble: visitorLine,
    durationMs: 12000
  };
}

async function triggerVisitor(manual = false) {
  state = normalizeState(state);
  const candidates = state.avatars.filter((avatar) => avatar.id !== state.activeAvatarId);
  if (candidates.length === 0) {
    return { ok: false, message: '至少需要保存两个角色，访客系统才会出现。' };
  }

  const visitor = pickRandom(candidates);
  const activeAvatar = getActiveAvatar(state);
  const payload = buildVisitorPayload(visitor, activeAvatar);
  state.lastVisitorAt = Date.now();
  saveState();

  if (manual && petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
  }

  sendToWindow(petWindow, 'show-visitor', payload);
  playSound('visitor');
  return { ok: true, message: '访客已出现。' };
}

function makeBlockedPageUrl(blockedUrl) {
  const html = `<!doctype html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>已阻止访问</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: radial-gradient(circle at top, #1e293b 0%, #0f172a 55%, #020617 100%);
        color: #e2e8f0;
      }
      .card {
        width: min(560px, calc(100vw - 48px));
        background: rgba(15, 23, 42, 0.82);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 20px 45px rgba(2, 6, 23, 0.45);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(248, 113, 113, 0.15);
        color: #fecaca;
        font-size: 13px;
        margin-bottom: 14px;
      }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 0 0 12px; line-height: 1.65; color: #cbd5e1; }
      code {
        display: block;
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(30, 41, 59, 0.88);
        color: #f8fafc;
        word-break: break-all;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">🛡️ 专注模式已拦截该网站</div>
      <h1>现在先把注意力留给你真正想完成的事。</h1>
      <p>你正在进行专注任务：<strong>${escapeHtml(state.focus.focusTask || '当前专注')}</strong>。</p>
      <p>当本轮专注结束或暂停后，这个网站就会恢复访问。</p>
      <code>${escapeHtml(blockedUrl)}</code>
    </div>
  </body>
  </html>`;
  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shouldBlockRequest(requestUrl) {
  if (!isFocusBlockingActive(state) || !state.blockedSites.length) return false;

  try {
    const parsed = new URL(requestUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return hostMatchesBlocked(parsed.hostname, state.blockedSites);
  } catch {
    return false;
  }
}

function setupRequestBlocking() {
  const defaultSession = session.defaultSession;
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      if (!shouldBlockRequest(details.url)) {
        callback({});
        return;
      }

      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
        callback({ redirectURL: makeBlockedPageUrl(details.url) });
        return;
      }

      callback({ cancel: true });
    } catch (error) {
      console.error('Failed to process web request blocker:', error);
      callback({});
    }
  });
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = clamp(options.timeoutMs, 3000, 120000, state.settings.requestTimeoutMs || 25000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal
    });

    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = rawText;
    }

    if (!response.ok) {
      const message = typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object'
          ? payload.error?.message || payload.message || JSON.stringify(payload)
          : `请求失败：${response.status}`;
      throw new Error(message || `请求失败：${response.status}`);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function getMergedSettings(overrides = {}) {
  return normalizeState({
    ...state,
    settings: {
      ...state.settings,
      ...overrides
    }
  }).settings;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') return part.text || part.content || '';
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function extractReplyText(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();

  const direct = [
    payload.reply,
    payload.message,
    payload.text,
    payload.output_text,
    payload.result,
    payload.output && payload.output.text
  ];

  for (const item of direct) {
    const text = extractTextFromContent(item);
    if (text) return text;
  }

  const choiceText = extractTextFromContent(payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content);
  if (choiceText) return choiceText;

  const deltaText = extractTextFromContent(payload.choices && payload.choices[0] && payload.choices[0].delta && payload.choices[0].delta.content);
  if (deltaText) return deltaText;

  return '';
}

async function requestProviderReply(settings, messages) {
  if (!settings.useLLMChat) {
    throw new Error('聊天增强开关尚未开启。');
  }

  if (!settings.apiKey) {
    throw new Error('请先填写聊天 API Key。');
  }

  if (settings.aiProvider === 'openai') {
    const payload = await requestJson('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      timeoutMs: settings.requestTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.openaiModel || 'gpt-4o-mini',
        messages,
        temperature: 0.8
      })
    });

    const reply = extractReplyText(payload);
    if (!reply) throw new Error('聊天接口返回成功，但没有可用回复。');
    return reply;
  }

  if (settings.aiProvider === 'zhipu') {
    const payload = await requestJson('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      timeoutMs: settings.requestTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.zhipuModel || 'glm-5-turbo',
        messages,
        stream: false,
        temperature: 0.8
      })
    });

    const reply = extractReplyText(payload);
    if (!reply) throw new Error('智谱接口返回成功，但没有可用回复。');
    return reply;
  }

  if (!settings.customApiUrl) {
    throw new Error('请先填写自定义聊天接口地址。');
  }

  const payload = await requestJson(settings.customApiUrl, {
    method: 'POST',
    timeoutMs: settings.requestTimeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.openaiModel || settings.zhipuModel || 'custom-model',
      messages
    })
  });

  const reply = extractReplyText(payload);
  if (!reply) throw new Error('自定义接口返回成功，但没有可用回复。');
  return reply;
}

function getMockReply(message, avatar) {
  const lower = String(message || '').toLowerCase();
  if (/(累|困|烦|撑不住|tired|exhausted)/i.test(lower)) {
    return `我在这儿。${avatar?.name || '小光'}建议你先停 30 秒，喝口水，然后只做下一步。`;
  }
  if (/(专注|focus|开始)/i.test(lower)) {
    return `好，我们先把目标缩小一点：只做 5 分钟也算开始。${avatar?.name || '小光'}会陪你把这段时间守住。`;
  }
  if (/(谢谢|thank)/i.test(lower)) {
    return '不用客气，我本来就是来陪你的。你愿意继续前进一点点，就已经很棒了。';
  }
  const candidates = [
    `我在这里陪着你，别急，我们先做眼前这一小步。`,
    `你已经开始努力了，现在最重要的是别把自己逼得太紧。`,
    `把注意力放回你最重要的那件事上，我会一直在。`
  ];
  return pickRandom(candidates);
}

function normalizeChatHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const role = item.role === 'user' ? 'user' : item.role === 'assistant' ? 'assistant' : item.role === 'avatar' ? 'assistant' : 'user';
      const content = String(item.text || item.content || '').trim();
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean)
    .slice(-14);
}

async function fetchWeatherSummary(settingsOverrides = {}) {
  const settings = getMergedSettings(settingsOverrides);
  const city = String(settings.weatherCity || '').trim();
  const apiKey = String(settings.weatherApiKey || '').trim();

  if (!city) {
    throw new Error('请先填写天气城市。');
  }
  if (!apiKey) {
    throw new Error('请先填写天气 API Key。');
  }

  const cacheKey = city.toLowerCase();
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < WEATHER_CACHE_MS) {
    return cached.payload;
  }

  const url = new URL('https://api.openweathermap.org/data/2.5/weather');
  url.searchParams.set('q', city);
  url.searchParams.set('appid', apiKey);
  url.searchParams.set('units', 'metric');
  url.searchParams.set('lang', 'zh_cn');

  const payload = await requestJson(url.toString(), { timeoutMs: settings.requestTimeoutMs });
  const weather = {
    city: payload && payload.name ? payload.name : city,
    temp: payload && payload.main ? Number(payload.main.temp) : null,
    feelsLike: payload && payload.main ? Number(payload.main.feels_like) : null,
    humidity: payload && payload.main ? Number(payload.main.humidity) : null,
    windSpeed: payload && payload.wind ? Number(payload.wind.speed) : null,
    description: payload && Array.isArray(payload.weather) && payload.weather[0] ? payload.weather[0].description : '天气未知',
    observationTime: payload && Number.isFinite(payload.dt) ? payload.dt * 1000 : Date.now()
  };

  const response = {
    weather,
    summary: buildWeatherSummary(weather)
  };
  weatherCache.set(cacheKey, { timestamp: Date.now(), payload: response });
  return response;
}

function buildMockAvatarSvg(payload) {
  const name = escapeHtml(payload.name || '新角色');
  const mood = escapeHtml(payload.mood || 'happy');
  const style = escapeHtml(payload.style || 'cute');
  const seedText = escapeHtml(payload.prompt || '温柔陪伴');
  const imageMarkup = payload.image
    ? `<defs><clipPath id="avatarClip"><circle cx="256" cy="210" r="108" /></clipPath></defs>
       <circle cx="256" cy="210" r="110" fill="#ffffff" />
       <image href="${payload.image}" x="128" y="82" width="256" height="256" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />`
    : `<circle cx="256" cy="206" r="110" fill="#ffffff" />
       <circle cx="222" cy="192" r="14" fill="#1f2937" />
       <circle cx="290" cy="192" r="14" fill="#1f2937" />
       <path d="M216 248 Q256 280 296 248" stroke="#1f2937" stroke-width="12" fill="none" stroke-linecap="round" />`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#fff6fb" offset="0%" />
          <stop stop-color="#ffd0e0" offset="45%" />
          <stop stop-color="#c3dcff" offset="100%" />
        </linearGradient>
        <linearGradient id="panel" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#ffffff" offset="0%" />
          <stop stop-color="#eef2ff" offset="100%" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="40" fill="url(#bg)" />
      <circle cx="382" cy="116" r="48" fill="#ffffff" opacity="0.45" />
      <circle cx="118" cy="134" r="64" fill="#ffffff" opacity="0.32" />
      <rect x="76" y="70" width="360" height="372" rx="46" fill="url(#panel)" opacity="0.96" />
      ${imageMarkup}
      <rect x="132" y="344" width="248" height="56" rx="28" fill="#ffffff" opacity="0.92" />
      <text x="256" y="380" text-anchor="middle" font-size="30" font-family="Arial, sans-serif" fill="#334155">${name}</text>
      <text x="256" y="425" text-anchor="middle" font-size="18" font-family="Arial, sans-serif" fill="#64748b">${style} · ${mood}</text>
      <text x="256" y="462" text-anchor="middle" font-size="14" font-family="Arial, sans-serif" fill="#94a3b8">${seedText.slice(0, 30)}</text>
    </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function normalizeGeneratedImage(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload.imageUrl === 'string') return payload.imageUrl;
  if (typeof payload.image_url === 'string') return payload.image_url;
  if (typeof payload.url === 'string') return payload.url;

  const item = Array.isArray(payload.data) ? payload.data[0] : null;
  if (item && typeof item.url === 'string') return item.url;
  if (item && typeof item.b64_json === 'string') return `data:image/png;base64,${item.b64_json}`;

  if (typeof payload.b64_json === 'string') return `data:image/png;base64,${payload.b64_json}`;
  return '';
}

function normalizePreviewUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('请输入要验证的网址。');
  }

  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('只支持 http 或 https 链接。');
  }
  return parsed.toString();
}

app.whenReady().then(() => {
  createPetWindow();
  createControlWindow();
  refreshTrayMenu = createTray();
  setupRequestBlocking();
  startTicker();
  scheduleNextVisitorCheck();
  broadcastState();
  if (petWindow) petWindow.show();

  app.on('activate', () => {
    if (!petWindow || petWindow.isDestroyed()) createPetWindow();
    if (!controlWindow || controlWindow.isDestroyed()) createControlWindow();
    if (petWindow) petWindow.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (visitorTimer) clearTimeout(visitorTimer);
  if (tickerHandle) clearInterval(tickerHandle);
});

app.on('window-all-closed', () => {
  // 保持应用在托盘中运行
});

ipcMain.handle('get-state', async () => getStatePayload());

ipcMain.handle('show-control-window', async () => {
  showControlWindow();
  return true;
});

ipcMain.handle('save-state', async (event, patch = {}) => {
  const result = applyStatePatch(patch);
  if (result.completedDiff > 0) {
    playSound('task-done', event.sender);
  }
  return { ok: true, payload: getStatePayload() };
});

ipcMain.handle('update-focus', async (_event, focusPatch = {}) => {
  const focus = updateFocusState(focusPatch);
  return { ok: true, focus };
});

ipcMain.handle('generate-avatar', async (_event, payload = {}) => {
  const settings = getMergedSettings();
  if (!settings.imageApiUrl) {
    return { imageUrl: buildMockAvatarSvg(payload), mock: true };
  }

  const response = await requestJson(settings.imageApiUrl, {
    method: 'POST',
    timeoutMs: settings.requestTimeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(settings.imageApiKey ? { Authorization: `Bearer ${settings.imageApiKey}` } : {})
    },
    body: JSON.stringify(payload)
  });

  const imageUrl = normalizeGeneratedImage(response);
  if (!imageUrl) {
    throw new Error('图片接口已返回结果，但没有找到可用图片地址。');
  }
  return { imageUrl };
});

ipcMain.handle('chat-avatar', async (_event, payload = {}) => {
  const happinessLevel = state.happiness > 70 ? '很开心' : state.happiness > 30 ? '平静' : '有点失落';
  const focusState = isFocusBlockingActive(state)
    ? `用户正在专注于“${state.focus.focusTask}”`
    : '用户当前没有进行专注';
  const avatarName = payload.avatar && payload.avatar.name ? payload.avatar.name : '小光';

  if (isWeatherQuery(payload.message || '')) {
    const weatherResult = await fetchWeatherSummary();
    return {
      reply: `${avatarName}帮你看了一下：${weatherResult.summary}`,
      weather: weatherResult.weather,
      via: 'weather'
    };
  }

  const settings = getMergedSettings();
  if (!settings.useLLMChat || (!settings.apiKey && settings.aiProvider !== 'custom') || (settings.aiProvider === 'custom' && !settings.customApiUrl)) {
    return { reply: getMockReply(payload.message, payload.avatar), mock: true };
  }

  const messages = [
    {
      role: 'system',
      content: `你现在是一个叫 ${avatarName} 的虚拟陪伴人物，语气温柔、有陪伴感，擅长鼓励、专注提醒、任务推进。\n当前状态：\n- 宠物心情：${happinessLevel}（快乐度 ${state.happiness}/100）\n- 用户状态：${focusState}\n- 请尽量回答自然、具体，不要空泛。`
    },
    ...normalizeChatHistory(payload.history)
  ];

  if (!messages.some((message) => message.role === 'user' && message.content === payload.message)) {
    messages.push({ role: 'user', content: String(payload.message || '').trim() });
  }

  const reply = await requestProviderReply(settings, messages);
  return { reply };
});

ipcMain.handle('test-llm-connection', async (_event, settingsOverrides = {}) => {
  const settings = getMergedSettings(settingsOverrides);
  const reply = await requestProviderReply(settings, [
    { role: 'system', content: '你是一个测试助手。请简短回复。' },
    { role: 'user', content: '请只回复“连接成功”，如果支持中文就保持中文。' }
  ]);

  return { ok: true, reply };
});

ipcMain.handle('get-weather-now', async (_event, settingsOverrides = {}) => {
  const result = await fetchWeatherSummary(settingsOverrides);
  return { ok: true, ...result };
});

ipcMain.handle('open-preview-url', async (_event, inputUrl) => {
  const previewUrl = normalizePreviewUrl(inputUrl);
  createPreviewWindow(previewUrl);
  return { ok: true, url: previewUrl };
});

ipcMain.handle('trigger-visitor', async () => triggerVisitor(true));

ipcMain.handle('select-image', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).slice(1) || 'png';
  const base64 = fs.readFileSync(filePath).toString('base64');
  return {
    filePath,
    dataUrl: `data:image/${extension};base64,${base64}`
  };
});

ipcMain.on('play-sound', (event, soundId) => {
  playSound(soundId, event.sender);
});

ipcMain.on('start-drag', (event, payload = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const [startWindowX, startWindowY] = win.getPosition();
  dragSessions.set(event.sender.id, {
    win,
    startWindowX,
    startWindowY,
    startScreenX: Number(payload.screenX) || 0,
    startScreenY: Number(payload.screenY) || 0
  });
});

ipcMain.on('dragging', (event, payload = {}) => {
  const drag = dragSessions.get(event.sender.id);
  if (!drag || !drag.win || drag.win.isDestroyed()) return;

  const deltaX = Math.round((Number(payload.screenX) || 0) - drag.startScreenX);
  const deltaY = Math.round((Number(payload.screenY) || 0) - drag.startScreenY);
  const nextBounds = constrainPetBounds({
    x: drag.startWindowX + deltaX,
    y: drag.startWindowY + deltaY,
    width: state.petBounds.width,
    height: state.petBounds.height
  });
  drag.win.setPosition(nextBounds.x, nextBounds.y);
  state.petBounds = nextBounds;
});

ipcMain.on('end-drag', (event) => {
  dragSessions.delete(event.sender.id);
  saveState();
  broadcastState();
});
