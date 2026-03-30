const APP_TITLE = '虚拟陪伴桌宠';

const DEFAULT_STATE = {
  settings: {
    alwaysOnTop: true,
    useLLMChat: false,
    aiProvider: 'custom',
    apiKey: '',
    openaiModel: 'gpt-4o-mini',
    zhipuModel: 'glm-5-turbo',
    customApiUrl: '',
    imageApiUrl: '',
    imageApiKey: '',
    weatherCity: '',
    weatherApiKey: '',
    requestTimeoutMs: 25000
  },
  petBounds: { width: 240, height: 240, x: 40, y: 40 },
  focus: {
    isRunning: false,
    isPaused: false,
    mode: 'focus',
    focusMinutes: 25,
    breakMinutes: 5,
    focusTask: '开始今天最重要的一件事',
    startedAt: null,
    pausedAt: null,
    remainingSeconds: 25 * 60,
    completedSessions: 0
  },
  plans: [
    { id: 1, text: '完成一个重要任务', done: false },
    { id: 2, text: '专注 25 分钟', done: false }
  ],
  avatars: [],
  activeAvatarId: null,
  happiness: 70,
  lastInteractionTime: Date.now(),
  focusCoins: 0,
  unlockedThemes: ['default'],
  activeTheme: 'default',
  blockedSites: [],
  lastVisitorAt: 0
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeDomain(input) {
  if (typeof input !== 'string') return '';
  let value = input.trim().toLowerCase();
  if (!value) return '';

  try {
    if (!/^[a-z]+:\/\//i.test(value)) {
      value = `https://${value}`;
    }
    const url = new URL(value);
    let host = url.hostname.trim().toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    value = value
      .replace(/^[a-z]+:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .trim();
    if (value.startsWith('www.')) value = value.slice(4);
    return value;
  }
}

function normalizeBlockedSites(blockedSites) {
  if (!Array.isArray(blockedSites)) return [];
  return unique(blockedSites.map(normalizeDomain).filter(Boolean));
}

function normalizePlans(plans, fallbackPlans) {
  const basePlans = Array.isArray(plans) ? plans : fallbackPlans;
  const normalized = [];
  const seen = new Set();

  basePlans.forEach((plan, index) => {
    if (!plan || typeof plan !== 'object') return;
    const text = String(plan.text || '').trim();
    if (!text) return;
    let id = Number(plan.id);
    if (!Number.isFinite(id) || seen.has(id)) {
      id = Date.now() + index + seen.size;
    }
    seen.add(id);
    normalized.push({ id, text, done: !!plan.done });
  });

  if (normalized.length) return normalized;
  return cloneDefaultState().plans;
}

function normalizeAvatar(avatar, index = 0) {
  if (!avatar || typeof avatar !== 'object') return null;
  const id = avatar.id ?? `avatar-${Date.now()}-${index}`;
  const name = String(avatar.name || `角色 ${index + 1}`).trim() || `角色 ${index + 1}`;
  const style = ['cute', 'anime', 'pixel', 'scifi'].includes(avatar.style) ? avatar.style : 'cute';
  const mood = ['happy', 'cool', 'sleepy', 'excited'].includes(avatar.mood) ? avatar.mood : 'happy';
  const energy = clamp(avatar.energy, 0, 100, 70);
  const prompt = String(avatar.prompt || '').trim();
  const messages = Array.isArray(avatar.messages)
    ? avatar.messages
        .map((message) => {
          if (!message || typeof message !== 'object') return null;
          const role = message.role === 'user' ? 'user' : 'avatar';
          const text = String(message.text || '').trim();
          if (!text) return null;
          return { role, text };
        })
        .filter(Boolean)
    : [];

  return {
    id,
    name,
    originalImage: typeof avatar.originalImage === 'string' ? avatar.originalImage : '',
    imageUrl: typeof avatar.imageUrl === 'string' ? avatar.imageUrl : '',
    style,
    mood,
    energy,
    prompt,
    messages: messages.length ? messages : [{ role: 'avatar', text: `你好呀，我是 ${name}。` }],
    createdAt: avatar.createdAt || new Date().toISOString()
  };
}

function normalizeState(rawState) {
  const base = cloneDefaultState();
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  const settingsSource = source.settings && typeof source.settings === 'object' ? { ...source.settings } : {};

  if (!settingsSource.customApiUrl && settingsSource.llmApiUrl) {
    settingsSource.customApiUrl = settingsSource.llmApiUrl;
  }
  if (!settingsSource.apiKey && settingsSource.llmApiKey) {
    settingsSource.apiKey = settingsSource.llmApiKey;
  }
  if (!settingsSource.imageApiUrl && typeof source.imageApiUrl === 'string') {
    settingsSource.imageApiUrl = source.imageApiUrl;
  }
  if (!settingsSource.imageApiKey && typeof source.imageApiKey === 'string') {
    settingsSource.imageApiKey = source.imageApiKey;
  }
  if (!settingsSource.weatherCity && typeof source.weatherCity === 'string') {
    settingsSource.weatherCity = source.weatherCity;
  }
  if (!settingsSource.weatherApiKey && typeof source.weatherApiKey === 'string') {
    settingsSource.weatherApiKey = source.weatherApiKey;
  }

  const focusSource = source.focus && typeof source.focus === 'object' ? source.focus : {};
  const avatars = Array.isArray(source.avatars)
    ? source.avatars.map((avatar, index) => normalizeAvatar(avatar, index)).filter(Boolean)
    : [];

  let activeAvatarId = source.activeAvatarId ?? null;
  if (activeAvatarId != null && !avatars.some((avatar) => avatar.id === activeAvatarId)) {
    activeAvatarId = avatars[0] ? avatars[0].id : null;
  }

  const normalized = {
    ...base,
    ...source,
    settings: {
      ...base.settings,
      ...settingsSource,
      alwaysOnTop: settingsSource.alwaysOnTop === undefined ? base.settings.alwaysOnTop : !!settingsSource.alwaysOnTop,
      useLLMChat: settingsSource.useLLMChat === undefined ? base.settings.useLLMChat : !!settingsSource.useLLMChat,
      aiProvider: ['openai', 'zhipu', 'custom'].includes(settingsSource.aiProvider) ? settingsSource.aiProvider : base.settings.aiProvider,
      apiKey: String(settingsSource.apiKey || '').trim(),
      openaiModel: String(settingsSource.openaiModel || base.settings.openaiModel).trim() || base.settings.openaiModel,
      zhipuModel: String(settingsSource.zhipuModel || base.settings.zhipuModel).trim() || base.settings.zhipuModel,
      customApiUrl: String(settingsSource.customApiUrl || '').trim(),
      imageApiUrl: String(settingsSource.imageApiUrl || '').trim(),
      imageApiKey: String(settingsSource.imageApiKey || '').trim(),
      weatherCity: String(settingsSource.weatherCity || '').trim(),
      weatherApiKey: String(settingsSource.weatherApiKey || '').trim(),
      requestTimeoutMs: clamp(settingsSource.requestTimeoutMs, 3000, 120000, base.settings.requestTimeoutMs)
    },
    petBounds: {
      width: clamp(source.petBounds && source.petBounds.width, 180, 420, base.petBounds.width),
      height: clamp(source.petBounds && source.petBounds.height, 180, 420, base.petBounds.height),
      x: Number.isFinite(source.petBounds && source.petBounds.x) ? Math.round(source.petBounds.x) : base.petBounds.x,
      y: Number.isFinite(source.petBounds && source.petBounds.y) ? Math.round(source.petBounds.y) : base.petBounds.y
    },
    focus: {
      ...base.focus,
      ...focusSource,
      isRunning: !!focusSource.isRunning,
      isPaused: !!focusSource.isPaused,
      mode: ['focus', 'break'].includes(focusSource.mode) ? focusSource.mode : base.focus.mode,
      focusMinutes: clamp(focusSource.focusMinutes, 5, 180, base.focus.focusMinutes),
      breakMinutes: clamp(focusSource.breakMinutes, 1, 60, base.focus.breakMinutes),
      focusTask: String(focusSource.focusTask || base.focus.focusTask).trim() || base.focus.focusTask,
      startedAt: Number.isFinite(focusSource.startedAt) ? focusSource.startedAt : null,
      pausedAt: Number.isFinite(focusSource.pausedAt) ? focusSource.pausedAt : null,
      remainingSeconds: Math.max(0, Math.round(Number(focusSource.remainingSeconds ?? base.focus.remainingSeconds) || 0)),
      completedSessions: Math.max(0, Math.round(Number(focusSource.completedSessions ?? base.focus.completedSessions) || 0))
    },
    plans: normalizePlans(source.plans, base.plans),
    avatars,
    activeAvatarId,
    happiness: clamp(source.happiness, 0, 100, base.happiness),
    lastInteractionTime: Number.isFinite(source.lastInteractionTime) ? source.lastInteractionTime : Date.now(),
    focusCoins: Math.max(0, Math.floor(Number(source.focusCoins ?? base.focusCoins) || 0)),
    unlockedThemes: unique(['default', ...((Array.isArray(source.unlockedThemes) ? source.unlockedThemes : []).filter(Boolean))]),
    activeTheme: String(source.activeTheme || base.activeTheme).trim() || base.activeTheme,
    blockedSites: normalizeBlockedSites(source.blockedSites),
    lastVisitorAt: Number.isFinite(source.lastVisitorAt) ? source.lastVisitorAt : 0
  };

  if (!normalized.unlockedThemes.includes(normalized.activeTheme)) {
    normalized.activeTheme = 'default';
  }

  if (!normalized.focus.isRunning) {
    normalized.focus.isPaused = false;
    normalized.focus.startedAt = null;
  }
  if (normalized.focus.isPaused) {
    normalized.focus.startedAt = null;
  }
  if (!normalized.focus.remainingSeconds) {
    normalized.focus.remainingSeconds = (normalized.focus.mode === 'focus'
      ? normalized.focus.focusMinutes
      : normalized.focus.breakMinutes) * 60;
  }

  if (!normalized.activeAvatarId && normalized.avatars.length) {
    normalized.activeAvatarId = normalized.avatars[0].id;
  }

  return normalized;
}

function getFocusSnapshot(currentState) {
  const normalized = normalizeState(currentState);
  const focus = { ...normalized.focus };
  if (focus.isRunning && !focus.isPaused && focus.startedAt) {
    const elapsedSeconds = Math.floor((Date.now() - focus.startedAt) / 1000);
    focus.currentRemainingSeconds = Math.max(0, focus.remainingSeconds - elapsedSeconds);
  } else {
    focus.currentRemainingSeconds = focus.remainingSeconds;
  }
  return focus;
}

function isFocusBlockingActive(currentState) {
  const focus = getFocusSnapshot(currentState);
  return !!(focus.isRunning && !focus.isPaused && focus.mode === 'focus');
}

function hostMatchesBlocked(hostname, blockedSites) {
  if (!hostname || !Array.isArray(blockedSites) || !blockedSites.length) return false;
  const normalizedHost = normalizeDomain(hostname);
  return blockedSites.some((blocked) => normalizedHost === blocked || normalizedHost.endsWith(`.${blocked}`));
}

function isWeatherQuery(text) {
  if (typeof text !== 'string') return false;
  return /(天气|气温|温度|下雨|晴天|forecast|weather|rain|temperature)/i.test(text);
}

function buildWeatherSummary(weather) {
  if (!weather || typeof weather !== 'object') return '暂时没有可用的天气数据。';
  const city = weather.city || '当前城市';
  const description = weather.description || '天气状况未知';
  const temp = Number.isFinite(weather.temp) ? `${Math.round(weather.temp)}°C` : '未知温度';
  const feelsLike = Number.isFinite(weather.feelsLike) ? `${Math.round(weather.feelsLike)}°C` : '未知';
  const humidity = Number.isFinite(weather.humidity) ? `${Math.round(weather.humidity)}%` : '未知';
  const windSpeed = Number.isFinite(weather.windSpeed) ? `${weather.windSpeed.toFixed(1)} m/s` : '未知';

  let comfortLine = '今天也要照顾好自己。';
  if (Number.isFinite(weather.temp)) {
    if (weather.temp >= 30) comfortLine = '外面偏热，记得补水，出门尽量避开正午暴晒。';
    else if (weather.temp <= 8) comfortLine = '气温偏低，出门加一层外套会更舒服。';
    else if (/雨|雷|storm|drizzle|snow/i.test(description)) comfortLine = '如果要出门，带把伞会更稳妥。';
    else if (/晴|clear/i.test(description)) comfortLine = '天气看起来不错，适合短暂走动放松一下。';
  }

  return `${city}现在${description}，气温 ${temp}，体感 ${feelsLike}，湿度 ${humidity}，风速 ${windSpeed}。${comfortLine}`;
}

function pickRandom(items) {
  if (!Array.isArray(items) || !items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

module.exports = {
  APP_TITLE,
  DEFAULT_STATE,
  clamp,
  normalizeDomain,
  normalizeBlockedSites,
  normalizeState,
  getFocusSnapshot,
  isFocusBlockingActive,
  hostMatchesBlocked,
  isWeatherQuery,
  buildWeatherSummary,
  pickRandom,
  cloneDefaultState
};
