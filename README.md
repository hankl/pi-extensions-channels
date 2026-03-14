# 企业微信智能机器人

基于 `@wecom/aibot-node-sdk` 的企业微信智能机器人，支持 WebSocket 长连接、流式回复、模板卡片、文件上传下载等功能。

## 安装

```bash
npm install
```

## 配置

复制 `.env.example` 为 `.env`，填写企业微信机器人配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
WECOM_BOT_ID=your-bot-id
WECOM_BOT_SECRET=your-bot-secret
```

## 使用

### 快速开始

```bash
npm run start
# 或
npm run dev  # 开发模式，自动重载
```

### 运行完整示例

```bash
npm run example
```

## API 示例

### 基本用法

```typescript
import { WeComBot } from './wecom-bot.js';
import type { WsFrame } from './wecom-bot.js';

const bot = new WeComBot({
  botId: 'your-bot-id',
  secret: 'your-bot-secret',
});

// 处理文本消息
bot.on('text', async (frame: WsFrame) => {
  const content = frame.body.text?.content;
  await bot.replyText(frame, `收到：${content}`);
});

// 处理进入会话
bot.on('enter_chat', async (frame: WsFrame) => {
  await bot.replyWelcome(frame, '欢迎！');
});

// 建立连接
bot.connect();
```

### 流式回复

```typescript
bot.on('text', async (frame: WsFrame) => {
  const streamId = bot.generateStreamId();
  
  // 发送中间状态
  await bot.replyStreamWithId(frame, streamId, '思考中...', false);
  
  // 发送最终结果
  await bot.replyStreamWithId(frame, streamId, '这是回复！', true);
});
```

### 模板卡片

```typescript
import type { TemplateCard } from './wecom-bot.js';

// 发送卡片
bot.on('text', async (frame: WsFrame) => {
  const card: TemplateCard = {
    card_type: 'button_interaction',
    main_title: { title: '请选择操作' },
    button_list: [
      { text: '确认', key: 'btn_confirm', style: 1 },
      { text: '取消', key: 'btn_cancel', style: 2 },
    ],
    task_id: `task_${Date.now()}`,
  };
  await bot.replyTemplateCard(frame, card);
});

// 处理卡片按钮点击
bot.on('template_card_event', async (frame: WsFrame) => {
  const eventKey = frame.body.event?.event_key;
  const taskId = frame.body.event?.task_id;
  
  await bot.updateTemplateCard(frame, {
    card_type: 'text_notice',
    main_title: { title: eventKey === 'btn_confirm' ? '已确认' : '已取消' },
    task_id: taskId,
  });
});
```

### 文件上传下载

```typescript
// 下载图片
bot.on('image', async (frame: WsFrame) => {
  const savedPath = await bot.downloadImage(frame, './downloads');
  console.log(`图片已保存: ${savedPath}`);
});

// 上传文件并回复
bot.on('text', async (frame: WsFrame) => {
  const result = await bot.uploadMedia('./document.pdf', 'file');
  await bot.replyMedia(frame, 'file', result.media_id);
});
```

### 主动推送

```typescript
// 向指定用户推送消息
await bot.sendMessage('userid', '这是一条主动推送的消息');
```

## 支持的消息类型

| 类型 | 事件名 | 说明 |
|------|--------|------|
| 文本 | `text` | 文本消息 |
| 图片 | `image` | 图片消息 |
| 图文混排 | `mixed` | 图文混排消息 |
| 语音 | `voice` | 语音消息 |
| 文件 | `file` | 文件消息 |
| 进入会话 | `enter_chat` | 用户进入会话 |
| 卡片事件 | `template_card_event` | 模板卡片按钮点击 |
| 用户反馈 | `feedback_event` | 用户反馈事件 |

## API 参考

### WeComBot 构造选项

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `botId` | string | ✅ | - | 机器人 ID |
| `secret` | string | ✅ | - | 机器人 Secret |
| `reconnectInterval` | number | - | 1000 | 重连基础延迟（ms） |
| `maxReconnectAttempts` | number | - | 10 | 最大重连次数 |
| `heartbeatInterval` | number | - | 30000 | 心跳间隔（ms） |
| `requestTimeout` | number | - | 10000 | 请求超时（ms） |
| `logger` | Logger | - | console | 自定义日志 |

### 主要方法

| 方法 | 说明 |
|------|------|
| `connect()` | 建立连接 |
| `disconnect()` | 断开连接 |
| `on(type, handler)` | 注册消息处理器 |
| `replyText(frame, content)` | 回复文本 |
| `replyMarkdown(frame, content)` | 回复 Markdown |
| `replyStream(frame, content, finish?)` | 流式回复 |
| `replyStreamWithId(frame, streamId, content, finish?)` | 流式回复（自定义 ID） |
| `replyWelcome(frame, content)` | 发送欢迎语 |
| `replyTemplateCard(frame, card)` | 回复模板卡片 |
| `updateTemplateCard(frame, card)` | 更新模板卡片 |
| `sendMessage(chatid, content)` | 主动推送消息 |
| `uploadMedia(filePath, type)` | 上传素材 |
| `replyMedia(frame, type, mediaId)` | 回复媒体消息 |
| `downloadFile(url, aesKey)` | 下载解密文件 |
| `downloadImage(frame, saveDir)` | 下载图片 |
| `downloadAndSaveFile(frame, saveDir)` | 下载文件 |

## 许可证

ISC