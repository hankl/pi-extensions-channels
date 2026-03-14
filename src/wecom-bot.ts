import AiBot, { WSClient, WsFrame, generateReqId } from '@wecom/aibot-node-sdk';
import type { TemplateCard, ReplyMsgItem, ReplyFeedback, WeComMediaType, UploadMediaOptions, UploadMediaFinishResult } from '@wecom/aibot-node-sdk';
import type { Logger } from '@wecom/aibot-node-sdk';
import fs from 'fs';
import path from 'path';

/**
 * 企业微信机器人配置选项
 */
export interface WeComBotOptions {
  botId: string;
  secret: string;
  /** 重连基础延迟（毫秒），默认 1000 */
  reconnectInterval?: number;
  /** 最大重连次数，默认 10，-1 表示无限重连 */
  maxReconnectAttempts?: number;
  /** 心跳间隔（毫秒），默认 30000 */
  heartbeatInterval?: number;
  /** 请求超时时间（毫秒），默认 10000 */
  requestTimeout?: number;
  /** 自定义日志实例 */
  logger?: Logger;
}

/**
 * 消息处理器类型
 */
export type MessageHandler = (frame: WsFrame) => void | Promise<void>;

/**
 * 企业微信机器人客户端
 * 封装 @wecom/aibot-node-sdk，提供更便捷的 API
 */
export class WeComBot {
  private client: WSClient;
  private logger: Logger;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();

  constructor(options: WeComBotOptions) {
    this.logger = options.logger || console;
    
    this.client = new WSClient({
      botId: options.botId,
      secret: options.secret,
      reconnectInterval: options.reconnectInterval,
      maxReconnectAttempts: options.maxReconnectAttempts,
      heartbeatInterval: options.heartbeatInterval,
      requestTimeout: options.requestTimeout,
      logger: this.logger,
    });

    this.setupEventHandlers();
  }

  /**
   * 设置内部事件处理器
   */
  private setupEventHandlers(): void {
    // 连接事件
    this.client.on('connected', () => {
      this.logger.info('🔗 WebSocket 连接已建立');
    });

    // 认证成功
    this.client.on('authenticated', () => {
      this.logger.info('🔐 认证成功');
    });

    // 断开连接
    this.client.on('disconnected', (reason: string) => {
      this.logger.warn(`🔌 连接断开: ${reason}`);
    });

    // 重连中
    this.client.on('reconnecting', (attempt: number) => {
      this.logger.info(`🔄 正在重连（第 ${attempt} 次）...`);
    });

    // 错误
    this.client.on('error', (error: Error) => {
      this.logger.error('❌ 发生错误:', error);
    });

    // 文本消息
    this.client.on('message.text', async (frame: WsFrame) => {
      const content = frame.body.text?.content;
      this.logger.info(`💬 收到文本消息: ${content}`);
      await this.executeHandlers('text', frame);
    });

    // 图片消息
    this.client.on('message.image', async (frame: WsFrame) => {
      this.logger.info('🖼️ 收到图片消息');
      await this.executeHandlers('image', frame);
    });

    // 图文混排消息
    this.client.on('message.mixed', async (frame: WsFrame) => {
      this.logger.info('📝 收到图文混排消息');
      await this.executeHandlers('mixed', frame);
    });

    // 语音消息
    this.client.on('message.voice', async (frame: WsFrame) => {
      this.logger.info('🎤 收到语音消息');
      await this.executeHandlers('voice', frame);
    });

    // 文件消息
    this.client.on('message.file', async (frame: WsFrame) => {
      this.logger.info('📎 收到文件消息');
      await this.executeHandlers('file', frame);
    });

    // 进入会话事件
    this.client.on('event.enter_chat', async (frame: WsFrame) => {
      this.logger.info('👋 用户进入会话');
      await this.executeHandlers('enter_chat', frame);
    });

    // 模板卡片事件
    this.client.on('event.template_card_event', async (frame: WsFrame) => {
      const eventKey = frame.body.event?.event_key;
      this.logger.info(`🃏 模板卡片事件: ${eventKey}`);
      await this.executeHandlers('template_card_event', frame);
    });

    // 用户反馈事件
    this.client.on('event.feedback_event', async (frame: WsFrame) => {
      this.logger.info('📢 收到用户反馈');
      await this.executeHandlers('feedback_event', frame);
    });
  }

