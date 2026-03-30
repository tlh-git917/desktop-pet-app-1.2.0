# 功能拓展任务清单

## 阶段 1: 核心状态与商店功能

- [x] **任务 1.1: 扩展核心状态**
  - [x] 在 `src/main.js` 的 `defaultState` 中添加 `focusCoins`, `unlockedThemes`, `activeTheme`, `blockedSites`, `weatherCity`, `weatherApiKey`。

- [x] **任务 1.2: 实现专注币奖励**
  - [x] 修改 `src/main.js` 的 `completeFocusTransition` 函数，在完成专注轮次时增加 `focusCoins`。

- [x] **任务 1.3: 构建商店UI**
  - [x] 在 `src/control.html` 中添加“商店”面板，包括专注币显示和主题列表容器。
  - [x] 在 `src/styles.css` 中为商店和主题项添加样式。

- [x] **任务 1.4: 实现商店逻辑**
  - [x] 在 `src/control.js` 中定义可购买的主题（`THEMES`常量）。
  - [x] 编写 `renderStore` 函数，根据 `unlockedThemes` 和 `focusCoins` 渲染主题列表，显示“购买”或“应用”按钮。
  - [x] 为按钮添加点击事件，实现购买（扣除专注币、更新 `unlockedThemes`）和应用（更新 `activeTheme`）的逻辑。

- [x] **任务 1.5: 应用主题和音效**
  - [x] 在 `src/pet.js` 的 `render` 函数中，根据 `activeTheme` 动态修改宠物背景。
  - [x] 在 `preload.js` 和 `main.js` 中添加播放音效的 `ipc` 通道。
  - [x] 在 `control.js` 的购买/应用操作成功后调用音效播放。

## 阶段 2: 生产力与互动增强

- [x] **任务 2.1: 实现网站屏蔽器UI**
  - [x] 在 `src/control.html` 中添加“生产力工具”面板，包含一个用于输入屏蔽域名的列表和输入框。

- [x] **任务 2.2: 实现网站屏蔽逻辑**
  - [x] 在 `src/control.js` 中实现添加/删除屏蔽域名的逻辑。
  - [x] 在 `src/main.js` 中，使用 `session.defaultSession.webRequest.onBeforeRequest` 来拦截请求。
  - [x] 根据 `state.focus.isRunning` 和 `state.blockedSites` 决定是否阻止请求。

- [x] **任务 2.3: 实现宠物空闲动画**
  - [x] 在 `src/styles.css` 中定义“开心”和“失落”的 `keyframes` 动画。
  - [x] 在 `src/pet.js` 中添加一个计时器，当宠物空闲时，根据 `happiness` 状态为宠物元素添加或移除相应的动画类。

## 阶段 3: AI与社交模拟

- [x] **任务 3.1: 集成天气服务**
  - [x] 在 `src/control.html` 的设置区域添加 `weatherCity` 和 `weatherApiKey` 的输入框。
  - [x] 在 `src/main.js` 中修改 `chat-avatar` 处理器，添加一个 `keyword` 检测（如“天气”）。
  - [x] 如果检测到关键字，则调用天气API获取数据，并将结果格式化后作为AI回复返回。

- [x] **任务 3.2: 实现访客系统**
  - [x] 在 `src/main.js` 中添加一个 `setInterval` 计时器，用于定期触发访客事件。
  - [x] 计时器触发时，从 `state.avatars` 中随机选择一个非当前角色作为访客。
  - [x] 通过 `ipc` 发送一个 `show-visitor` 事件到 `petWindow`，包含访客的图像和预设的对话文本。
  - [x] 在 `src/pet.html` 中添加用于显示访客的DOM元素。
  - [x] 在 `src/pet.js` 中监听 `show-visitor` 事件，显示访客及对话，并在短暂延迟后隐藏。

## 阶段 4: 整合与测试
- [x] **任务 4.1: 全面联调**
  - [x] 启动应用，确保所有新功能的状态都能正确保存和加载。
- [x] **任务 4.2: 手动验收**
  - [x] 按照 `checklist.md` 的所有项目逐一验证功能。
