const $ = (id) => document.getElementById(id);
const CONFIG = window.DESKTOP_PET_RENDERER_CONFIG;
const STYLE_LABELS = CONFIG.styles;
const MOOD_LABELS = CONFIG.moods;
const THEME_PRESETS = CONFIG.themes;

let appState = null;
let activeAvatar = null;
let uploadedImage = '';
let fallbackMessages = [{ role: 'avatar', text: '你好呀，我会在这里陪着你。' }];
let weatherPreview = null;
let lastAvatarHydrationKey = '';
let lastSettingsHydrationKey = '';
let lastFocusHydrationKey = '';

function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(Math.floor(totalSeconds % 60)).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function showToast(message, type = 'info') {
  const zone = $('toastZone');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  zone.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

async function withBusy(button, busyText, action) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function patchLocalState(partial) {
  appState = { ...appState, ...partial };
}

function isEditing(element) {
  return document.activeElement === element;
}

function setValueIfIdle(element, value) {
  if (!element || isEditing(element)) return;
  element.value = value ?? '';
}

function setCheckedIfIdle(element, value) {
  if (!element || isEditing(element)) return;
  element.checked = !!value;
}

function buildPrompt() {
  const name = $('avatarName').value.trim() || '未命名角色';
  const style = STYLE_LABELS[$('avatarStyle').value] || 'Q版可爱';
  const mood = MOOD_LABELS[$('avatarMood').value] || '开心';
  const energy = Number($('avatarEnergy').value || 70);
  return `请把用户角色整理成适合桌面陪伴的小伙伴。名字是 ${name}，风格是 ${style}，情绪是 ${mood}，活力值 ${energy}/100。整体感觉要温柔、亲近、适合长期陪伴。`;
}

function getCurrentPreviewImage() {
  const generatedImg = $('generatedPreview').querySelector('img');
  if (generatedImg) return generatedImg.src;
  if (activeAvatar && activeAvatar.imageUrl) return activeAvatar.imageUrl;
  return uploadedImage || '';
}

function buildAvatarDraft() {
  return {
    id: activeAvatar ? activeAvatar.id : Date.now(),
    name: $('avatarName').value.trim() || `角色 ${(appState?.avatars?.length || 0) + 1}`,
    originalImage: uploadedImage || (activeAvatar && activeAvatar.originalImage) || '',
    imageUrl: getCurrentPreviewImage(),
    style: $('avatarStyle').value,
    mood: $('avatarMood').value,
    energy: Number($('avatarEnergy').value || 70),
    prompt: $('editablePrompt').value.trim() || buildPrompt(),
    messages: activeAvatar?.messages?.length
      ? activeAvatar.messages
      : [{ role: 'avatar', text: `你好呀，我是 ${$('avatarName').value.trim() || '新朋友'}，以后我会陪着你。` }],
    createdAt: activeAvatar?.createdAt || new Date().toISOString()
  };
}

function getFallbackAvatar() {
  return activeAvatar || {
    id: 'default',
    name: $('avatarName').value.trim() || '小光',
    style: $('avatarStyle').value || 'cute',
    mood: $('avatarMood').value || 'happy',
    energy: Number($('avatarEnergy').value || 70),
    prompt: $('editablePrompt').value.trim() || buildPrompt(),
    messages: fallbackMessages
  };
}

function collectSettings(overrides = {}) {
  return {
    ...appState.settings,
    aiProvider: $('aiProviderSelect').value,
    apiKey: $('apiKeyInput').value.trim(),
    openaiModel: $('openaiModelSelect').value,
    zhipuModel: $('zhipuModelSelect').value,
    customApiUrl: $('customApiUrlInput').value.trim(),
    imageApiUrl: $('imageApiUrlInput').value.trim(),
    imageApiKey: $('imageApiKeyInput').value.trim(),
    weatherCity: $('weatherCityInput').value.trim(),
    weatherApiKey: $('weatherApiKeyInput').value.trim(),
    alwaysOnTop: $('alwaysOnTopToggle').checked,
    useLLMChat: appState.settings.useLLMChat,
    ...overrides
  };
}

function syncProviderBlocks() {
  const provider = $('aiProviderSelect').value;
  $('openaiSettingsBlock').classList.toggle('hidden', provider !== 'openai');
  $('zhipuSettingsBlock').classList.toggle('hidden', provider !== 'zhipu');
  $('customSettingsBlock').classList.toggle('hidden', provider !== 'custom');
}

function applyControlTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('desktop-pet-control-theme', theme);
  $('themeToggleBtn').textContent = theme === 'dark' ? '切换明亮模式' : '切换暗黑模式';
}

