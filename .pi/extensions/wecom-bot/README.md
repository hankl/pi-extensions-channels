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

```
/wecom status     # 查看连接状态
/wecom connect    # 手动连接
/wecom disconnect # 断开连接
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