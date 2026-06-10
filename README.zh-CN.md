# Engram

[English README](README.md)

Engram 是一个面向高频、高强度英语单词学习场景的桌面背词应用。它采用轻量化的 Electron 架构，使用本地 SQLite 保存学习进度，并将分组学习与间隔复习调度结合在一起。

## 项目简介

Engram 的设计目标不是游戏化激励，而是提供一个更直接、更低干扰的学习流程。当前版本内置多套词书，支持本地进度记录、到期复习、学习统计、例句展示、发音播放，以及可分发的 Windows 桌面应用形态。

## 功能特点

- 分组式学习流程，可混合新词与到期复习词
- 三档反馈：`unknown`、`vague`、`known`
- 基于本地 SQLite 的间隔复习调度
- 内置 CET4、CET6、考研词汇、雅思词汇、托福词汇
- 单词卡片支持展示源词库例句
- 支持英音 / 美音播放，优先使用词库音频，失败时回退到系统 TTS
- 支持每日 0 点或 5 点刷新学习日
- 含日历和图表的学习统计面板
- 深色 / 浅色主题
- 无需后端服务的本地桌面应用体验

## 功能截图

### 主学习界面

![主学习界面](<docs/image/Main study view.png>)

### 统计面板

![统计面板](<docs/image/Statistics dashboard.png>)

### 设置面板

![设置面板](<docs/image/Settings panel.png>)

## 技术栈

- Electron
- HTML
- CSS
- JavaScript
- SQLite（通过 Node.js 内置 `node:sqlite`）
- electron-builder

## 本地运行

### 安装依赖

```powershell
npm install
```

### 重建本地数据库

```powershell
npm run rebuild-db
```

### 启动应用

```powershell
npm start
```

## 打包方式

构建 Windows 发布产物：

```powershell
npm run dist
```

当前构建配置会生成：

- Windows 安装包
- Windows zip 压缩包

## 数据来源说明

本项目包含用于构建本地 SQLite 数据库的词库 JSON 数据。

致谢：

- 词库数据来源于 [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary)

## 文档

- 英文 README：[README.md](README.md)
- 项目说明：[docs/about.md](docs/about.md)
- 学习说明：[docs/guide.md](docs/guide.md)

## 许可证说明

本项目采用 MIT License 开源，详见 [LICENSE](LICENSE)。

## 免责声明

- 本项目用于学习和个人效率提升场景。
- 内置词库数据仍应遵循其原始来源的条款与署名要求。
- 本项目不对适用性、正确性或持续可用性提供任何保证。