function renderHeader() {
  const focus = appState.focus;
  const currentRoleName = activeAvatar ? activeAvatar.name : '默认陪伴';
  const statusText = !focus.isRunning
    ? '未开始专注'
    : focus.isPaused
      ? `专注已暂停 · ${formatTime(focus.currentRemainingSeconds || focus.remainingSeconds || 0)}`
      : `${focus.mode === 'focus' ? '专注进行中' : '休息中'} · ${formatTime(focus.currentRemainingSeconds || focus.remainingSeconds || 0)}`;
  $('headerFocusStatus').textContent = statusText;
  $('headerRoleStatus').textContent = `当前角色：${currentRoleName}`;
}

function hydrateAvatarFieldsIfNeeded() {
  const draftKey = JSON.stringify({
    activeAvatarId: appState.activeAvatarId,
    avatarCount: appState.avatars.length,
    activeImage: activeAvatar?.imageUrl || '',
    activeName: activeAvatar?.name || ''
  });

  if (draftKey === lastAvatarHydrationKey) return;
  lastAvatarHydrationKey = draftKey;

  const source = activeAvatar || {
    name: '',
    style: 'cute',
    mood: 'happy',
    energy: 70,
    prompt: buildPrompt(),
    imageUrl: ''
  };

  setValueIfIdle($('avatarName'), source.name || '');
  setValueIfIdle($('avatarStyle'), source.style || 'cute');
  setValueIfIdle($('avatarMood'), source.mood || 'happy');
  setValueIfIdle($('avatarEnergy'), source.energy ?? 70);
  setValueIfIdle($('editablePrompt'), source.prompt || buildPrompt());

  if (source.imageUrl) {
    $('generatedPreview').innerHTML = `<img src="${source.imageUrl}" alt="generated avatar" />`;
  } else if (!getCurrentPreviewImage()) {
    $('generatedPreview').innerHTML = '<div class="preview-fallback">点击生成角色后会在这里显示</div>';
  }
}

function hydrateSettingsFieldsIfNeeded() {
  const settingsKey = JSON.stringify(appState.settings);
  if (settingsKey === lastSettingsHydrationKey) return;
  lastSettingsHydrationKey = settingsKey;

  setValueIfIdle($('aiProviderSelect'), appState.settings.aiProvider || 'custom');
  syncProviderBlocks();
  setValueIfIdle($('apiKeyInput'), appState.settings.apiKey || '');
  setValueIfIdle($('openaiModelSelect'), appState.settings.openaiModel || 'gpt-4o-mini');
  setValueIfIdle($('zhipuModelSelect'), appState.settings.zhipuModel || 'glm-5-turbo');
  setValueIfIdle($('customApiUrlInput'), appState.settings.customApiUrl || '');
  setValueIfIdle($('imageApiUrlInput'), appState.settings.imageApiUrl || '');
  setValueIfIdle($('imageApiKeyInput'), appState.settings.imageApiKey || '');
  setValueIfIdle($('weatherCityInput'), appState.settings.weatherCity || '');
  setValueIfIdle($('weatherApiKeyInput'), appState.settings.weatherApiKey || '');
  setCheckedIfIdle($('alwaysOnTopToggle'), appState.settings.alwaysOnTop);
  $('toggleLLMBtn').textContent = appState.settings.useLLMChat ? '已开启' : '已关闭';
}

function hydrateFocusFieldsIfNeeded() {
  const focusKey = JSON.stringify({
    task: appState.focus.focusTask,
    focusMinutes: appState.focus.focusMinutes,
    breakMinutes: appState.focus.breakMinutes
  });
  if (focusKey === lastFocusHydrationKey) return;
  lastFocusHydrationKey = focusKey;
  setValueIfIdle($('focusTaskInput'), appState.focus.focusTask || '');
  setValueIfIdle($('focusMinutesInput'), appState.focus.focusMinutes || 25);
  setValueIfIdle($('breakMinutesInput'), appState.focus.breakMinutes || 5);
}

function renderPreviewMeta() {
  $('styleBadge').textContent = STYLE_LABELS[$('avatarStyle').value] || 'Q版可爱';
}

