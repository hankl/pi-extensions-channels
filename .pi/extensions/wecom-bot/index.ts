import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import pkg from "@wecom/aibot-node-sdk";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, ".env") });

const { WSClient, generateReqId } = pkg as {
  WSClient: new (options: {
    botId: string;
    secret: string;
    maxReconnectAttempts: number;
  }) => any;
  generateReqId: (prefix: string) => string;
};

type WsFrame = any;

const AGENT_NAME = "Daniel";
const CUTE_THINKING_STATES = [
  "🐣 正在想呢...",
  "🐰 我来看看...",
  "🫧 正在整理思路...",
  "🐼 正在认真思考...",
  "✨ 马上就好...",
];

interface ReminderState {
  enabled: boolean;
  hour: number;
  minute: number;
  message: string;
}

interface GitHubTodayState {
  enabled: boolean;
  hour: number;
  minute: number;
  language?: string;
}

interface WeComState {
  connected: boolean;
  authenticated: boolean;
  botId?: string;
  reminder: ReminderState;
  githubToday: GitHubTodayState;
}

interface PendingRequest {
  frame: WsFrame;
  streamId: string;
}

interface ActiveSession {
  chatId: string;
  userId: string;
  chatType: "single" | "group";
  frame: WsFrame;
  streamId: string;
  startedAt: number;
  ackSent: boolean;
  awaitingUserInput: boolean;
  finalSent: boolean;
  lastAssistantText?: string;
  pendingFinalText?: string;
  lastProgressAt?: number;
  heartbeatCount: number;
  lastProgressMessage?: string;
}

interface LastContact {
  userId: string;
  chatId: string;
  chatType: "single" | "group";
}

interface NotifyPayload {
  message: string;
  chatId?: string;
  label?: string;
}

function isNotifyPayload(value: unknown): value is NotifyPayload {
  return !!value && typeof value === "object" && typeof (value as NotifyPayload).message === "string";
}

function getCuteThinkingStatus(): string {
  const index = Math.floor(Math.random() * CUTE_THINKING_STATES.length);
  return CUTE_THINKING_STATES[index];
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractAssistantText(message: any): string {
  if (!message?.content || !Array.isArray(message.content)) {
    return "";
  }

  return normalizeText(
    message.content
      .filter((content: any): content is { type: "text"; text: string } => content.type === "text")
      .map((content) => content.text)
      .join("\n"),
  );
}

function hasToolUse(message: any): boolean {
  return Array.isArray(message?.content) && message.content.some((content: any) => content.type === "toolUse");
}

function isLikelyUserInputRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "\u8bf7\u786e\u8ba4",
    "\u8bf7\u63d0\u4f9b",
    "\u8bf7\u544a\u8bc9\u6211",
    "\u8bf7\u56de\u590d",
    "\u9700\u8981\u4f60",
    "\u9700\u8981\u60a8",
    "\u8fd8\u9700\u8981",
    "\u7f3a\u5c11",
    "\u65e0\u6cd5\u7ee7\u7eed",
    "\u8bf7\u5148",
    "\u544a\u8bc9\u6211",
    "confirm",
    "provide",
    "need your",
    "i need",
    "which one",
    "what is",
    "please reply",
  ].some((pattern) => normalized.includes(pattern)) || /[?\uFF1F]\s*$/.test(text);
}

function buildProgressMessage(title: string, text?: string): string {
  return text ? `**${title}**\n${text}` : `**${title}**`;
}

