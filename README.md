# 企业微信机器人 pi 扩展

将企业微信智能机器人集成到 pi 中，通过 WebSocket 长连接接收用户消息，并使用 pi 接入的 AI 模型进行响应。

## 功能特性

- 🔗 **WebSocket 长连接** - 自动连接、认证、心跳保活
- 📨 **消息转发** - 将企业微信消息转发给 AI 模型
- 💬 **自动回复** - AI 响应自动回复给用户
- 🔄 **流式状态** - 显示"思考中"状态
- 👋 **欢迎语** - 用户进入会话自动发送欢迎语
- 🃏 **模板卡片** - 支持模板卡片交互
- 🔁 **自动重连** - 断线后自动重连

## 安装

扩展已位于 `.pi/extensions/wecom-bot/` 目录，pi 会自动加载。

## 配置

在 `~/.pi/settings.json` 中配置环境变量：

```json
{
  "env": {
    "WECOM_BOT_ID": "your-bot-id",
    "WECOM_BOT_SECRET": "your-bot-secret"
  }
}
```

或设置系统环境变量：

```bash
export WECOM_BOT_ID=your-bot-id
export WECOM_BOT_SECRET=your-bot-secret
```

## 使用

### 启动 pi

```bash
pi
```

扩展会自动连接企业微信机器人。

### 命令

```
/wecom status     # 查看连接状态
/wecom connect    # 手动连接
/wecom disconnect # 断开连接
```

### 工作流程

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   企业微信用户    │────▶│   WeCom Bot     │────▶│   pi + AI      │
│                 │     │   (WebSocket)   │     │                 │
│                 │◀────│                 │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. 用户在企业微信发送消息
2. 消息通过 WebSocket 推送到扩展
3. 扩展调用 `pi.sendUserMessage()` 发送给 AI
4. AI 响应通过 `message_end` 事件捕获
5. 响应通过 WebSocket 回复给用户

## 目录结构

```
.pi/extensions/wecom-bot/
├── package.json    # npm 依赖配置
├── index.ts        # 扩展主代码
└── README.md       # 说明文档
```

## 扩展开发

修改 `index.ts` 后，使用 `/reload` 重新加载扩展。

### 关键代码

```typescript
// 监听 WeCom 消息
wsClient.on('message.text', async (frame: WsFrame) => {
  const content = frame.body.text?.content;
  // 发送给 AI
  pi.sendUserMessage(content);
});

// 监听 AI 响应
pi.on('message_end', async (event, ctx) => {
  if (event.message.role !== 'assistant') return;
  // 发送给 WeCom
  await client.replyStream(frame, streamId, content, true);
});
```

## 相关文档

- [pi 扩展文档](/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md)
- [企业微信智能机器人 SDK](https://www.npmjs.com/package/@wecom/aibot-node-sdk)

## 许可证

ISC