function renderFocus() {
  const focus = appState.focus;
  $('focusModeLabel').textContent = focus.mode === 'focus' ? (focus.isRunning ? '专注中' : '准备开始') : '休息中';
  $('focusTimer').textContent = formatTime(focus.currentRemainingSeconds || focus.remainingSeconds || 0);
  $('completedSessions').textContent = String(focus.completedSessions || 0);
  $('focusTaskText').textContent = focus.focusTask || '开始今天最重要的一件事';

  if (!focus.isRunning) $('focusPrimaryBtn').textContent = '开始专注';
  else if (focus.isPaused) $('focusPrimaryBtn').textContent = '继续';
  else $('focusPrimaryBtn').textContent = '暂停';

  const blockedCount = appState.blockedSites.length;
  $('focusBlockHint').textContent = blockedCount ? `已配置 ${blockedCount} 个域名，专注时自动拦截` : '专注时会拦截这些域名';
}

function createRoleThumb(avatar) {
  const thumb = document.createElement('div');
  thumb.className = 'role-thumb';
  if (avatar.imageUrl) {
    thumb.innerHTML = `<img src="${avatar.imageUrl}" alt="${avatar.name}" />`;
  } else {
    thumb.textContent = avatar.name.slice(0, 1) || '角';
  }
  return thumb;
}

