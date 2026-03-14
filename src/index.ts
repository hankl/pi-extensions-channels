import 'dotenv/config';
import { WeComBot, WsFrame, TemplateCard, generateReqId } from './wecom-bot.js';

/**
 * 创建企业微信机器人实例
 */
export function createWeComBot(options?: {
  botId?: string;
  secret?: string;
}): WeComBot {
  const botId = options?.botId || process.env.WECOM_BOT_ID;
  const secret = options?.secret || process.env.WECOM_BOT_SECRET;

  if (!botId || !secret) {
    throw new Error('请设置 WECOM_BOT_ID 和 WECOM_BOT_SECRET 环境变量，或通过参数传入');
  }

  return new WeComBot({ botId, secret });
}

// 导出所有类型和类
export { WeComBot, WsFrame, TemplateCard, generateReqId };