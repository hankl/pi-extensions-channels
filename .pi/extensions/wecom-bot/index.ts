import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import pkg from "@wecom/aibot-node-sdk";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

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

interface WeComState {
  connected: boolean;
  authenticated: boolean;
  botId?: string;
}

interface PendingRequest {
  frame: WsFrame;
  streamId: string;
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

export default function wecomBotExtension(pi: ExtensionAPI) {
  let client: any = null;
  let lastContact: LastContact | null = null;
  let currentChatId: string | null = null;
  let responseSent = false;
  const pendingRequests = new Map<string, PendingRequest>();
  const cleanups: Array<() => void> = [];

  const state: WeComState = {
    connected: false,
    authenticated: false,
  };

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
    lastContact = { userId, chatId, chatType };
    currentChatId = chatId;
    responseSent = false;

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
    const pending = pendingRequests.get(chatId);
    if (!pending || !client) {
      return;
    }

    try {
      await client.replyStream(pending.frame, pending.streamId, content, true);
      pendingRequests.delete(chatId);
    } catch (error) {
      console.error("[WeCom] failed to send response:", error);
    }
  }

  pi.on("message_end", async (event) => {
    const message = event.message;
    if (!message || message.role !== "assistant" || !currentChatId || responseSent) {
      return;
    }

    const pending = pendingRequests.get(currentChatId);
    if (!pending) {
      return;
    }

    const toolUses = message.content.filter((content: any) => content.type === "toolUse");
    if (toolUses.length > 0) {
      return;
    }

    const textContent = message.content
      .filter((content: any): content is { type: "text"; text: string } => content.type === "text")
      .map((content) => content.text)
      .join("\n")
      .trim();

    if (!textContent) {
      return;
    }

    responseSent = true;
    await sendResponseToWeCom(currentChatId, textContent);
    currentChatId = null;
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

    if (client) {
      client.disconnect();
      client = null;
    }
  });
}