export default function wecomBotExtension(pi: ExtensionAPI) {
  let client: any = null;
  let lastContact: LastContact | null = null;
  let currentWeComRunChatId: string | null = null;
  let progressHeartbeat: ReturnType<typeof setInterval> | null = null;
  const pendingRequests = new Map<string, PendingRequest>();
  const activeSessions = new Map<string, ActiveSession>();
  const cleanups: Array<() => void> = [];

  const state: WeComState = {
    connected: false,
    authenticated: false,
    reminder: {
      enabled: false,
      hour: 19,
      minute: 30,
      message: "👋 下班时间到！记得收拾好东西，愉快回家～",
    },
    githubToday: {
      enabled: false,
      hour: 20,
      minute: 15,
      language: undefined,
    },
  };

  // Load reminder config from environment
  function loadReminderConfig(): void {
    const reminderTime = process.env.WECOM_REMINDER_TIME?.trim();
    const reminderMessage = process.env.WECOM_REMINDER_MESSAGE?.trim();

    if (reminderTime) {
      const [hour, minute] = reminderTime.split(":").map(Number);
      if (!isNaN(hour) && !isNaN(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        state.reminder.hour = hour;
        state.reminder.minute = minute;
      }
    }

    if (reminderMessage) {
      state.reminder.message = reminderMessage;
    }

    state.reminder.enabled = process.env.WECOM_REMINDER_ENABLED === "true";
  }

  let reminderJob: cron.ScheduledTask | null = null;

  function startReminderJob(): void {
    if (reminderJob) {
      reminderJob.stop();
    }

    const cronExpr = `${state.reminder.minute} ${state.reminder.hour} * * *`;
    console.log(`[WeCom] Reminder scheduled at ${state.reminder.hour}:${String(state.reminder.minute).padStart(2, "0")}`);

    reminderJob = cron.schedule(cronExpr, async () => {
      if (!state.reminder.enabled) {
        return;
      }

      const target = resolveChatTarget();
      if (!target.chatId) {
        console.log("[WeCom] Reminder skipped: no notify target configured");
        return;
      }

      try {
        await sendMarkdown(state.reminder.message, target.chatId);
        console.log("[WeCom] Reminder sent successfully");
      } catch (error) {
        console.error("[WeCom] Reminder failed:", error);
      }
    });
  }

  function stopReminderJob(): void {
    if (reminderJob) {
      reminderJob.stop();
      reminderJob = null;
      console.log("[WeCom] Reminder job stopped");
    }
  }

  function getReminderStatus(): string {
    const time = `${String(state.reminder.hour).padStart(2, "0")}:${String(state.reminder.minute).padStart(2, "0")}`;
    return `enabled=${state.reminder.enabled}, time=${time}, message="${state.reminder.message}"`;
  }

  // GitHub Trending Job
  // GitHub Today Job (new repositories from today)
  let githubTodayJob: cron.ScheduledTask | null = null;

  function formatStars(count: number): string {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k ⭐`;
    }
    return `${count} ⭐`;
  }

  function loadGitHubTodayConfig(): void {
    const todayTime = process.env.WECOM_GITHUB_TODAY_TIME?.trim();
    const todayLang = process.env.WECOM_GITHUB_TODAY_LANGUAGE?.trim();

    if (todayTime) {
      const [hour, minute] = todayTime.split(":").map(Number);
      if (!isNaN(hour) && !isNaN(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        state.githubToday.hour = hour;
        state.githubToday.minute = minute;
      }
    }

    if (todayLang) {
      state.githubToday.language = todayLang;
    }

    state.githubToday.enabled = process.env.WECOM_GITHUB_TODAY_ENABLED === "true";
  }

  function getTodayDateString(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function fetchGitHubToday(language?: string): Promise<string> {
    const today = getTodayDateString();
    const langFilter = language ? `+language:${language}` : "";
    const url = `https://api.github.com/search/repositories?q=created:>${today}${langFilter}&sort=stars&order=desc&per_page=10`;

    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "WeCom-Bot/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json() as { total_count: number; items: Array<{ name: string; description: string | null; stargazers_count: number; html_url: string; language: string | null; author: string; created_at: string }> };

      if (!data.items || data.items.length === 0) {
        const langLabel = language ? `${language} ` : "";
        return `🆕 **GitHub 今日新上榜 (${langLabel})**\n\n今天还没有新项目上榜，稍后再来看看吧～`;
      }

      const langLabel = language ? `${language} ` : "";
      let message = `🆕 **GitHub 今日新上榜 (${langLabel}Top ${data.items.length})**\n\n`;

      data.items.slice(0, 10).forEach((repo, index) => {
        const desc = repo.description || "暂无描述";
        const lang = repo.language ? ` [${repo.language}]` : "";
        const stars = formatStars(repo.stargazers_count);
        message += `${index + 1}. **[${repo.name}](${repo.html_url})** ${lang}\n`;
        message += `   ⭐ ${stars} | ${desc}\n\n`;
      });

      message += `---\n> 🔗 查看更多: https://github.com/trending`;
      return message;
    } catch (error) {
      console.error("[WeCom] GitHub today fetch failed:", error);
      return "😢 获取 GitHub 今日新上榜失败了，明天再试吧～";
    }
  }

  async function sendGitHubToday(): Promise<void> {
    const target = resolveChatTarget();
    if (!target.chatId) {
      console.log("[WeCom] GitHub today skipped: no notify target configured");
      return;
    }

    try {
      const summary = await fetchGitHubToday(state.githubToday.language);
      await sendMarkdown(summary, target.chatId);
      console.log("[WeCom] GitHub today sent successfully");
    } catch (error) {
      console.error("[WeCom] GitHub today failed:", error);
    }
  }

  function startGitHubTodayJob(): void {
    if (githubTodayJob) {
      githubTodayJob.stop();
    }

    const cronExpr = `${state.githubToday.minute} ${state.githubToday.hour} * * *`;
    console.log(`[WeCom] GitHub today scheduled at ${state.githubToday.hour}:${String(state.githubToday.minute).padStart(2, "0")}`);

    githubTodayJob = cron.schedule(cronExpr, async () => {
      if (!state.githubToday.enabled) {
        return;
      }

      console.log("[WeCom] Fetching GitHub today...");
      await sendGitHubToday();
    });
  }

  function stopGitHubTodayJob(): void {
    if (githubTodayJob) {
      githubTodayJob.stop();
      githubTodayJob = null;
      console.log("[WeCom] GitHub today job stopped");
    }
  }

  function getGitHubTodayStatus(): string {
    const time = `${String(state.githubToday.hour).padStart(2, "0")}:${String(state.githubToday.minute).padStart(2, "0")}`;
    const lang = state.githubToday.language || "all";
    return `enabled=${state.githubToday.enabled}, time=${time}, language=${lang}`;
  }

  function getConfig(): { botId: string; secret: string } | null {
    const botId = process.env.WECOM_BOT_ID;
    const secret = process.env.WECOM_BOT_SECRET;

    if (!botId || !secret) {
      return null;
    }

    return { botId, secret };
  }

  function getNotifyTarget(): { chatId?: string; label: string } {
    const chatId = process.env.WECOM_NOTIFY_CHAT_ID?.trim();
    const label = process.env.WECOM_NOTIFY_LABEL?.trim() || "notify-target";
    return { chatId, label };
  }

  function resolveChatTarget(explicitChatId?: string): { chatId?: string; label: string } {
    if (explicitChatId) {
      return { chatId: explicitChatId, label: explicitChatId };
    }

    const notifyTarget = getNotifyTarget();
    if (notifyTarget.chatId) {
      return notifyTarget;
    }

    if (lastContact) {
      return { chatId: lastContact.chatId, label: lastContact.userId };
    }

    return { chatId: undefined, label: "unresolved" };
  }

  async function sendMarkdown(message: string, explicitChatId?: string): Promise<{ ok: boolean; reason?: string }> {
    if (!client || !state.connected) {
      return { ok: false, reason: "wecom client is not connected" };
    }

    const target = resolveChatTarget(explicitChatId);
    if (!target.chatId) {
      return { ok: false, reason: "no notify chat configured and no recent contact available" };
    }

    await client.sendMessage(target.chatId, {
      msgtype: "markdown",
      markdown: { content: message },
    });

    console.log(`[WeCom] sent proactive message to ${target.label}`);
    return { ok: true };
  }

  async function handleNotifyEvent(payload: unknown): Promise<void> {
    if (!isNotifyPayload(payload)) {
      return;
    }

    try {
      const result = await sendMarkdown(payload.message, payload.chatId);
      if (!result.ok) {
        console.warn(`[WeCom] proactive notify skipped: ${result.reason}`);
      }
    } catch (error) {
      console.error("[WeCom] proactive notify failed:", error);
    }
  }

  function getActiveSession(chatId?: string | null): ActiveSession | null {
    if (!chatId) {
      return null;
    }
    return activeSessions.get(chatId) || null;
  }

  async function sendSessionStream(chatId: string, content: string, finished: boolean): Promise<boolean> {
    const pending = pendingRequests.get(chatId);
    if (!pending || !client) {
      return false;
    }

    const text = normalizeText(content);
    if (!text) {
      return false;
    }

    try {
      await client.replyStream(pending.frame, pending.streamId, text, finished);
      if (finished) {
        pendingRequests.delete(chatId);
      }
      return true;
    } catch (error) {
      console.error("[WeCom] failed to send stream response:", error);
      return false;
    }
  }

  async function sendSessionProgress(chatId: string, title: string, text?: string): Promise<void> {
    const session = getActiveSession(chatId);
    if (!session || session.finalSent) {
      return;
    }

    const now = Date.now();
    const message = buildProgressMessage(title, text);
    if (message === session.lastProgressMessage) {
      return;
    }

    session.lastProgressAt = now;
    session.lastProgressMessage = message;
    const streamed = await sendSessionStream(chatId, message, false);
    if (!streamed) {
      await sendMarkdown(message, chatId);
    }
  }

  async function finalizeSession(chatId: string, content: string): Promise<void> {
    const session = getActiveSession(chatId);
    if (!session || session.finalSent) {
      return;
    }

    const text = normalizeText(content);
    if (!text) {
      return;
    }

    const streamed = await sendSessionStream(chatId, text, true);
    if (!streamed) {
      await sendMarkdown(buildProgressMessage("\u5904\u7406\u5b8c\u6210", text), chatId);
    }

    session.finalSent = true;
    session.awaitingUserInput = false;
    session.pendingFinalText = undefined;
    if (currentWeComRunChatId === chatId) {
      currentWeComRunChatId = null;
    }
  }

  function stopProgressHeartbeat(): void {
    if (progressHeartbeat) {
      clearInterval(progressHeartbeat);
      progressHeartbeat = null;
    }
  }

  function startProgressHeartbeat(chatId: string): void {
    stopProgressHeartbeat();
    progressHeartbeat = setInterval(() => {
      const session = getActiveSession(chatId);
      if (!session || session.finalSent || session.awaitingUserInput) {
        stopProgressHeartbeat();
        return;
      }

      const lastProgressAt = session.lastProgressAt || session.startedAt;
      if (session.heartbeatCount >= 1 || Date.now() - lastProgressAt < 90000) {
        return;
      }

      session.lastProgressAt = Date.now();
      session.heartbeatCount += 1;
      void sendSessionProgress(
        chatId,
        "\u5904\u7406\u4e2d",
        "\u8fd8\u5728\u6267\u884c\u4e2d\uff0c\u8bf7\u7a0d\u7b49\u3002",
      );
    }, 30000);
  }

  function initClient(botId: string, secret: string): any {
    const wsClient = new WSClient({
      botId,
      secret,
      maxReconnectAttempts: -1,
    });

    wsClient.on("connected", () => {
      state.connected = true;
      pi.events.emit("wecom:status", { connected: true });
      console.log("[WeCom] websocket connected");
    });

    wsClient.on("authenticated", () => {
      state.authenticated = true;
      state.botId = botId;
      pi.events.emit("wecom:status", { authenticated: true });
      console.log("[WeCom] authenticated");
    });

    wsClient.on("disconnected", (reason: string) => {
      state.connected = false;
      state.authenticated = false;
      pi.events.emit("wecom:status", { connected: false, reason });
      console.log(`[WeCom] disconnected: ${reason}`);
    });

    wsClient.on("reconnecting", (attempt: number) => {
      console.log(`[WeCom] reconnecting, attempt ${attempt}`);
    });

    wsClient.on("error", (error: Error) => {
      console.error("[WeCom] client error:", error.message);
    });

    wsClient.on("message.text", async (frame: WsFrame) => {
      await handleWeComMessage(frame);
    });

    wsClient.on("event.enter_chat", async (frame: WsFrame) => {
      await handleEnterChat(frame);
    });

    wsClient.on("event.template_card_event", async (frame: WsFrame) => {
      await handleTemplateCardEvent(frame);
    });

    return wsClient;
  }

  async function handleWeComMessage(frame: WsFrame): Promise<void> {
    const body = frame.body;
    const content = body.text?.content || "";
    const chatId = body.chatid || body.from?.userid || "";
    const userId = body.from?.userid || "";
    const chatType = (body.chattype || "single") as "single" | "group";

    const streamId = generateReqId("stream");
    pendingRequests.set(chatId, { frame, streamId });
    activeSessions.set(chatId, {
      chatId,
      userId,
      chatType,
      frame,
      streamId,
      startedAt: Date.now(),
      ackSent: false,
      awaitingUserInput: false,
      finalSent: false,
      heartbeatCount: 0,
    });
    lastContact = { userId, chatId, chatType };
    currentWeComRunChatId = chatId;

    try {
      await client?.replyStream(frame, streamId, getCuteThinkingStatus(), false);
    } catch (error) {
      console.error("[WeCom] failed to send thinking status:", error);
    }

    const userMessage =
      chatType === "group"
        ? `[wecom group message] user ${userId} says: ${content}`
        : `[wecom direct message] ${content}`;

    pi.sendUserMessage(userMessage);
  }

  async function handleEnterChat(frame: WsFrame): Promise<void> {
    try {
      await client?.replyWelcome(frame, {
        msgtype: "text",
        text: { content: `Hello, I am ${AGENT_NAME}. What can I help with?` },
      });
    } catch (error) {
      console.error("[WeCom] failed to send welcome message:", error);
    }
  }

  async function handleTemplateCardEvent(frame: WsFrame): Promise<void> {
    const eventKey = frame.body.event?.event_key;
    const taskId = frame.body.event?.task_id;

    try {
      await client?.updateTemplateCard(frame, {
        card_type: "text_notice",
        main_title: { title: `Received action: ${eventKey}` },
        task_id: taskId,
      });
    } catch (error) {
      console.error("[WeCom] failed to update template card:", error);
    }
  }

  async function sendResponseToWeCom(chatId: string, content: string): Promise<void> {
    await finalizeSession(chatId, content);
  }

  pi.on("message_end", async (event) => {
    const message = event.message;
    if (!message || message.role !== "assistant" || !currentWeComRunChatId) {
      return;
    }

    const session = getActiveSession(currentWeComRunChatId);
    if (!session) {
      return;
    }

    const textContent = extractAssistantText(message);
    const containsToolUse = hasToolUse(message);

    if (!textContent && !containsToolUse) {
      return;
    }

    if (textContent && textContent === session.lastAssistantText) {
      return;
    }

    if (textContent) {
      session.lastAssistantText = textContent;
    }

    if (containsToolUse) {
      await sendSessionProgress(
        session.chatId,
        "\u5904\u7406\u4e2d",
        textContent || "\u6b63\u5728\u6267\u884c\u64cd\u4f5c\uff0c\u5b8c\u6210\u540e\u6211\u4f1a\u628a\u7ed3\u679c\u53d1\u7ed9\u4f60\u3002",
      );
      return;
    }

    if (textContent && isLikelyUserInputRequest(textContent)) {
      session.awaitingUserInput = true;
      session.pendingFinalText = undefined;
      await sendSessionProgress(session.chatId, "\u9700\u8981\u4f60\u534f\u52a9", textContent);
      return;
    }

    session.awaitingUserInput = false;
    session.pendingFinalText = textContent;
  });

  pi.on("agent_start", async () => {
    if (!currentWeComRunChatId) {
      return;
    }

    const session = getActiveSession(currentWeComRunChatId);
    if (!session || session.finalSent) {
      return;
    }

    startProgressHeartbeat(session.chatId);

    if (session.ackSent) {
      return;
    }

    session.ackSent = true;
    session.lastProgressAt = Date.now();
    await sendSessionProgress(
      session.chatId,
      getCuteThinkingStatus(),
    );
  });

  pi.on("agent_end", async () => {
    stopProgressHeartbeat();

    if (!currentWeComRunChatId) {
      return;
    }

    const session = getActiveSession(currentWeComRunChatId);
    if (!session || session.finalSent) {
      currentWeComRunChatId = null;
      return;
    }

    if (session.awaitingUserInput) {
      currentWeComRunChatId = null;
      return;
    }

    const finalText = session.pendingFinalText || session.lastAssistantText;
    if (finalText) {
      await sendResponseToWeCom(session.chatId, finalText);
      activeSessions.delete(session.chatId);
      return;
    }

    currentWeComRunChatId = null;
  });

  pi.on("input", async (event) => {
    if (event.source === "extension" || !lastContact) {
      return;
    }

    const session = getActiveSession(lastContact.chatId);
    if (!session || !session.awaitingUserInput) {
      return;
    }

    session.awaitingUserInput = false;
  });

  pi.registerCommand("wecom", {
    description: "Manage the WeCom bot connection and notifications",
    handler: async (args, ctx) => {
      const trimmedArgs = args.trim();
      const [subCommand = "status", ...rest] = trimmedArgs.split(/\s+/);
      const normalized = subCommand.toLowerCase();

      switch (normalized) {
        case "status": {
          const notifyTarget = getNotifyTarget();
          ctx.ui.notify(
            `connected=${state.connected}, authenticated=${state.authenticated}, notifyTarget=${notifyTarget.chatId || "unset"}`,
            state.connected ? "info" : "warning",
          );
          return;
        }

        case "connect": {
          if (state.connected) {
            ctx.ui.notify("WeCom is already connected", "warning");
            return;
          }

          const wecomConfig = getConfig();
          if (!wecomConfig) {
            ctx.ui.notify("Missing WECOM_BOT_ID or WECOM_BOT_SECRET", "error");
            return;
          }

          client = initClient(wecomConfig.botId, wecomConfig.secret);
          client.connect();
          ctx.ui.notify("Connecting to WeCom...", "info");
          return;
        }

        case "disconnect": {
          if (!client) {
            ctx.ui.notify("WeCom is not connected", "warning");
            return;
          }

          client.disconnect();
          client = null;
          state.connected = false;
          state.authenticated = false;
          ctx.ui.notify("Disconnected from WeCom", "info");
          return;
        }

        case "send": {
          if (!lastContact) {
            ctx.ui.notify("No recent WeCom contact is available", "warning");
            return;
          }

          const message = rest.join(" ").trim();
          if (!message) {
            ctx.ui.notify("Usage: /wecom send <message>", "info");
            return;
          }

          try {
            const result = await sendMarkdown(message, lastContact.chatId);
            if (!result.ok) {
              ctx.ui.notify(result.reason || "Send failed", "error");
              return;
            }
            ctx.ui.notify(`Sent to ${lastContact.userId}`, "info");
          } catch (error) {
            ctx.ui.notify("Send failed", "error");
            console.error("[WeCom] send command failed:", error);
          }
          return;
        }

        case "notify": {
          const message = rest.join(" ").trim();
          if (!message) {
            ctx.ui.notify("Usage: /wecom notify <message>", "info");
            return;
          }

          try {
            const result = await sendMarkdown(message);
            if (!result.ok) {
              ctx.ui.notify(result.reason || "Notify failed", "error");
              return;
            }
            ctx.ui.notify("Notification sent", "info");
          } catch (error) {
            ctx.ui.notify("Notify failed", "error");
            console.error("[WeCom] notify command failed:", error);
          }
          return;
        }

        case "reminder": {
          const subCmd = rest[0]?.toLowerCase() || "status";

          switch (subCmd) {
            case "on": {
              state.reminder.enabled = true;
              startReminderJob();
              ctx.ui.notify("Reminder enabled", "info");
              return;
            }

            case "off": {
              state.reminder.enabled = false;
              ctx.ui.notify("Reminder disabled", "info");
              return;
            }

            case "time": {
              const timeStr = rest[1];
              if (!timeStr) {
                const current = `${String(state.reminder.hour).padStart(2, "0")}:${String(state.reminder.minute).padStart(2, "0")}`;
                ctx.ui.notify(`Current reminder time: ${current}. Usage: /wecom reminder time HH:MM`, "info");
                return;
              }

              const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
              if (!match) {
                ctx.ui.notify("Invalid format. Use HH:MM (e.g., 19:30)", "error");
                return;
              }

              const hour = parseInt(match[1], 10);
              const minute = parseInt(match[2], 10);

              if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
                ctx.ui.notify("Invalid time. Hour 0-23, Minute 0-59", "error");
                return;
              }

              state.reminder.hour = hour;
              state.reminder.minute = minute;

              if (state.reminder.enabled) {
                startReminderJob();
              }

              ctx.ui.notify(`Reminder time set to ${timeStr}`, "info");
              return;
            }

            case "message": {
              const msg = rest.slice(1).join(" ").trim();
              if (!msg) {
                ctx.ui.notify(`Current: "${state.reminder.message}". Usage: /wecom reminder message <text>`, "info");
                return;
              }
              state.reminder.message = msg;
              ctx.ui.notify("Reminder message updated", "info");
              return;
            }

            case "test": {
              const target = resolveChatTarget();
              if (!target.chatId) {
                ctx.ui.notify("No notify target available", "error");
                return;
              }
              const testMsg = `🕐 测试提醒: ${state.reminder.message}`;
              const result = await sendMarkdown(testMsg, target.chatId);
              ctx.ui.notify(result.ok ? "Test reminder sent" : (result.reason || "Failed"), result.ok ? "info" : "error");
              return;
            }

            case "status":
            default: {
              ctx.ui.notify(getReminderStatus(), "info");
              return;
            }
          }
        }

        case "today": {
          const subCmd = rest[0]?.toLowerCase() || "status";

          switch (subCmd) {
            case "on": {
              state.githubToday.enabled = true;
              startGitHubTodayJob();
              ctx.ui.notify("GitHub today enabled", "info");
              return;
            }

            case "off": {
              state.githubToday.enabled = false;
              ctx.ui.notify("GitHub today disabled", "info");
              return;
            }

            case "time": {
              const timeStr = rest[1];
              if (!timeStr) {
                const current = `${String(state.githubToday.hour).padStart(2, "0")}:${String(state.githubToday.minute).padStart(2, "0")}`;
                ctx.ui.notify(`Current time: ${current}. Usage: /wecom today time HH:MM`, "info");
                return;
              }

              const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
              if (!match) {
                ctx.ui.notify("Invalid format. Use HH:MM (e.g., 20:15)", "error");
                return;
              }

              const hour = parseInt(match[1], 10);
              const minute = parseInt(match[2], 10);

              if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
                ctx.ui.notify("Invalid time. Hour 0-23, Minute 0-59", "error");
                return;
              }

              state.githubToday.hour = hour;
              state.githubToday.minute = minute;

              if (state.githubToday.enabled) {
                startGitHubTodayJob();
              }

              ctx.ui.notify(`GitHub today time set to ${timeStr}`, "info");
              return;
            }

            case "lang":
            case "language": {
              const lang = rest[1]?.trim();
              if (!lang) {
                const current = state.githubToday.language || "all";
                ctx.ui.notify(`Current language: ${current}. Usage: /wecom today lang <language>`, "info");
                return;
              }
              state.githubToday.language = lang;
              ctx.ui.notify(`GitHub today language set to ${lang}`, "info");
              return;
            }

            case "now":
            case "fetch": {
              ctx.ui.notify("Fetching GitHub today...", "info");
              const summary = await fetchGitHubToday(state.githubToday.language);
              const target = resolveChatTarget();
              if (target.chatId) {
                await sendMarkdown(summary, target.chatId);
                ctx.ui.notify("GitHub today sent!", "info");
              } else {
                ctx.ui.notify("No notify target available", "error");
              }
              return;
            }

            case "test": {
              const target = resolveChatTarget();
              if (!target.chatId) {
                ctx.ui.notify("No notify target available", "error");
                return;
              }
              const summary = await fetchGitHubToday(state.githubToday.language);
              const result = await sendMarkdown(summary, target.chatId);
              ctx.ui.notify(result.ok ? "Test sent!" : (result.reason || "Failed"), result.ok ? "info" : "error");
              return;
            }

            case "status":
            default: {
              ctx.ui.notify(getGitHubTodayStatus(), "info");
              return;
            }
          }
        }

        default:
          ctx.ui.notify("Usage: /wecom [status|connect|disconnect|send|notify]", "info");
      }
    },
  });

  pi.on("session_start", async () => {
    const wecomConfig = getConfig();
    if (!wecomConfig) {
      console.log("[WeCom] credentials are not configured");
      return;
    }

    loadReminderConfig();
    if (state.reminder.enabled) {
      startReminderJob();
    }

    loadGitHubTodayConfig();
    if (state.githubToday.enabled) {
      startGitHubTodayJob();
    }

    client = initClient(wecomConfig.botId, wecomConfig.secret);
    client.connect();

    cleanups.push(pi.events.on("wecom:notify", (payload) => {
      void handleNotifyEvent(payload);
    }));
  });

  pi.on("session_shutdown", async () => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }

    stopProgressHeartbeat();
    stopReminderJob();
    stopGitHubTodayJob();

    if (client) {
      client.disconnect();
      client = null;
    }
  });
}
