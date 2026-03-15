# pi 扩展平台

为 pi 接入第三方客户端的扩展集合。目前支持企业微信机器人，未来计划支持飞书、钉钉等更多客户端。

## 客户端支持

| 客户端 | 状态 | 说明 |
|--------|------|------|
| 企业微信 | ✅ 已支持 | WebSocket 长连接，消息自动转发 AI |
| 飞书 | 🔜 计划中 | - |
| 钉钉 | 🔜 计划中 | - |

## 已支持的扩展

### wecom-bot - 企业微信机器人

将企业微信智能机器人集成到 pi 中，通过 WebSocket 长连接接收用户消息，并使用 pi 接入的 AI 模型进行响应。

**功能特性：**

- 🔗 WebSocket 长连接 - 自动连接、认证、心跳保活
- 📨 消息转发 - 将企业微信消息转发给 AI 模型
- 💬 自动回复 - AI 响应自动回复给用户
- 🔄 流式状态 - 显示"思考中"状态
- 👋 欢迎语 - 用户进入会话自动发送欢迎语
- 🃏 模板卡片 - 支持模板卡片交互
- 🔁 自动重连 - 断线后自动重连

**安装：**

```bash
cd .pi/extensions/wecom-bot
npm install
```

**配置：**

在扩展目录下的 `.env` 文件中配置：

```bash
WECOM_BOT_ID=your-bot-id
WECOM_BOT_SECRET=your-bot-secret
```

**使用：**

```
/wecom status     # 查看连接状态
/wecom connect    # 手动连接
/wecom disconnect # 断开连接
```

**详细文档：** [.pi/extensions/wecom-bot/README.md](.pi/extensions/wecom-bot/README.md)

## 扩展开发

### 添加新客户端

1. 在 `.pi/extensions/` 下创建新扩展目录
2. 实现扩展入口文件 `index.ts`
3. 参考 wecom-bot 的实现方式

### 目录结构

```
.pi/extensions/
├── wecom-bot/           # 企业微信机器人
│   ├── index.ts         # 扩展代码
│   ├── package.json     # 依赖配置
│   └── README.md        # 使用文档
└── [新扩展]/            # 未来扩展
```

## 许可证

ISC
