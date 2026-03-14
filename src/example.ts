/**
 * 企业微信机器人使用示例
 * 
 * 使用前请先复制 .env.example 为 .env 并填写配置
 */

import 'dotenv/config';
import { WeComBot } from './wecom-bot.js';
import type { WsFrame, TemplateCard } from './wecom-bot.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// 创建机器人实例
const bot = new WeComBot({
  botId: process.env.WECOM_BOT_ID || '',
  secret: process.env.WECOM_BOT_SECRET || '',
});

// ========== 示例 1: 处理文本消息并流式回复 ==========
bot.on('text', async (frame: WsFrame) => {
  const content = frame.body.text?.content || '';
  const streamId = bot.generateStreamId();

  // 发送中间状态
  await bot.replyStreamWithId(frame, streamId, '🤔 正在思考中...', false);

  // 模拟处理延迟
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 发送最终结果
  await bot.replyStreamWithId(frame, streamId, `收到您的消息：「${content}」\n\n这是我的回复！`, true);
});

// ========== 示例 2: 处理进入会话事件，发送欢迎语 ==========
bot.on('enter_chat', async (frame: WsFrame) => {
  await bot.replyWelcome(frame, '👋 您好！我是智能助手，有什么可以帮您的吗？');
});

// ========== 示例 3: 处理图片消息 ==========
bot.on('image', async (frame: WsFrame) => {
  // 下载并保存图片
  const saveDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }

  const savedPath = await bot.downloadImage(frame, saveDir);
  if (savedPath) {
    console.log(`图片已保存: ${savedPath}`);
    await bot.replyText(frame, `图片已接收并保存！`);
  }
});

// ========== 示例 4: 处理文件消息 ==========
bot.on('file', async (frame: WsFrame) => {
  const saveDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }

  const savedPath = await bot.downloadAndSaveFile(frame, saveDir);
  if (savedPath) {
    console.log(`文件已保存: ${savedPath}`);
    await bot.replyText(frame, `文件已接收并保存！`);
  }
});

// ========== 示例 5: 模板卡片交互 ==========
bot.on('text', async (frame: WsFrame) => {
  const content = frame.body.text?.content || '';

  // 当用户发送 "卡片" 时，回复模板卡片
  if (content.trim() === '卡片') {
    const templateCard: TemplateCard = {
      card_type: 'button_interaction',
      main_title: {
        title: '操作面板',
        desc: '请选择您要执行的操作',
      },
      button_list: [
        { text: '✅ 确认', key: 'btn_confirm', style: 1 },
        { text: '❌ 取消', key: 'btn_cancel', style: 2 },
      ],
      task_id: `task_${Date.now()}`,
    };
    await bot.replyTemplateCard(frame, templateCard);
  }
});

// ========== 示例 6: 处理模板卡片按钮点击 ==========
bot.on('template_card_event', async (frame: WsFrame) => {
  const eventKey = frame.body.event?.event_key;
  const taskId = frame.body.event?.task_id;

  const title = eventKey === 'btn_confirm' ? '已确认 ✅' : '已取消 ❌';
  
  await bot.updateTemplateCard(frame, {
    card_type: 'text_notice',
    main_title: { title },
    task_id: taskId,
  });
});

// ========== 示例 7: 流式回复 + 图文混排 ==========
bot.on('text', async (frame: WsFrame) => {
  const content = frame.body.text?.content || '';

  if (content.trim() === '图文') {
    const streamId = bot.generateStreamId();

    // 发送中间状态
    await bot.replyStreamWithId(frame, streamId, '正在生成图文内容...', false);

    // 读取图片（如果有）
    const imagePath = path.join(process.cwd(), 'assets', 'example.jpg');
    if (fs.existsSync(imagePath)) {
      const imageData = fs.readFileSync(imagePath);
      const base64 = imageData.toString('base64');
      const md5 = createHash('md5').update(imageData).digest('hex');

      // 发送最终结果，附带图片
      await bot.replyStreamWithId(frame, streamId, '这是图文混排回复：', true, [
        { msgtype: 'image', image: { base64, md5 } },
      ]);
    } else {
      await bot.replyStreamWithId(frame, streamId, '请准备图片文件到 assets/example.jpg', true);
    }
  }
});

// ========== 示例 8: 上传文件并回复 ==========
bot.on('text', async (frame: WsFrame) => {
  const content = frame.body.text?.content || '';

  if (content.trim() === '发送文件') {
    const filePath = path.join(process.cwd(), 'assets', 'example.pdf');
    
    if (fs.existsSync(filePath)) {
      // 上传文件
      const result = await bot.uploadMedia(filePath, 'file');
      console.log(`文件上传成功，media_id: ${result.media_id}`);

      // 回复文件消息
      await bot.replyMedia(frame, 'file', result.media_id);
    } else {
      await bot.replyText(frame, '请准备文件到 assets/example.pdf');
    }
  }
});

// ========== 示例 9: 主动推送消息 ==========
// 认证成功后可以主动推送
bot.connect();

// 记录连接状态
console.log('🚀 企业微信机器人已启动，等待连接...');

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n👋 正在关闭...');
  bot.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 正在关闭...');
  bot.disconnect();
  process.exit(0);
});