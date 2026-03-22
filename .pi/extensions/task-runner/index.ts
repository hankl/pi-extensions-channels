import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";
import { readFile, writeFile, mkdir, access } from "fs/promises";
import { constants as fsConstants } from "fs";
import { join } from "path";

type RunnerStatus = "idle" | "running" | "awaiting_help" | "completing";

interface RunnerConfig {
  executor: string;
  pollIntervalSeconds: number;
  autoRun: boolean;
  resumeOnStart: boolean;
  taskbusCommand: string;
  notifyPrefix: string;
}

interface RunnerState {
  status: RunnerStatus;
  currentTaskId?: number;
  currentTaskName?: string;
  currentTaskFile?: string;
  startedAt?: string;
  helpRequestedAt?: string;
  lastPollAt?: string;
  lastError?: string;
}

interface TaskRecord {
  id: number;
  name?: string;
  fileUrl?: string;
  creator?: string;
  executor?: string;
  status?: string;
}

const DEFAULT_CONFIG: RunnerConfig = {
  executor: "daniel",
  pollIntervalSeconds: 30,
  autoRun: true,
  resumeOnStart: true,
  taskbusCommand: "taskbus",
  notifyPrefix: "[task-runner]",
};

const HelpParams = Type.Object({
  question: Type.String({ description: "Concrete help request to send to the human owner" }),
  context: Type.Optional(Type.String({ description: "Relevant context, errors, or attempted fixes" })),
});

const CompleteParams = Type.Object({
  summary: Type.String({ description: "Short summary of what was completed" }),
});

