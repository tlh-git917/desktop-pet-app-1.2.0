# 虚拟陪伴桌宠 1.2.0

这是一个以“陪伴 + 专注 + 生产力”为核心的 Electron 桌宠项目。当前版本已经补齐了商店主题、音效、网站屏蔽、天气查询、访客系统、拖拽、主题应用、空闲动画、角色聊天和 API 配置链路，并增加了可直接运行的 QA 检查脚本，方便你在本地继续迭代。

![Pet Preview](https://user-images.githubusercontent.com/389832/285514065-27a36f9a-11e7-402a-b7a6-383748259d04.png)

## 这次已经完成的重点修复

- 修复控制台缺失 DOM、重复 ID、按钮绑定异常等问题
- 重做桌宠控制面板界面，支持亮色 / 暗色切换与更清晰的信息层级
- 主题商店现在会真正作用到桌宠背景、气泡和高光样式
- 新增合成音效系统，覆盖购买、应用主题、专注完成、点击宠物、访客到来等反馈
- 完成桌宠拖拽 IPC 链路，拖拽位置会自动保存
- 完成网站屏蔽器，专注中会对命中的域名进行阻断
- 完成天气查询设置和 API 测试入口，宠物可回答天气问题
- 完成访客系统，支持随机访客和手动触发访客
- 完成空闲动画触发逻辑，快乐度高低会影响宠物状态表现
- 完成 API 设置面板，支持 OpenAI、智谱、自定义兼容接口
- 新增 `npm run check`，用于做语法、DOM、IPC、构建清单和业务规则的综合检查

## 功能概览

### ❤️ 宠物养成
- 快乐度系统
- 点击互动反馈
- 空闲动画
- 情绪化文案与聊天语气

### 🪙 商店与主题
- 专注币奖励
- 多主题商店
- 购买 / 应用音效
- 主题即刻生效并持久化

### 🚀 生产力
- 番茄专注
- 今日计划管理
- 专注期间网站屏蔽
- 验证页预览入口

### 🧠 AI 与连接能力
- OpenAI / 智谱 / 自定义兼容接口
- 自定义头像生成接口
- 天气 API 查询
- 宠物聊天会感知快乐度、专注状态和天气问题

### 👨‍👩‍👧‍👦 访客系统
- 多角色保存
- 随机访客串门
- 手动触发访客测试

## 快速开始

```bash
npm install
npm run check
npm start
```

启动后：
1. 点击桌宠右下角 `⚙` 打开控制台
2. 先在“AI 服务设置”里填写聊天接口或保持本地陪伴模式
3. 如果要启用天气能力，填写城市与 OpenWeather API Key
4. 如果要启用头像生成，填写自定义图片接口地址

## API 配置说明

### 1. 聊天接口
支持三种模式：
- **OpenAI**：填写 API Key，选择模型
- **智谱**：填写 API Key，选择模型
- **自定义兼容接口**：填写兼容 OpenAI Chat Completions 的 URL 与 Key

控制台里提供了“测试聊天连接”按钮，建议保存后先测通。

### 2. 天气接口
当前使用 **OpenWeather Current Weather API**。
你需要：
- 城市名，例如 `Shanghai` / `Beijing`
- OpenWeather API Key

保存后可点“测试天气连接”，宠物聊天中问“今天天气怎么样”会优先调用天气接口。

### 3. 图片接口
如果不填写图片生成接口，系统会自动回退到本地生成的 SVG 角色卡，保证流程可用。
如果填写了图片接口，返回值支持以下常见格式之一：
- `{ imageUrl: "..." }`
- `{ image_url: "..." }`
- `{ url: "..." }`
- `{ data: [{ url: "..." }] }`
- `{ data: [{ b64_json: "..." }] }`

## 本地检查

```bash
npm run check
```

检查内容包括：
- 关键文件是否齐全
- JavaScript 语法检查
- HTML 重复 ID 检查
- 渲染层 DOM 引用检查
- preload 暴露 API 与渲染层调用一致性检查
- 主进程 IPC、音效、访客、网站屏蔽链路检查
- 核心业务规则检查
- `npm pack --dry-run` 打包清单检查

检查结果会输出到根目录的 `TEST_REPORT.md`。

## GitHub 自动打包安装包

GitHub 实际会执行的工作流文件是：
- `.github/workflows/build.yml`

根目录里的 `build.yml` 只是同内容备份，方便你直接查看，不会被 GitHub 自动执行。

### 触发方式
- 推送到 `main` 或 `master`：自动构建并上传安装包工件
- 手动运行 `workflow_dispatch`：在 GitHub Actions 页面手动点运行
- 推送版本标签，例如 `v1.2.0`：除了上传工件，还会自动把安装包上传到该标签对应的 GitHub Release

### 自动流程
1. 检出仓库
2. 安装 Node.js 20
3. 执行 `npm install`
4. 执行 `npm run check`
5. 执行 `npm run dist:win`
6. 上传 `dist/*.exe` 到 Actions 工件
7. 如果当前是 `v*` 标签，再同步上传到 GitHub Release

### 你在 GitHub 上怎么用
1. 把整个项目推到 GitHub 仓库根目录
2. 确认工作流文件位于 `.github/workflows/build.yml`
3. 进入仓库的 **Actions** 页面，启用工作流
4. 正常提交代码到 `main`
5. 等待工作流完成后，到该次运行的 **Artifacts** 下载 exe 安装包

如果你希望 GitHub 自动生成可长期分享的下载页面，用标签发布：

```bash
git tag v1.2.0
git push origin v1.2.0
```

推送后，工作流会自动把安装包挂到同名 Release 下。

## 本地打包

```bash
npm install
npm run check
npm run dist:win
```

也可以直接双击：

```bat
build-windows.bat
```

## 项目结构

```text
.
├─ .github/workflows/build.yml
├─ app-core.js
├─ build-windows.bat
├─ build.yml
├─ control.html
├─ control.js
├─ main.js
├─ package.json
├─ pet.html
├─ pet.js
├─ preload.js
├─ renderer-config.js
├─ scripts/qa-check.js
├─ sound-player.js
├─ styles.css
└─ TEST_REPORT.md
```

## 说明

当前环境里我已经补完了代码层面的缺失并通过了本地静态综合检查。若你要继续做 GUI 级体验验收，建议在本机联网后执行：

```bash
npm install
npm run check
npm start
```