  /**
   * 执行注册的处理器
   */
  private async executeHandlers(type: string, frame: WsFrame): Promise<void> {
    const handlers = this.messageHandlers.get(type) || [];
    for (const handler of handlers) {
      try {
        await handler(frame);
      } catch (error) {
        this.logger.error(`处理器执行错误 [${type}]:`, error);
      }
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  connect(): this {
    this.logger.info('🚀 正在连接企业微信机器人...');
    this.client.connect();
    return this;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.logger.info('👋 断开连接...');
    this.client.disconnect();
  }

  /**
   * 获取连接状态
   */
  get isConnected(): boolean {
    return this.client.isConnected;
  }

  /**
   * 注册消息处理器
   * @param type 消息类型：text | image | mixed | voice | file | enter_chat | template_card_event | feedback_event
   * @param handler 处理函数
   */
  on(type: string, handler: MessageHandler): this {
    const handlers = this.messageHandlers.get(type) || [];
    handlers.push(handler);
    this.messageHandlers.set(type, handlers);
    return this;
  }

  /**
   * 发送流式文本回复
   * @param frame 原始消息帧
   * @param content 回复内容（支持 Markdown）
   * @param finish 是否结束流式消息
   * @param msgItem 图文混排项（仅 finish=true 时有效）
   * @param feedback 反馈信息
   */
  async replyStream(
    frame: WsFrame,
    content: string,
    finish: boolean = false,
    msgItem?: ReplyMsgItem[],
    feedback?: ReplyFeedback
  ): Promise<void> {
    const streamId = generateReqId('stream');
    await this.client.replyStream(frame, streamId, content, finish, msgItem, feedback);
  }

  /**
   * 发送流式回复（带自定义 streamId）
   */
  async replyStreamWithId(
    frame: WsFrame,
    streamId: string,
    content: string,
    finish: boolean = false,
    msgItem?: ReplyMsgItem[],
    feedback?: ReplyFeedback
  ): Promise<void> {
    await this.client.replyStream(frame, streamId, content, finish, msgItem, feedback);
  }

  /**
   * 生成流式消息 ID
   */
  generateStreamId(): string {
    return generateReqId('stream');
  }

  /**
   * 发送欢迎语（需在进入会话 5s 内调用）
   */
  async replyWelcome(frame: WsFrame, content: string): Promise<void> {
    await this.client.replyWelcome(frame, {
      msgtype: 'text',
      text: { content },
    });
  }

  /**
   * 发送欢迎语（模板卡片）
   */
  async replyWelcomeCard(frame: WsFrame, templateCard: TemplateCard): Promise<void> {
    await this.client.replyWelcome(frame, {
      msgtype: 'template_card',
      template_card: templateCard,
    });
  }

  /**
   * 回复文本消息
   */
  async replyText(frame: WsFrame, content: string): Promise<void> {
    const streamId = generateReqId('stream');
    await this.client.replyStream(frame, streamId, content, true);
  }

  /**
   * 回复 Markdown 消息
   */
  async replyMarkdown(frame: WsFrame, content: string): Promise<void> {
    const streamId = generateReqId('stream');
    await this.client.replyStream(frame, streamId, content, true);
  }

  /**
   * 回复模板卡片
   */
  async replyTemplateCard(frame: WsFrame, templateCard: TemplateCard, feedback?: ReplyFeedback): Promise<void> {
    await this.client.replyTemplateCard(frame, templateCard, feedback);
  }

  /**
   * 流式消息 + 模板卡片组合回复
   */
  async replyStreamWithCard(
    frame: WsFrame,
    streamId: string,
    content: string,
    finish: boolean = false,
    options?: {
      msgItem?: ReplyMsgItem[];
      streamFeedback?: ReplyFeedback;
      templateCard?: TemplateCard;
      cardFeedback?: ReplyFeedback;
    }
  ): Promise<void> {
    await this.client.replyStreamWithCard(frame, streamId, content, finish, options);
  }

  /**
   * 更新模板卡片
   */
  async updateTemplateCard(frame: WsFrame, templateCard: TemplateCard, userids?: string[]): Promise<void> {
    await this.client.updateTemplateCard(frame, templateCard, userids);
  }

  /**
   * 主动发送消息
   * @param chatid 会话 ID（单聊填用户 userid，群聊填 chatid）
   * @param content Markdown 内容
   */
  async sendMessage(chatid: string, content: string): Promise<void> {
    await this.client.sendMessage(chatid, {
      msgtype: 'markdown',
      markdown: { content },
    });
  }

  /**
   * 主动发送模板卡片消息
   */
  async sendTemplateCard(chatid: string, templateCard: TemplateCard): Promise<void> {
    await this.client.sendMessage(chatid, {
      msgtype: 'template_card',
      template_card: templateCard,
    });
  }

  /**
   * 上传临时素材
   * @param filePath 文件路径
   * @param type 媒体类型
   */
  async uploadMedia(filePath: string, type: WeComMediaType): Promise<UploadMediaFinishResult> {
    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    return this.client.uploadMedia(fileBuffer, { type, filename });
  }

  /**
   * 上传 Buffer 作为临时素材
   */
  async uploadMediaBuffer(buffer: Buffer, type: WeComMediaType, filename: string): Promise<UploadMediaFinishResult> {
    return this.client.uploadMedia(buffer, { type, filename });
  }

  /**
   * 回复媒体消息
   */
  async replyMedia(frame: WsFrame, mediaType: WeComMediaType, mediaId: string, videoOptions?: { title?: string; description?: string }): Promise<void> {
    await this.client.replyMedia(frame, mediaType, mediaId, videoOptions);
  }

  /**
   * 主动发送媒体消息
   */
  async sendMediaMessage(chatid: string, mediaType: WeComMediaType, mediaId: string, videoOptions?: { title?: string; description?: string }): Promise<void> {
    await this.client.sendMediaMessage(chatid, mediaType, mediaId, videoOptions);
  }

  /**
   * 下载文件并解密
   */
  async downloadFile(url: string, aesKey: string): Promise<{ buffer: Buffer; filename?: string }> {
    return this.client.downloadFile(url, aesKey);
  }

  /**
   * 下载图片并保存
   */
  async downloadImage(frame: WsFrame, saveDir: string): Promise<string | null> {
    const body = frame.body;
    const imageUrl = body.image?.url;
    const aesKey = body.image?.aeskey;
    
    if (!imageUrl || !aesKey) {
      return null;
    }

    const { buffer, filename } = await this.downloadFile(imageUrl, aesKey);
    const savePath = path.join(saveDir, filename || `image_${Date.now()}.jpg`);
    fs.writeFileSync(savePath, buffer);
    return savePath;
  }

  /**
   * 下载文件并保存
   */
  async downloadAndSaveFile(frame: WsFrame, saveDir: string): Promise<string | null> {
    const body = frame.body;
    const fileUrl = body.file?.url;
    const aesKey = body.file?.aeskey;
    
    if (!fileUrl || !aesKey) {
      return null;
    }

    const { buffer, filename } = await this.downloadFile(fileUrl, aesKey);
    const savePath = path.join(saveDir, filename || `file_${Date.now()}`);
    fs.writeFileSync(savePath, buffer);
    return savePath;
  }
}

// 导出类型
export { WsFrame, TemplateCard, ReplyMsgItem, ReplyFeedback, WeComMediaType, generateReqId };