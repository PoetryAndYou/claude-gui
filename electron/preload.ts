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

export interface Conversation {
  id: string;
  title: string;
  sessionId: string | null;
  createdAt: number;
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
  onChunk: (cb: (text: string) => void) => void;
  onStatus: (cb: (status: string) => void) => void;
  onError: (cb: (msg: string) => void) => void;
  // 工作空间
  getWorkspace: () => Promise<string>;
  setWorkspace: (dir: string) => Promise<string>;
  pickDirectory: () => Promise<string | null>;
  // 命令/技能/代理
  getCommands: () => Promise<ClaudeItems>;
  // 对话管理
  conv: ConvAPI;
}

contextBridge.exposeInMainWorld('claude', {
  ask: (prompt: string) => ipcRenderer.invoke('claude:ask', prompt),
  stop: () => ipcRenderer.invoke('claude:stop'),
  newChat: () => ipcRenderer.invoke('claude:new-chat'),
  onChunk: (cb: (text: string) => void) =>
    ipcRenderer.on('claude:chunk', (_e, text) => cb(text)),
  onStatus: (cb: (status: string) => void) =>
    ipcRenderer.on('claude:status', (_e, status) => cb(status)),
  onError: (cb: (msg: string) => void) =>
    ipcRenderer.on('claude:error', (_e, msg) => cb(msg)),
  getWorkspace: () => ipcRenderer.invoke('claude:get-workspace'),
  setWorkspace: (dir: string) => ipcRenderer.invoke('claude:set-workspace', dir),
  pickDirectory: () => ipcRenderer.invoke('claude:pick-directory'),
  getCommands: () => ipcRenderer.invoke('claude:get-commands'),
  conv: {
    list: () => ipcRenderer.invoke('conv:list'),
    create: (firstMessage?: string) => ipcRenderer.invoke('conv:create', firstMessage),
    switch: (id: string) => ipcRenderer.invoke('conv:switch', id),
    delete: (id: string) => ipcRenderer.invoke('conv:delete', id),
    rename: (id: string, title: string) => ipcRenderer.invoke('conv:rename', id, title),
  },
} satisfies ClaudeAPI);
