import { contextBridge, ipcRenderer } from 'electron';

// claude 对话 API：
// - ask: 发送消息，返回 Promise（流式 chunk 通过 onChunk 回调）
// - stop: 中断当前回复
// - newChat: 清空上下文，开始新会话
// - onChunk: 订阅 claude 的增量文字
// - onStatus: 订阅状态变化（thinking/done/error）
// - onError: 订阅错误
export interface ClaudeItems {
  commands: string[];
  skills: { name: string; description?: string }[];
  agents: string[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  totalCostUsd: number;
}

// 过程事件：思考 / 工具调用 / 工具结果（按顺序流入当前助手消息）
export interface ToolEvent {
  kind: 'thinking' | 'tool_use' | 'tool_result';
  text?: string;            // thinking
  toolUseId?: string;       // tool_use / tool_result 关联用
  name?: string;            // tool_use 的工具名
  input?: unknown;          // tool_use 的参数
  content?: string;         // tool_result 的结果文本
  isError?: boolean;        // tool_result 是否出错
}

export interface Conversation {
  id: string;
  title: string;
  sessionId: string | null;
  workspace: string;
  model: string | null;
  createdAt: number;
}

// 可选模型项
export interface ModelItem {
  alias: string;
  name: string;
  desc: string;
}

export interface ConvAPI {
  list: () => Promise<{ conversations: Conversation[]; activeId: string | null }>;
  create: (firstMessage?: string) => Promise<string>;
  switch: (id: string) => Promise<boolean>;
  delete: (id: string) => Promise<{ conversations: Conversation[]; activeId: string | null }>;
  rename: (id: string, title: string) => Promise<boolean>;
}

export interface ClaudeAPI {
  ask: (prompt: string) => Promise<void>;
  stop: () => Promise<void>;
  newChat: () => Promise<string>;
  onChunk: (cb: (convId: string, text: string) => void) => void;
  onStatus: (cb: (convId: string, status: string) => void) => void;
  onError: (cb: (convId: string, msg: string) => void) => void;
  onUsage: (cb: (convId: string, usage: Usage) => void) => void;
  onEvent: (cb: (convId: string, event: ToolEvent) => void) => void;
  // 工作空间
  getWorkspace: () => Promise<string>;
  setWorkspace: (dir: string) => Promise<string>;
  pickDirectory: () => Promise<string | null>;
  // 模型
  getModels: () => Promise<ModelItem[]>;
  getModel: () => Promise<string | null>;
  setModel: (model: string | null) => Promise<string | null>;
  // 命令/技能/代理
  getCommands: () => Promise<ClaudeItems>;
  getSkills: () => Promise<{ name: string; description?: string }[]>;
  // 文件列表（@ 提及用）
  listFiles: (query: string) => Promise<{ name: string; path: string; isDir: boolean }[]>;
  // 历史消息（从 session 恢复）
  loadHistory: (sessionId: string) => Promise<{ id: string; role: 'user' | 'assistant'; content: string }[]>;
  // 对话管理
  conv: ConvAPI;
}

contextBridge.exposeInMainWorld('claude', {
  ask: (prompt: string) => ipcRenderer.invoke('claude:ask', prompt),
  stop: () => ipcRenderer.invoke('claude:stop'),
  newChat: () => ipcRenderer.invoke('claude:new-chat'),
  onChunk: (cb: (convId: string, text: string) => void) =>
    ipcRenderer.on('claude:chunk', (_e, convId, text) => cb(convId, text)),
  onStatus: (cb: (convId: string, status: string) => void) =>
    ipcRenderer.on('claude:status', (_e, convId, status) => cb(convId, status)),
  onError: (cb: (convId: string, msg: string) => void) =>
    ipcRenderer.on('claude:error', (_e, convId, msg) => cb(convId, msg)),
  onUsage: (cb: (convId: string, usage: Usage) => void) =>
    ipcRenderer.on('claude:usage', (_e, convId, usage) => cb(convId, usage)),
  onEvent: (cb: (convId: string, event: ToolEvent) => void) =>
    ipcRenderer.on('claude:event', (_e, convId, event) => cb(convId, event)),
  getWorkspace: () => ipcRenderer.invoke('claude:get-workspace'),
  setWorkspace: (dir: string) => ipcRenderer.invoke('claude:set-workspace', dir),
  pickDirectory: () => ipcRenderer.invoke('claude:pick-directory'),
  getModels: () => ipcRenderer.invoke('claude:get-models'),
  getModel: () => ipcRenderer.invoke('claude:get-model'),
  setModel: (model: string | null) => ipcRenderer.invoke('claude:set-model', model),
  getCommands: () => ipcRenderer.invoke('claude:get-commands'),
  getSkills: () => ipcRenderer.invoke('claude:get-skills'),
  listFiles: (query: string) => ipcRenderer.invoke('claude:list-files', query),
  loadHistory: (sessionId: string) => ipcRenderer.invoke('claude:load-history', sessionId),
  conv: {
    list: () => ipcRenderer.invoke('conv:list'),
    create: (firstMessage?: string) => ipcRenderer.invoke('conv:create', firstMessage),
    switch: (id: string) => ipcRenderer.invoke('conv:switch', id),
    delete: (id: string) => ipcRenderer.invoke('conv:delete', id),
    rename: (id: string, title: string) => ipcRenderer.invoke('conv:rename', id, title),
  },
} satisfies ClaudeAPI);
