/**
 * 快速开始示例 - 企业微信机器人
 */

import 'dotenv/config';
import { WeComBot } from './wecom-bot.js';
import type { WsFrame } from './wecom-bot.js';

// 创建机器人实例
const bot = new WeComBot({
  botId: process.env.WECOM_BOT_ID || '',
  secret: process.env.WECOM_BOT_SECRET || '',
});

// 处理文本消息
bot.on('text', async (frame: WsFrame) => {
  const content = frame.body.text?.content || '';
  console.log(`收到消息: ${content}`);
  
  // 简单回复
  await bot.replyText(frame, `你说的是：「${content}」`);
});

// 处理进入会话
bot.on('enter_chat', async (frame: WsFrame) => {
  await bot.replyWelcome(frame, '👋 您好！我是智能助手！');
});

// 建立连接
bot.connect();

console.log('🚀 企业微信机器人已启动');

// 优雅退出
process.on('SIGINT', () => {
  bot.disconnect();
  process.exit(0);
});