export default function taskRunnerExtension(pi: ExtensionAPI) {
  let workspaceRoot = process.cwd();
  let currentConfig = DEFAULT_CONFIG;
  let currentState: RunnerState = { status: "idle" };
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;
  let agentBusy = false;
  let resumeScheduled = false;

  function runnerDir(): string {
    return join(workspaceRoot, ".pi", "task-runner");
  }

  function configPath(): string {
    return join(runnerDir(), "config.json");
  }

  function statePath(): string {
    return join(runnerDir(), "state.json");
  }

  function tasksDir(): string {
    return join(workspaceRoot, "tasks");
  }

  function memoryDir(): string {
    return join(workspaceRoot, "memory");
  }

  function currentTaskMarkerPath(): string {
    return join(tasksDir(), "current_task.txt");
  }

  async function ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureConfigFile(): Promise<void> {
    await ensureDir(runnerDir());
    if (!(await fileExists(configPath()))) {
      await writeFile(configPath(), `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
    }
  }

  async function loadConfig(): Promise<RunnerConfig> {
    await ensureConfigFile();

    try {
      const raw = await readFile(configPath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<RunnerConfig>;
      currentConfig = {
        ...DEFAULT_CONFIG,
        ...parsed,
      };
    } catch (error) {
      currentConfig = DEFAULT_CONFIG;
      console.error("[task-runner] failed to load config:", error);
    }

    return currentConfig;
  }

  async function loadState(): Promise<RunnerState> {
    await ensureDir(runnerDir());

    if (!(await fileExists(statePath()))) {
      currentState = { status: "idle" };
      await saveState(currentState);
      return currentState;
    }

    try {
      const raw = await readFile(statePath(), "utf8");
      currentState = JSON.parse(raw) as RunnerState;
    } catch (error) {
      currentState = { status: "idle", lastError: `failed to parse state: ${String(error)}` };
      await saveState(currentState);
    }

    return currentState;
  }

  async function saveState(nextState: RunnerState): Promise<void> {
    currentState = nextState;
    await ensureDir(runnerDir());
    await writeFile(statePath(), `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  }

  async function updateState(patch: Partial<RunnerState>): Promise<void> {
    await saveState({
      ...currentState,
      ...patch,
    });
  }

  function slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "task";
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  function todayStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function nowFileStamp(): string {
    return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  }

  function notify(message: string): void {
    pi.events.emit("wecom:notify", {
      message,
    });
  }

  function buildTaskPrompt(task: TaskRecord, taskFile: string, content: string): string {
    return [
      `${currentConfig.notifyPrefix} You have claimed TaskBus task #${task.id}${task.name ? ` (${task.name})` : ""}.`,
      `Task file: ${taskFile}`,
      "",
      "Execution rules:",
      "- Read the task book carefully and carry the work through to completion.",
      "- If you are blocked or need clarification, call `task_runner_request_help` with a concrete question.",
      "- When the task is fully complete, call `task_runner_complete_task` with a concise completion summary.",
      "- Do not stop at analysis only. Implement, verify, and finish the task unless you need human help.",
      "",
      "Task book content:",
      content,
    ].join("\n");
  }

  function buildResumePrompt(taskId: number, taskFile: string, content: string): string {
    return [
      `${currentConfig.notifyPrefix} Resume TaskBus task #${taskId}.`,
      `Task file: ${taskFile}`,
      "",
      "Resume rules:",
      "- Continue the task from current repository state.",
      "- If blocked, call `task_runner_request_help`.",
      "- When fully complete, call `task_runner_complete_task`.",
      "",
      "Task book content:",
      content,
    ].join("\n");
  }

  async function appendMemory(summary: string): Promise<void> {
    await ensureDir(memoryDir());

    const path = join(memoryDir(), `${todayStamp()}.md`);
    const heading = `# ${todayStamp()} Log\n\n`;
    const line = `- ${nowIso()} completed TaskBus task #${currentState.currentTaskId}: ${summary}\n`;

    if (await fileExists(path)) {
      await writeFile(path, (await readFile(path, "utf8")) + line, "utf8");
      return;
    }

    await writeFile(path, heading + line, "utf8");
  }

  async function writeCurrentTaskMarker(taskFile: string): Promise<void> {
    await ensureDir(tasksDir());
    await writeFile(currentTaskMarkerPath(), `task file path\n${taskFile}\n`, "utf8");
  }

  async function execTaskbus(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
    const cfg = await loadConfig();
    const command = process.platform === "win32" ? "cmd" : cfg.taskbusCommand;
    const commandArgs =
      process.platform === "win32" ? ["/c", cfg.taskbusCommand, ...args] : args;

    const result = await pi.exec(command, commandArgs, {
      cwd: workspaceRoot,
      timeout: 30000,
    });

    return {
      ok: result.code === 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      code: result.code,
    };
  }

  function parseJson<T>(raw: string): T | null {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function getPendingCount(): Promise<number> {
    const result = await execTaskbus(["list", "-e", currentConfig.executor, "-s", "pending"]);
    if (!result.ok) {
      throw new Error(result.stderr || "taskbus list failed");
    }

    const parsed = parseJson<{ total?: number }>(result.stdout);
    return parsed?.total || 0;
  }

  async function claimTask(): Promise<TaskRecord | null> {
    const result = await execTaskbus(["claim", "-e", currentConfig.executor]);
    if (!result.ok || !result.stdout) {
      return null;
    }

    return parseJson<TaskRecord>(result.stdout);
  }

  async function getTask(taskId: number): Promise<TaskRecord> {
    const result = await execTaskbus(["get", String(taskId)]);
    if (!result.ok) {
      throw new Error(result.stderr || `taskbus get ${taskId} failed`);
    }

    const task = parseJson<TaskRecord>(result.stdout);
    if (!task?.id) {
      throw new Error(`taskbus get ${taskId} returned invalid payload`);
    }

    return task;
  }

  async function markTaskDone(taskId: number): Promise<void> {
    const result = await execTaskbus(["done", String(taskId)]);
    if (!result.ok) {
      throw new Error(result.stderr || `taskbus done ${taskId} failed`);
    }
  }

  async function downloadTaskBook(task: TaskRecord): Promise<string> {
    if (!task.fileUrl) {
      throw new Error(`task #${task.id} has no fileUrl`);
    }

    const response = await fetch(task.fileUrl);
    if (!response.ok) {
      throw new Error(`download failed with status ${response.status}`);
    }

    const content = await response.text();
    await ensureDir(tasksDir());

    const fileName = `${slugify(task.name || `task-${task.id}`)}_${nowFileStamp()}.md`;
    const filePath = join(tasksDir(), fileName);
    await writeFile(filePath, content, "utf8");
    await writeCurrentTaskMarker(filePath);
    return filePath;
  }

  async function startTaskExecution(task: TaskRecord, taskFile: string): Promise<void> {
    const taskContent = await readFile(taskFile, "utf8");

    await saveState({
      status: "running",
      currentTaskId: task.id,
      currentTaskName: task.name,
      currentTaskFile: taskFile,
      startedAt: nowIso(),
      helpRequestedAt: undefined,
      lastPollAt: currentState.lastPollAt,
      lastError: undefined,
    });

    notify(`${currentConfig.notifyPrefix} Started task #${task.id}${task.name ? `: ${task.name}` : ""}.`);
    pi.appendEntry("task-runner/task-started", {
      taskId: task.id,
      taskName: task.name,
      taskFile,
      startedAt: currentState.startedAt,
    });
    pi.sendUserMessage(buildTaskPrompt(task, taskFile, taskContent));
  }

  async function handleNextTask(): Promise<void> {
    const pendingCount = await getPendingCount();
    if (pendingCount <= 0) {
      return;
    }

    const claimed = await claimTask();
    if (!claimed?.id) {
      return;
    }

    const task = await getTask(claimed.id);
    const taskFile = await downloadTaskBook(task);
    await startTaskExecution(task, taskFile);
  }

  async function pollForTask(source: "startup" | "interval" | "command"): Promise<void> {
    if (pollInFlight) {
      return;
    }

    if (agentBusy) {
      return;
    }

    if (currentState.status !== "idle") {
      return;
    }

    pollInFlight = true;
    try {
      await loadConfig();
      await loadState();
      if (currentState.status !== "idle") {
        return;
      }
      await updateState({ lastPollAt: nowIso(), lastError: undefined });
      await handleNextTask();
      if (source !== "interval") {
        console.log(`[task-runner] poll complete via ${source}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateState({ lastError: message });
      console.error("[task-runner] poll failed:", error);
    } finally {
      pollInFlight = false;
    }
  }

  async function resumeActiveTaskIfNeeded(): Promise<void> {
    if (resumeScheduled) {
      return;
    }

    if (!currentConfig.resumeOnStart || currentState.status === "idle" || !currentState.currentTaskFile) {
      return;
    }

    if (!(await fileExists(currentState.currentTaskFile))) {
      await saveState({ status: "idle", lastError: "state referenced a missing task file" });
      return;
    }

    resumeScheduled = true;

    const taskFile = currentState.currentTaskFile;
    const taskId = currentState.currentTaskId;
    const content = await readFile(taskFile, "utf8");

    notify(`${currentConfig.notifyPrefix} Resuming task #${taskId} after restart.`);
    pi.sendUserMessage(buildResumePrompt(taskId || 0, taskFile, content), { deliverAs: "followUp" });
  }

  async function completeCurrentTask(summary: string): Promise<string> {
    if (!currentState.currentTaskId) {
      return "No active TaskBus task is currently running.";
    }

    const taskId = currentState.currentTaskId;
    const taskName = currentState.currentTaskName;

    await updateState({
      status: "completing",
      lastError: undefined,
    });

    try {
      await markTaskDone(taskId);
      await appendMemory(summary);
      notify(`${currentConfig.notifyPrefix} Completed task #${taskId}${taskName ? `: ${taskName}` : ""}. ${summary}`);
      pi.appendEntry("task-runner/task-completed", {
        taskId,
        taskName,
        summary,
        completedAt: nowIso(),
      });
      await saveState({
        status: "idle",
        lastPollAt: currentState.lastPollAt,
      });
      return `Marked task #${taskId} as done and recorded completion.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateState({
        status: "running",
        lastError: message,
      });
      throw error;
    }
  }

  async function requestHelp(question: string, context?: string): Promise<string> {
    if (!currentState.currentTaskId) {
      return "No active TaskBus task is currently running.";
    }

    const message = [
      `${currentConfig.notifyPrefix} Help requested for task #${currentState.currentTaskId}${currentState.currentTaskName ? `: ${currentState.currentTaskName}` : ""}.`,
      `Question: ${question}`,
      context ? `Context: ${context}` : undefined,
      currentState.currentTaskFile ? `Task file: ${currentState.currentTaskFile}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");

    await updateState({
      status: "awaiting_help",
      helpRequestedAt: nowIso(),
      lastError: undefined,
    });

    notify(message);
    pi.appendEntry("task-runner/help-requested", {
      taskId: currentState.currentTaskId,
      question,
      context,
      requestedAt: currentState.helpRequestedAt,
    });

    return `Sent a WeCom help request for task #${currentState.currentTaskId}.`;
  }

  function startPollingLoop(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
    }

    if (!currentConfig.autoRun) {
      pollTimer = null;
      return;
    }

    pollTimer = setInterval(() => {
      void pollForTask("interval");
    }, Math.max(5, currentConfig.pollIntervalSeconds) * 1000);
  }

  pi.registerTool({
    name: "task_runner_request_help",
    label: "Task Runner Help",
    description: "Request human help for the currently running TaskBus task when you are blocked.",
    promptSnippet: "Use `task_runner_request_help` when you are blocked and need human assistance on the active TaskBus task.",
    promptGuidelines: [
      "If you cannot continue an active TaskBus task without clarification or credentials, call `task_runner_request_help` with a specific question.",
    ],
    parameters: HelpParams,
    async execute(_toolCallId, params) {
      const text = await requestHelp(params.question, params.context);
      return {
        content: [{ type: "text", text }],
        details: {
          taskId: currentState.currentTaskId,
          question: params.question,
        },
      };
    },
  });

  pi.registerTool({
    name: "task_runner_complete_task",
    label: "Task Runner Complete",
    description: "Mark the active TaskBus task as done after the work is fully complete.",
    promptSnippet: "When the active TaskBus task is fully complete, call `task_runner_complete_task` with a concise summary.",
    promptGuidelines: [
      "Call `task_runner_complete_task` only after the task is truly finished and verified.",
    ],
    parameters: CompleteParams,
    async execute(_toolCallId, params) {
      const taskId = currentState.currentTaskId;
      const text = await completeCurrentTask(params.summary);
      return {
        content: [{ type: "text", text }],
        details: {
          taskId,
          summary: params.summary,
        },
      };
    },
  });

  pi.registerCommand("task-runner", {
    description: "Inspect and control the built-in TaskBus runner",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const [subCommand = "status"] = trimmed.split(/\s+/);

      switch (subCommand) {
        case "status":
          await loadConfig();
          await loadState();
          ctx.ui.notify(
            `status=${currentState.status}, task=${currentState.currentTaskId || "none"}, poll=${currentConfig.pollIntervalSeconds}s`,
            "info",
          );
          return;

        case "poll":
          await pollForTask("command");
          ctx.ui.notify("Task runner poll finished", "info");
          return;

        case "reset":
          await saveState({ status: "idle" });
          ctx.ui.notify("Task runner state reset to idle", "warning");
          return;

        default:
          ctx.ui.notify("Usage: /task-runner [status|poll|reset]", "info");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    workspaceRoot = ctx.cwd;
    await loadConfig();
    await loadState();
    startPollingLoop();

    if (currentConfig.autoRun) {
      void pollForTask("startup");
    }

    if (currentConfig.resumeOnStart) {
      void resumeActiveTaskIfNeeded();
    }
  });

  pi.on("agent_start", async () => {
    agentBusy = true;
  });

  pi.on("agent_end", async () => {
    agentBusy = false;
  });

  pi.on("input", async (event) => {
    if (event.source === "extension") {
      return;
    }

    if (currentState.status === "awaiting_help" && currentState.currentTaskId) {
      await updateState({
        status: "running",
        lastError: undefined,
      });
    }
  });

  pi.on("session_shutdown", async () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
}
