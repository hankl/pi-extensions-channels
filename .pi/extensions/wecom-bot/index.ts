/**
 * 企业微信机器人 pi 扩展
 *
 * 功能：
 * - 通过 WebSocket 长连接接收企业微信消息
 * - 将用户消息转发给 pi 接入的 AI 模型
 * - 将 AI 响应回复给企业微信用户
 *
 * 使用：
 * 1. 在 settings.json 中配置 WECOM_BOT_ID 和 WECOM_BOT_SECRET
 * 2. 扩展会自动连接企业微信机器人
 * 3. 用户发送消息到机器人，AI 会自动响应
 *
 * 命令：
 * - /wecom status  - 查看连接状态
 * - /wecom connect - 手动连接
 * - /wecom disconnect - 断开连接
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { WSClient, WsFrame, generateReqId } from "@wecom/aibot-node-sdk";
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// 获取当前文件所在目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载扩展目录下的 .env 文件
config({ path: resolve(__dirname, '.env') });

// 扩展状态
interface WeComState {
  connected: boolean;
  authenticated: boolean;
  botId?: string;
}

// 待处理的 WeCom 请求
interface PendingRequest {
  frame: WsFrame;
  streamId: string;
  accumulatedContent: string;
  startTime: number;
}

// 最近联系的用户
interface LastContact {
  userId: string;
  chatId: string;
  chatType: 'single' | 'group';
}

export default function wecomBotExtension(pi: ExtensionAPI) {
  // WeCom 客户端
  let client: WSClient | null = null;
  
  // 状态
  const state: WeComState = {
    connected: false,
    authenticated: false,
  };

  // 待处理的请求映射 (chatid -> PendingRequest)
  const pendingRequests = new Map<string, PendingRequest>();

  // 当前正在处理的 chatid
  let currentChatId: string | null = null;

  // AI 响应累积
  let aiResponseBuffer = "";

  // 最近联系的用户
  let lastContact: LastContact | null = null;

  // 从 settings 获取配置
  function getConfig(): { botId: string; secret: string } | null {
    // 尝试从环境变量获取
    const botId = process.env.WECOM_BOT_ID;
    const secret = process.env.WECOM_BOT_SECRET;
    
    console.log('[WeCom Debug] WECOM_BOT_ID:', botId ? '已设置' : '未设置');
    console.log('[WeCom Debug] WECOM_BOT_SECRET:', secret ? '已设置' : '未设置');

    if (botId && secret) {
      return { botId, secret };
    }

    return null;
  }

  // 初始化 WeCom 客户端
  function initClient(botId: string, secret: string): WSClient {
    const wsClient = new WSClient({
      botId,
      secret,
      maxReconnectAttempts: -1, // 无限重连
    });

    // 连接事件
    wsClient.on('connected', () => {
      state.connected = true;
      pi.events.emit('wecom:status', { connected: true });
      console.log('[WeCom] 🔗 WebSocket 连接已建立');
    });

    // 认证成功
    wsClient.on('authenticated', () => {
      state.authenticated = true;
      state.botId = botId;
      pi.events.emit('wecom:status', { authenticated: true });
      console.log('[WeCom] 🔐 认证成功');
    });

    // 断开连接
    wsClient.on('disconnected', (reason: string) => {
      state.connected = false;
      state.authenticated = false;
      pi.events.emit('wecom:status', { connected: false });
      console.log(`[WeCom] 🔌 连接断开: ${reason}`);
    });

    // 重连中
    wsClient.on('reconnecting', (attempt: number) => {
      console.log(`[WeCom] 🔄 正在重连（第 ${attempt} 次）...`);
    });

    // 错误
    wsClient.on('error', (error: Error) => {
      console.error('[WeCom] ❌ 错误:', error.message);
    });

    // 文本消息
    wsClient.on('message.text', async (frame: WsFrame) => {
      await handleWeComMessage(frame);
    });

    // 进入会话
    wsClient.on('event.enter_chat', async (frame: WsFrame) => {
      await handleEnterChat(frame);
    });

    // 模板卡片事件
    wsClient.on('event.template_card_event', async (frame: WsFrame) => {
      await handleTemplateCardEvent(frame);
    });

    return wsClient;
  }

  // 处理 WeCom 消息
  async function handleWeComMessage(frame: WsFrame): Promise<void> {
    const body = frame.body;
    const content = body.text?.content || '';
    const chatId = body.chatid || body.from?.userid || '';
    const userId = body.from?.userid || '';
    const chatType = body.chattype || 'single';

    console.log(`[WeCom] 💬 收到消息 [${chatType}] ${userId}: ${content}`);

    // 生成流式消息 ID
    const streamId = generateReqId('stream');

    // 记录待处理请求
    pendingRequests.set(chatId, {
      frame,
      streamId,
      accumulatedContent: '',
      startTime: Date.now(),
    });

    // 记录最近联系的用户
    lastContact = { userId, chatId, chatType };

    // 设置当前处理的 chatid
    currentChatId = chatId;

    // 清空响应缓冲
    aiResponseBuffer = '';

    // 发送"思考中"状态
    try {
      await client?.replyStream(frame, streamId, '🤔 正在思考...', false);
    } catch (err) {
      console.error('[WeCom] 发送思考状态失败:', err);
    }

    // 构建用户消息，附带上下文信息
    let userMessage = content;
    if (chatType === 'group') {
      userMessage = `[企业微信群聊消息] 用户 ${userId} 说：${content}`;
    } else {
      userMessage = `[企业微信私聊消息] ${content}`;
    }

    // 发送给 AI 处理
    pi.sendUserMessage(userMessage);
  }

  // 处理进入会话事件
  async function handleEnterChat(frame: WsFrame): Promise<void> {
    const userId = frame.body.from?.userid || '';
    console.log(`[WeCom] 👋 用户 ${userId} 进入会话`);

    try {
      await client?.replyWelcome(frame, {
        msgtype: 'text',
        text: { content: '👋 您好！我是 AI 助手，有什么可以帮您的吗？' },
      });
    } catch (err) {
      console.error('[WeCom] 发送欢迎语失败:', err);
    }
  }

  // 处理模板卡片事件
  async function handleTemplateCardEvent(frame: WsFrame): Promise<void> {
    const eventKey = frame.body.event?.event_key;
    const taskId = frame.body.event?.task_id;
    console.log(`[WeCom] 🃏 模板卡片事件: ${eventKey}`);

    // 可以根据 eventKey 执行不同操作
    try {
      await client?.updateTemplateCard(frame, {
        card_type: 'text_notice',
        main_title: { title: `已收到操作: ${eventKey}` },
        task_id: taskId,
      });
    } catch (err) {
      console.error('[WeCom] 更新卡片失败:', err);
    }
  }

  // 发送 AI 响应到 WeCom
  async function sendResponseToWeCom(chatId: string, content: string, isFinal: boolean = true): Promise<void> {
    const pending = pendingRequests.get(chatId);
    if (!pending || !client) {
      console.log(`[WeCom] 未找到待处理请求: ${chatId}`);
      return;
    }

    const { frame, streamId } = pending;

    try {
      // 发送流式回复
      await client.replyStream(frame, streamId, content, isFinal);
      
      if (isFinal) {
        pendingRequests.delete(chatId);
        console.log(`[WeCom] ✅ 响应已发送`);
      }
    } catch (err) {
      console.error('[WeCom] 发送响应失败:', err);
    }
  }

  // 监听 message_end 事件 - 在 assistant 消息完成时触发
  pi.on('message_end', async (event, ctx) => {
    const message = event.message;
    
    // 只处理 assistant 消息
    if (!message || message.role !== 'assistant') return;
    
    // 检查是否有待处理的 WeCom 请求
    if (!currentChatId) return;

    const pending = pendingRequests.get(currentChatId);
    if (!pending) return;

    // 提取文本内容
    const content = message.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    console.log(`[WeCom] 📝 message_end 收到内容: ${content?.substring(0, 100)}...`);

    // 检查是否有工具调用 - 如果有工具调用，说明 AI 还在处理中，不发送响应
    const hasToolUse = message.content.some(c => c.type === 'toolUse');
    if (hasToolUse) {
      console.log(`[WeCom] 🔧 检测到工具调用，等待后续处理...`);
      return;
    }

    // 如果有文本内容，发送响应
    if (content) {
      console.log(`[WeCom] ✅ 发送最终响应`);
      await sendResponseToWeCom(currentChatId, content, true);
      // 清理状态
      currentChatId = null;
    }
  });

  // 监听 turn_end 事件 - 作为备份，确保响应被发送
  pi.on('turn_end', async (event, ctx) => {
    // 检查是否有待处理的 WeCom 请求
    if (!currentChatId) {
      console.log(`[WeCom] turn_end: 没有待处理的请求`);
      return;
    }

    const pending = pendingRequests.get(currentChatId);
    if (!pending) {
      console.log(`[WeCom] turn_end: 未找到 pending request`);
      return;
    }

    // 从 turn_end 的 message 中提取文本内容
    const message = event.message;
    if (!message) {
      console.log(`[WeCom] turn_end: 没有 message`);
      return;
    }

    console.log(`[WeCom] turn_end: message role = ${message.role}`);

    if (message.role !== 'assistant') return;

    const content = message.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    console.log(`[WeCom] turn_end: content = ${content?.substring(0, 100)}...`);

    if (content) {
      // 发送最终响应
      await sendResponseToWeCom(currentChatId, content, true);
    }

    // 清理状态
    currentChatId = null;
  });

  // 注册 /wecom 命令
  pi.registerCommand('wecom', {
    description: '企业微信机器人管理',
    handler: async (args, ctx) => {
      const subCommand = args.trim().toLowerCase();

      switch (subCommand) {
        case 'status':
          ctx.ui.notify(
            `状态: ${state.connected ? '已连接' : '未连接'}, ` +
            `认证: ${state.authenticated ? '成功' : '未认证'}` +
            (state.botId ? `, BotID: ${state.botId}` : ''),
            state.connected ? 'success' : 'warning'
          );
          break;

        case 'connect':
          if (state.connected) {
            ctx.ui.notify('已经连接', 'warning');
            return;
          }
          
          const config = getConfig();
          if (!config) {
            ctx.ui.notify('请设置 WECOM_BOT_ID 和 WECOM_BOT_SECRET 环境变量', 'error');
            return;
          }

          client = initClient(config.botId, config.secret);
          client.connect();
          ctx.ui.notify('正在连接...', 'info');
          break;

        case 'disconnect':
          if (client) {
            client.disconnect();
            client = null;
            state.connected = false;
            state.authenticated = false;
            ctx.ui.notify('已断开连接', 'info');
          } else {
            ctx.ui.notify('未连接', 'warning');
          }
          break;

        case 'send':
          if (!client || !state.connected) {
            ctx.ui.notify('未连接', 'error');
            return;
          }
          if (!lastContact) {
            ctx.ui.notify('没有最近联系的用户', 'warning');
            return;
          }
          const msg = args.replace(/^send\s+/i, '').trim();
          if (!msg) {
            ctx.ui.notify('用法: /wecom send <消息内容>', 'info');
            return;
          }
          try {
            await client.sendMessage(lastContact.chatId, {
              msgtype: 'markdown',
              markdown: { content: msg },
            });
            ctx.ui.notify(`已发送给 ${lastContact.userId}`, 'success');
            console.log(`[WeCom] 📤 已发送消息给 ${lastContact.userId}: ${msg}`);
          } catch (err) {
            ctx.ui.notify('发送失败', 'error');
            console.error('[WeCom] 发送失败:', err);
          }
          break;

        default:
          ctx.ui.notify(
            '用法: /wecom [status|connect|disconnect]',
            'info'
          );
      }
    },
  });

  // 会话启动时自动连接
  pi.on('session_start', async (_event, ctx) => {
    const config = getConfig();
    if (config) {
      console.log('[WeCom] 🚀 自动连接企业微信机器人...');
      client = initClient(config.botId, config.secret);
      client.connect();
    } else {
      console.log('[WeCom] ⚠️ 未配置 WECOM_BOT_ID 和 WECOM_BOT_SECRET');
    }
  });

  // 会话关闭时断开连接
  pi.on('session_shutdown', async () => {
    if (client) {
      console.log('[WeCom] 👋 断开连接...');
      client.disconnect();
      client = null;
    }
  });
}