function renderRoles() {
  const list = $('roleList');
  list.innerHTML = '';
  $('roleCount').textContent = `${appState.avatars.length} 个角色`;

  if (!appState.avatars.length) {
    list.innerHTML = '<div class="empty-state">还没有保存角色。先去左侧创建一个你喜欢的桌宠形象吧。</div>';
    return;
  }

  appState.avatars.forEach((avatar) => {
    const item = document.createElement('div');
    item.className = `role-card ${appState.activeAvatarId === avatar.id ? 'active' : ''}`;

    const main = document.createElement('button');
    main.className = 'role-main';
    main.appendChild(createRoleThumb(avatar));

    const meta = document.createElement('div');
    meta.className = 'role-meta';
    meta.innerHTML = `
      <strong>${avatar.name}</strong>
      <span>${STYLE_LABELS[avatar.style] || avatar.style} · ${MOOD_LABELS[avatar.mood] || avatar.mood}</span>
    `;
    main.appendChild(meta);
    main.onclick = async () => {
      if (appState.activeAvatarId === avatar.id) return;
      patchLocalState({ activeAvatarId: avatar.id });
      await window.desktopPet.saveState({ activeAvatarId: avatar.id });
      showToast(`已切换到角色：${avatar.name}`);
    };

    const actions = document.createElement('div');
    actions.className = 'mini-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-text-btn';
    deleteBtn.textContent = '删除';
    deleteBtn.onclick = async () => {
      const confirmed = window.confirm(`确定删除角色“${avatar.name}”吗？`);
      if (!confirmed) return;
      const avatars = appState.avatars.filter((item) => item.id !== avatar.id);
      const activeAvatarId = appState.activeAvatarId === avatar.id ? (avatars[0]?.id || null) : appState.activeAvatarId;
      patchLocalState({ avatars, activeAvatarId });
      await window.desktopPet.saveState({ avatars, activeAvatarId });
      showToast(`已删除角色：${avatar.name}`);
    };

    actions.appendChild(deleteBtn);
    item.appendChild(main);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function renderPlans() {
  const list = $('planList');
  list.innerHTML = '';
  const completed = appState.plans.filter((plan) => plan.done).length;
  $('planProgress').textContent = `已完成 ${completed}/${appState.plans.length}`;

  if (!appState.plans.length) {
    list.innerHTML = '<div class="empty-state">还没有计划。加一条最小可执行的任务，开始今天吧。</div>';
    return;
  }

  appState.plans.forEach((plan) => {
    const row = document.createElement('div');
    row.className = `plan-row ${plan.done ? 'done' : ''}`;

    const toggle = document.createElement('button');
    toggle.className = 'plan-toggle';
    toggle.textContent = plan.done ? '✅' : '⬜';
    toggle.onclick = async () => {
      const plans = appState.plans.map((item) => item.id === plan.id ? { ...item, done: !item.done } : item);
      patchLocalState({ plans });
      await window.desktopPet.saveState({ plans });
    };

    const text = document.createElement('div');
    text.className = 'plan-text';
    text.textContent = plan.text;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-text-btn';
    deleteBtn.textContent = '删除';
    deleteBtn.onclick = async () => {
      const plans = appState.plans.filter((item) => item.id !== plan.id);
      patchLocalState({ plans });
      await window.desktopPet.saveState({ plans });
    };

    row.appendChild(toggle);
    row.appendChild(text);
    row.appendChild(deleteBtn);
    list.appendChild(row);
  });
}

function renderBlockedSites() {
  const list = $('blockedSiteList');
  list.innerHTML = '';

  if (!appState.blockedSites.length) {
    list.innerHTML = '<div class="empty-state">还没有需要屏蔽的网站。</div>';
    return;
  }

  appState.blockedSites.forEach((domain) => {
    const pill = document.createElement('div');
    pill.className = 'site-pill';

    const label = document.createElement('span');
    label.textContent = domain;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = '移除';
    removeBtn.onclick = async () => {
      const blockedSites = appState.blockedSites.filter((item) => item !== domain);
      patchLocalState({ blockedSites });
      await window.desktopPet.saveState({ blockedSites });
    };

    pill.appendChild(label);
    pill.appendChild(removeBtn);
    list.appendChild(pill);
  });
}

function renderStore() {
  const storeList = $('themeStoreList');
  storeList.innerHTML = '';
  $('focusCoinsDisplay').textContent = `余额：${appState.focusCoins || 0}`;

  Object.entries(THEME_PRESETS).forEach(([themeId, theme]) => {
    const unlocked = appState.unlockedThemes.includes(themeId);
    const active = appState.activeTheme === themeId;

    const card = document.createElement('div');
    card.className = `theme-card ${active ? 'active' : ''}`;

    const preview = document.createElement('div');
    preview.className = 'theme-preview';
    preview.style.background = theme.gradient;
    preview.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.4), 0 18px 32px ${theme.glow}`;

    const content = document.createElement('div');
    content.className = 'theme-info';
    content.innerHTML = `
      <div>
        <strong>${theme.name}</strong>
        <p>${theme.description}</p>
        <span>${theme.cost === 0 ? '默认主题' : `${theme.cost} 专注币`}</span>
      </div>
    `;

    const action = document.createElement('button');
    action.className = `btn ${active ? 'ghost' : unlocked ? 'secondary' : ''}`;
    if (active) {
      action.textContent = '已应用';
      action.disabled = true;
    } else if (unlocked) {
      action.textContent = '应用';
      action.onclick = async () => {
        patchLocalState({ activeTheme: themeId });
        await window.desktopPet.saveState({ activeTheme: themeId });
        window.desktopPet.playSound('apply');
        showToast(`主题已应用：${theme.name}`);
      };
    } else {
      action.textContent = appState.focusCoins >= theme.cost ? `购买` : `还差 ${theme.cost - appState.focusCoins}`;
      action.disabled = appState.focusCoins < theme.cost;
      action.onclick = async () => {
        const focusCoins = appState.focusCoins - theme.cost;
        const unlockedThemes = [...new Set([...appState.unlockedThemes, themeId])];
        patchLocalState({ focusCoins, unlockedThemes });
        await window.desktopPet.saveState({ focusCoins, unlockedThemes });
        window.desktopPet.playSound('purchase');
        showToast(`已购买主题：${theme.name}`);
      };
    }

    content.appendChild(action);
    card.appendChild(preview);
    card.appendChild(content);
    storeList.appendChild(card);
  });
}

function renderWeatherCard() {
  const card = $('weatherResultCard');
  if (!weatherPreview) {
    card.innerHTML = '<div class="small">还没有测试天气配置。</div>';
    return;
  }

  card.innerHTML = `
    <strong>${weatherPreview.weather.city}</strong>
    <div>${weatherPreview.summary}</div>
    <span>最近更新时间：${formatDateTime(weatherPreview.weather.observationTime)}</span>
  `;
}

function renderChats() {
  const list = $('chatList');
  list.innerHTML = '';
  const messages = activeAvatar?.messages?.length ? activeAvatar.messages : fallbackMessages;

  messages.forEach((message) => {
    const wrap = document.createElement('div');
    wrap.className = `chat-wrap ${message.role === 'user' ? 'user' : 'avatar'}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = message.text;

    wrap.appendChild(bubble);
    list.appendChild(wrap);
  });

  list.scrollTop = list.scrollHeight;
}

function renderAll(payload) {
  appState = payload.state;
  activeAvatar = payload.activeAvatar;

  renderHeader();
  hydrateAvatarFieldsIfNeeded();
  hydrateSettingsFieldsIfNeeded();
  hydrateFocusFieldsIfNeeded();
  renderPreviewMeta();
  renderFocus();
  renderPlans();
  renderRoles();
  renderBlockedSites();
  renderStore();
  renderChats();
  renderWeatherCard();

  $('happinessDisplay').textContent = `快乐度：${appState.happiness || 70}/100`;
}

$('pickImageBtn').addEventListener('click', async () => {
  try {
    const result = await window.desktopPet.selectImage();
    if (!result) return;
    uploadedImage = result.dataUrl;
    $('uploadPreview').innerHTML = `<img src="${uploadedImage}" alt="uploaded" />`;
    showToast('图片已选中。');
  } catch (error) {
    showToast(error.message || '选择图片失败。', 'error');
  }
});

$('avatarStyle').addEventListener('change', () => {
  renderPreviewMeta();
  if (!isEditing($('editablePrompt'))) $('editablePrompt').value = buildPrompt();
});
$('avatarMood').addEventListener('change', () => {
  if (!isEditing($('editablePrompt'))) $('editablePrompt').value = buildPrompt();
});
$('avatarName').addEventListener('input', () => {
  if (!isEditing($('editablePrompt'))) $('editablePrompt').value = buildPrompt();
});
$('avatarEnergy').addEventListener('input', () => {
  if (!isEditing($('editablePrompt'))) $('editablePrompt').value = buildPrompt();
});

$('generateBtn').addEventListener('click', async () => {
  await withBusy($('generateBtn'), '生成中...', async () => {
    const payload = {
      image: uploadedImage,
      name: $('avatarName').value.trim() || `角色 ${(appState?.avatars?.length || 0) + 1}`,
      style: $('avatarStyle').value,
      mood: $('avatarMood').value,
      energy: Number($('avatarEnergy').value || 70),
      prompt: $('editablePrompt').value.trim() || buildPrompt()
    };

    try {
      const result = await window.desktopPet.generateAvatar(payload);
      $('generatedPreview').innerHTML = `<img src="${result.imageUrl}" alt="generated avatar" />`;
      const avatar = {
        id: Date.now(),
        name: payload.name,
        originalImage: uploadedImage,
        imageUrl: result.imageUrl,
        style: payload.style,
        mood: payload.mood,
        energy: payload.energy,
        prompt: payload.prompt,
        messages: [{ role: 'avatar', text: `你好呀，我是 ${payload.name}，以后由我来陪着你。` }],
        createdAt: new Date().toISOString()
      };
      const avatars = [avatar, ...(appState.avatars || [])];
      patchLocalState({ avatars, activeAvatarId: avatar.id });
      await window.desktopPet.saveState({ avatars, activeAvatarId: avatar.id });
      showToast(result.mock ? '已生成默认风格角色卡。' : '角色生成成功。', 'success');
    } catch (error) {
      showToast(error.message || '生成角色失败。', 'error');
    }
  });
});

$('saveAvatarBtn').addEventListener('click', async () => {
  if (!activeAvatar && !getCurrentPreviewImage()) {
    showToast('先生成一个角色，或者选择已有角色后再保存。', 'error');
    return;
  }

  try {
    const draft = buildAvatarDraft();
    const exists = appState.avatars.some((avatar) => avatar.id === draft.id);
    const avatars = exists
      ? appState.avatars.map((avatar) => avatar.id === draft.id ? { ...avatar, ...draft } : avatar)
      : [draft, ...appState.avatars];
    patchLocalState({ avatars, activeAvatarId: draft.id });
    await window.desktopPet.saveState({ avatars, activeAvatarId: draft.id });
    showToast('当前角色设定已保存。', 'success');
  } catch (error) {
    showToast(error.message || '保存角色失败。', 'error');
  }
});

$('aiProviderSelect').addEventListener('change', () => {
  syncProviderBlocks();
});

$('toggleLLMBtn').addEventListener('click', async () => {
  try {
    const settings = collectSettings({ useLLMChat: !appState.settings.useLLMChat });
    patchLocalState({ settings: { ...appState.settings, ...settings } });
    await window.desktopPet.saveState({ settings });
    showToast(settings.useLLMChat ? '已开启增强聊天。' : '已关闭增强聊天。');
  } catch (error) {
    showToast(error.message || '切换聊天增强失败。', 'error');
  }
});

$('saveApiSettingsBtn').addEventListener('click', async () => {
  try {
    const settings = collectSettings();
    patchLocalState({ settings: { ...appState.settings, ...settings } });
    await window.desktopPet.saveState({ settings });
    showToast('AI 设置已保存。', 'success');
  } catch (error) {
    showToast(error.message || '保存 AI 设置失败。', 'error');
  }
});

$('testLLMBtn').addEventListener('click', async () => {
  await withBusy($('testLLMBtn'), '测试中...', async () => {
    try {
      const result = await window.desktopPet.testLLMConnection(collectSettings());
      showToast(`聊天接口可用：${result.reply}`, 'success');
    } catch (error) {
      showToast(error.message || '聊天接口测试失败。', 'error');
    }
  });
});

$('saveWeatherSettingsBtn').addEventListener('click', async () => {
  try {
    const settings = collectSettings();
    patchLocalState({ settings: { ...appState.settings, ...settings } });
    await window.desktopPet.saveState({ settings });
    showToast('天气设置已保存。', 'success');
  } catch (error) {
    showToast(error.message || '保存天气设置失败。', 'error');
  }
});

$('testWeatherBtn').addEventListener('click', async () => {
  await withBusy($('testWeatherBtn'), '测试中...', async () => {
    try {
      weatherPreview = await window.desktopPet.getWeatherNow(collectSettings());
      renderWeatherCard();
      showToast('天气配置可用。', 'success');
    } catch (error) {
      showToast(error.message || '天气配置测试失败。', 'error');
    }
  });
});

$('saveFocusSettingsBtn').addEventListener('click', async () => {
  try {
    await window.desktopPet.updateFocus({
      focusTask: $('focusTaskInput').value.trim() || '开始今天最重要的一件事',
      focusMinutes: Number($('focusMinutesInput').value || 25),
      breakMinutes: Number($('breakMinutesInput').value || 5),
      remainingSeconds: Number($('focusMinutesInput').value || 25) * 60
    });
    showToast('专注设置已保存。', 'success');
  } catch (error) {
    showToast(error.message || '保存专注设置失败。', 'error');
  }
});

$('focusPrimaryBtn').addEventListener('click', async () => {
  try {
    const focus = appState.focus;
    if (!focus.isRunning) {
      await window.desktopPet.updateFocus({
        isRunning: true,
        isPaused: false,
        mode: 'focus',
        focusTask: $('focusTaskInput').value.trim() || focus.focusTask,
        focusMinutes: Number($('focusMinutesInput').value || focus.focusMinutes),
        breakMinutes: Number($('breakMinutesInput').value || focus.breakMinutes),
        remainingSeconds: Number($('focusMinutesInput').value || focus.focusMinutes) * 60,
        startedAt: Date.now(),
        pausedAt: null
      });
      showToast('专注已开始。');
      return;
    }

    if (!focus.isPaused) {
      await window.desktopPet.updateFocus({
        isPaused: true,
        remainingSeconds: focus.currentRemainingSeconds || focus.remainingSeconds,
        startedAt: null,
        pausedAt: Date.now()
      });
      showToast('专注已暂停。');
      return;
    }

    await window.desktopPet.updateFocus({
      isPaused: false,
      startedAt: Date.now(),
      pausedAt: null
    });
    showToast('已继续专注。');
  } catch (error) {
    showToast(error.message || '切换专注状态失败。', 'error');
  }
});

$('focusResetBtn').addEventListener('click', async () => {
  try {
    const focusMinutes = Number($('focusMinutesInput').value || appState.focus.focusMinutes || 25);
    await window.desktopPet.updateFocus({
      isRunning: false,
      isPaused: false,
      mode: 'focus',
      remainingSeconds: focusMinutes * 60,
      startedAt: null,
      pausedAt: null,
      focusMinutes,
      breakMinutes: Number($('breakMinutesInput').value || appState.focus.breakMinutes || 5)
    });
    showToast('专注计时已重置。');
  } catch (error) {
    showToast(error.message || '重置专注失败。', 'error');
  }
});

$('addPlanBtn').addEventListener('click', async () => {
  const text = $('newPlanInput').value.trim();
  if (!text) return;
  try {
    const plans = [...appState.plans, { id: Date.now(), text, done: false }];
    $('newPlanInput').value = '';
    patchLocalState({ plans });
    await window.desktopPet.saveState({ plans });
    showToast('计划已添加。', 'success');
  } catch (error) {
    showToast(error.message || '添加计划失败。', 'error');
  }
});

$('addBlockedSiteBtn').addEventListener('click', async () => {
  const raw = $('blockedSiteInput').value.trim();
  if (!raw) return;
  try {
    const candidate = raw.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').trim().toLowerCase();
    if (!candidate) {
      showToast('请输入有效域名。', 'error');
      return;
    }
    if (appState.blockedSites.includes(candidate)) {
      showToast('该域名已经在屏蔽列表中了。');
      return;
    }
    const blockedSites = [...appState.blockedSites, candidate];
    $('blockedSiteInput').value = '';
    patchLocalState({ blockedSites });
    await window.desktopPet.saveState({ blockedSites });
    showToast(`已加入屏蔽：${candidate}`);
  } catch (error) {
    showToast(error.message || '添加屏蔽域名失败。', 'error');
  }
});

$('openBlockPreviewBtn').addEventListener('click', async () => {
  const inputUrl = $('blockPreviewUrlInput').value.trim();
  if (!inputUrl) {
    showToast('先输入一个网址再验证。');
    return;
  }
  try {
    await window.desktopPet.openPreviewUrl(inputUrl);
    showToast('验证页已打开。');
  } catch (error) {
    showToast(error.message || '打开验证页失败。', 'error');
  }
});

$('triggerVisitorBtn').addEventListener('click', async () => {
  try {
    const result = await window.desktopPet.triggerVisitor();
    showToast(result.message || (result.ok ? '访客已出现。' : '当前无法触发访客。'), result.ok ? 'success' : 'error');
  } catch (error) {
    showToast(error.message || '触发访客失败。', 'error');
  }
});

$('sendChatBtn').addEventListener('click', async () => {
  const text = $('chatInput').value.trim();
  if (!text) return;

  await withBusy($('sendChatBtn'), '发送中...', async () => {
    const targetAvatar = getFallbackAvatar();
    const history = [...(targetAvatar.messages || []), { role: 'user', text }];
    $('chatInput').value = '';

    if (targetAvatar.id === 'default') {
      fallbackMessages = history;
      renderChats();
    }

    try {
      const response = await window.desktopPet.chatAvatar({
        message: text,
        avatar: {
          id: targetAvatar.id,
          name: targetAvatar.name,
          style: targetAvatar.style,
          mood: targetAvatar.mood,
          energy: targetAvatar.energy,
          prompt: targetAvatar.prompt
        },
        history: history.slice(-12)
      });

      const messages = [...history, { role: 'avatar', text: response.reply || '我会继续陪着你。' }];
      if (targetAvatar.id === 'default') {
        fallbackMessages = messages;
        renderChats();
        return;
      }

      const avatars = appState.avatars.map((avatar) => avatar.id === targetAvatar.id ? { ...avatar, messages } : avatar);
      patchLocalState({ avatars });
      await window.desktopPet.saveState({ avatars });
    } catch (error) {
      const messages = [...history, { role: 'avatar', text: `我刚刚没接上服务，不过我还在。${error.message || '稍后再试试。'}` }];
      if (targetAvatar.id === 'default') {
        fallbackMessages = messages;
        renderChats();
      }
      showToast(error.message || '发送消息失败。', 'error');
    }
  });
});

$('chatInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('sendChatBtn').click();
  }
});

$('themeToggleBtn').addEventListener('click', () => {
  const currentTheme = localStorage.getItem('desktop-pet-control-theme') || 'light';
  applyControlTheme(currentTheme === 'light' ? 'dark' : 'light');
});

window.desktopPet.onPlaySound((soundId) => {
  if (window.playDesktopPetSound) window.playDesktopPetSound(soundId);
});

window.desktopPet.getState().then((payload) => {
  renderPreviewMeta();
  if (!$('editablePrompt').value) $('editablePrompt').value = buildPrompt();
  renderAll(payload);
}).catch((error) => {
  showToast(error.message || '加载应用状态失败。', 'error');
});

window.desktopPet.onStateUpdated(renderAll);

syncProviderBlocks();
applyControlTheme(localStorage.getItem('desktop-pet-control-theme') || 'light');
