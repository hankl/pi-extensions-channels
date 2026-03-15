# ADR: 插件扩展配置管理方式选择

## 状态

已通过

## 背景

在开发 wecom-bot 插件扩展时，需要确定配置（机器人凭证）的管理方式。项目文档最初描述使用 `settings.json` 配置，但实际代码使用 dotenv (.env) 文件加载配置，两者不一致。

## 决策

**采用 dotenv (.env) 方式管理插件配置**

## 详情

### 考虑的方案

#### 方案 1: dotenv (.env 文件)

- 在扩展目录下创建 `.env` 文件
- 使用 `dotenv` 库加载配置到 `process.env`
- `.env` 文件加入 `.gitignore`
- 安装扩展后，用户主动告知pi配置信息，pi会自动帮助用户创建 `.env` 文件。

**优点**:
- ✅ 配置与扩展绑定，安装插件即用
- ✅ 隐私性好，`.env` 通常被 git 忽略
- ✅ 配置隔离，不污染主项目配置
- ✅ 便携性强，插件可独立分发

**缺点**:
- ❌ 每个扩展需要单独维护一份 .env

#### 方案 2: settings.json

- 在主项目的 `~/.pi/settings.json` 中配置
- 扩展从 settings 读取配置

**优点**:
- ✅ 集中管理，所有配置在一处

**缺点**:
- ❌ 配置与扩展分离，安装后还需额外配置主项目
- ❌ 隐私风险，settings 可能被提交到仓库
- ❌ 配置耦合，插件无法独立分发

## 后果

- 插件配置通过 `.env` 文件管理，位于 `.pi/extensions/wecom-bot/.env`
- 使用 `dotenv` 库自动加载扩展目录下的 `.env` 文件
- 更新了代码注释和文档，保持一致性

## 相关文件

- [index.ts](file:///Users/hankl/code/nova-pi/.pi/extensions/wecom-bot/index.ts)
- [README.md](file:///Users/hankl/code/nova-pi/.pi/extensions/wecom-bot/README.md)
- [.env 示例](file:///Users/hankl/code/nova-pi/.pi/extensions/wecom-bot/.env)
