# 企业微信机器人 pi 扩展

通过 WebSocket 长连接将企业微信机器人与 pi 的 AI 能力集成。

## 功能

- 📨 接收企业微信用户消息，自动转发给 AI 模型
- 💬 AI 响应自动回复给企业微信用户
- 🔄 支持流式回复（思考状态 + 最终响应）
- 👋 进入会话欢迎语
- 🃏 模板卡片交互支持
- 🔁 自动断线重连

## 安装

扩展位于项目的 `.pi/extensions/wecom-bot/` 目录，pi 会自动加载。

## 配置

在扩展目录下的 `.env` 文件中配置机器人凭证：

```bash
WECOM_BOT_ID=your-bot-id
WECOM_BOT_SECRET=your-bot-secret
```

扩展会自动加载 `.pi/extensions/wecom-bot/.env` 文件。

## 使用

### 自动连接

扩展在 pi 启动时会自动连接企业微信机器人（如果配置了环境变量）。

### 命令

在 pi 中使用 `/wecom` 命令管理机器人：

| 命令 | 说明 |
|------|------|
| `/wecom status` | 查看连接状态 |
| `/wecom connect` | 手动连接企微机器人 |
| `/wecom disconnect` | 断开连接 |
| `/wecom send <消息>` | 发送消息给最近联系人 |
| `/wecom notify <消息>` | 发送消息给预设通知目标 |
| `/wecom reminder [子命令]` | 管理定时提醒 |
| `/wecom github [子命令]` | 管理 GitHub Trending 推送 |
| `/wecom today [子命令]` | 管理 GitHub 今日新上榜推送 |

#### 命令详情

**`/wecom status`**
显示当前连接状态和认证情况。

**`/wecom connect`**
手动发起连接。如果已配置环境变量，pi 启动时会自动连接，无需手动执行。

**`/wecom disconnect`**
断开与企业微信机器人的连接。

**`/wecom send <消息>`**
主动发送消息给最近联系的用户。

**`/wecom notify <消息>`**
主动发送消息给预设的通知目标（`WECOM_NOTIFY_CHAT_ID`）。

**`/wecom reminder [子命令]`**
管理定时提醒功能：

| 子命令 | 说明 |
|--------|------|
| `reminder status` | 查看提醒状态 |
| `reminder on` | 开启定时提醒 |
| `reminder off` | 关闭定时提醒 |
| `reminder time HH:MM` | 设置提醒时间 |
| `reminder message <文本>` | 设置提醒消息 |
| `reminder test` | 发送测试提醒 |

- **使用示例**：
  ```
  /wecom reminder on
  /wecom reminder time 19:30
  /wecom reminder message 下班时间到！
  /wecom reminder test
  ```

- **环境变量配置**：
  ```
  WECOM_REMINDER_ENABLED=true
  WECOM_REMINDER_TIME=19:30
  WECOM_REMINDER_MESSAGE=👋 下班时间到！
  ```

**`/wecom github [子命令]`**
管理 GitHub Trending 定时推送功能：

| 子命令 | 说明 |
|--------|------|
| `github status` | 查看 GitHub Trending 状态 |
| `github on` | 开启 GitHub Trending 推送 |
| `github off` | 关闭 GitHub Trending 推送 |
| `github time HH:MM` | 设置推送时间 |
| `github lang <语言>` | 设置筛选语言 (如 TypeScript, Python) |
| `github now` | 立即获取并发送 Trending |
| `github test` | 发送测试推送 |

- **使用示例**：
  ```
  /wecom github on
  /wecom github time 20:00
  /wecom github lang TypeScript
  /wecom github now
  ```

- **环境变量配置**：
  ```
  WECOM_GITHUB_TRENDING_ENABLED=true
  WECOM_GITHUB_TRENDING_TIME=20:00
  WECOM_GITHUB_TRENDING_LANGUAGE=TypeScript
  ```

**`/wecom today [子命令]`**
管理 GitHub 今日新上榜定时推送（今天创建的新项目）：

| 子命令 | 说明 |
|--------|------|
| `today status` | 查看状态 |
| `today on` | 开启推送 |
| `today off` | 关闭推送 |
| `today time HH:MM` | 设置推送时间 |
| `today lang <语言>` | 设置筛选语言 |
| `today now` | 立即获取并发送 |
| `today test` | 发送测试推送 |

- **使用示例**：
  ```
  /wecom today on
  /wecom today time 20:15
  /wecom today lang Python
  /wecom today now
  ```

- **环境变量配置**：
  ```
  WECOM_GITHUB_TODAY_ENABLED=true
  WECOM_GITHUB_TODAY_TIME=20:15
  WECOM_GITHUB_TODAY_LANGUAGE=Python
  ```

### 工作流程

1. 用户在企业微信中向机器人发送消息
2. 消息通过 WebSocket 推送到扩展
3. 扩展将消息转发给 pi 的 AI 模型
4. AI 响应自动回复给用户

## 示例

```
用户（企业微信）: 你好，帮我写一个 Python 脚本
↓
扩展: 将消息发送给 AI
↓
AI: 当然！我来帮你写一个 Python 脚本...
↓
扩展: 将响应回复给用户
↓
用户（企业微信）: 收到 AI 的回复
```

## 注意事项

- AI 响应是完整的，不是流式的（企业微信限制）
- 支持单聊和群聊消息
- 群聊消息会附带发送者信息

## 扩展开发

扩展文件结构：

```
.pi/extensions/wecom-bot/
├── package.json    # 依赖配置
├── node_modules/   # npm 依赖
└── index.ts        # 扩展代码
```

修改 `index.ts` 后，使用 `/reload` 重新加载扩展。

## 相关文档

- [pi 扩展文档](/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md)
- [企业微信智能机器人 SDK](https://www.npmjs.com/package/@wecom/aibot-node-sdk)