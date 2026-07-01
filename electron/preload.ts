import { contextBridge, ipcRenderer } from 'electron';

// claude 对话 API：
// - ask: 发送消息，返回 Promise（流式 chunk 通过 onChunk 回调）
// - stop: 中断当前回复
// - newChat: 清空上下文，开始新会话
// - onChunk: 订阅 claude 的增量文字
// - onStatus: 订阅状态变化（thinking/done/error）
// - onError: 订阅错误
export interface ClaudeItems {
  commands: AliasCmdItem[];
  skills: { name: string; description?: string }[];
  agents: string[];
}

// 命令项（结构化）：区分项目命令 / 内置命令，内置命令可带 GUI 接管动作
export interface AliasCmdItem {
  name: string;
  description?: string;
  builtin?: boolean;                     // true = claude 内置/原生命令
  action?: 'clear' | 'model' | 'cost';   // 非空 = GUI 端接管（不透传给 claude）
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

// 变更确认：第一轮（default 模式）抓到的写/执行类工具意图，发给前端确认
export interface PendingChange {
  toolUseId: string;
  name: string;       // Write / Edit / MultiEdit / Bash / Task ...
  input: unknown;     // 完整参数（文件路径、内容、命令等）
}

export interface Conversation {
  id: string;
  title: string;
  sessionId: string | null;
  workspace: string;
  workspacePicked: boolean;
  model: string | null;
  mode: string | null;
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
  // 导入 session 文件（.jsonl）：返回新列表、激活 id、跳过数（去重）
  import: () => Promise<{ conversations: Conversation[]; activeId: string | null; skipped: number }>;
}

export interface ClaudeAPI {
  ask: (prompt: string, confirmEnabled?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  newChat: () => Promise<string>;
  // 变更确认（两轮调用）
  confirmApprove: () => Promise<void>;   // 用户点「执行」→ 第二轮 acceptEdits 重跑
  confirmReject: () => Promise<void>;    // 用户点「拒绝」→ 清空待确认状态
  onChunk: (cb: (convId: string, text: string) => void) => void;
  // 完整 text 块（流式可能不完整时补差量用）
  onFullText: (cb: (convId: string, text: string) => void) => void;
  onStatus: (cb: (convId: string, status: string) => void) => void;
  onError: (cb: (convId: string, msg: string) => void) => void;
  onUsage: (cb: (convId: string, usage: Usage) => void) => void;
  onEvent: (cb: (convId: string, event: ToolEvent) => void) => void;
  // 第一轮抓到写操作意图时触发，前端展示确认卡片
  onConfirmRequest: (cb: (convId: string, changes: PendingChange[]) => void) => void;
  // 工作空间
  getWorkspace: () => Promise<string>;
  getWorkspaceInfo: () => Promise<{ workspace: string; picked: boolean }>;
  setWorkspace: (dir: string) => Promise<string>;
  pickDirectory: () => Promise<string | null>;
  // 模型
  getModels: () => Promise<ModelItem[]>;
  getModel: () => Promise<string | null>;
  setModel: (model: string | null) => Promise<string | null>;
  // 权限模式
  getModes: () => Promise<ModelItem[]>;
  getMode: () => Promise<string>;
  setMode: (mode: string | null) => Promise<string>;
  // 命令/技能/代理
  getCommands: () => Promise<ClaudeItems>;
  builtinCommands: () => Promise<AliasCmdItem[]>;
  clearContext: () => Promise<boolean>;   // /clear 接管：清除当前对话 claude session
  getSkills: () => Promise<{ name: string; description?: string }[]>;
  // skill 完整内容（二级弹窗用）
  getSkillDetail: (skillPath: string) => Promise<{ content: string; error?: string }>;
  // 文件列表（@ 提及用）：列出 subdir（相对 workspace，空=顶层）的直接子项
  listFiles: (query: string, subdir?: string) => Promise<{ name: string; path: string; isDir: boolean }[]>;
  // 保存粘贴的图片（base64）到工作区，返回相对路径；失败返回 { error }
  saveImage: (dataB64: string, ext: string) => Promise<{ path?: string; error?: string }>;
  // 读取工作区图片为 dataURL（前端显示用）；失败返回 { error }
  readImage: (relPath: string) => Promise<{ dataUrl?: string; error?: string }>;
  // 同步主题到系统外观（mac 毛玻璃明暗跟随系统外观）
  setNativeTheme: (theme: 'light' | 'dark') => Promise<void>;
  // 历史消息（从 session 恢复）
  loadHistory: (sessionId: string) => Promise<{ id: string; role: 'user' | 'assistant'; content: string }[]>;
  // 对话管理
  conv: ConvAPI;
  // 窗口控制（无边框窗口自绘按钮）
  win: {
    minimize: () => void;
    maximizeToggle: () => void;
    close: () => void;
  };
}

contextBridge.exposeInMainWorld('claude', {
  ask: (prompt: string, confirmEnabled?: boolean) => ipcRenderer.invoke('claude:ask', prompt, !!confirmEnabled),
  stop: () => ipcRenderer.invoke('claude:stop'),
  newChat: () => ipcRenderer.invoke('claude:new-chat'),
  // 变更确认
  confirmApprove: () => ipcRenderer.invoke('claude:confirm-approve'),
  confirmReject: () => ipcRenderer.invoke('claude:confirm-reject'),
  onChunk: (cb: (convId: string, text: string) => void) =>
    ipcRenderer.on('claude:chunk', (_e, convId, text) => cb(convId, text)),
  onFullText: (cb: (convId: string, text: string) => void) =>
    ipcRenderer.on('claude:full-text', (_e, convId, text) => cb(convId, text)),
  onStatus: (cb: (convId: string, status: string) => void) =>
    ipcRenderer.on('claude:status', (_e, convId, status) => cb(convId, status)),
  onError: (cb: (convId: string, msg: string) => void) =>
    ipcRenderer.on('claude:error', (_e, convId, msg) => cb(convId, msg)),
  onUsage: (cb: (convId: string, usage: Usage) => void) =>
    ipcRenderer.on('claude:usage', (_e, convId, usage) => cb(convId, usage)),
  onEvent: (cb: (convId: string, event: ToolEvent) => void) =>
    ipcRenderer.on('claude:event', (_e, convId, event) => cb(convId, event)),
  onConfirmRequest: (cb: (convId: string, changes: PendingChange[]) => void) =>
    ipcRenderer.on('claude:confirm-request', (_e, convId, changes) => cb(convId, changes)),
  getWorkspace: () => ipcRenderer.invoke('claude:get-workspace'),
  getWorkspaceInfo: () => ipcRenderer.invoke('claude:workspace-info'),
  setWorkspace: (dir: string) => ipcRenderer.invoke('claude:set-workspace', dir),
  pickDirectory: () => ipcRenderer.invoke('claude:pick-directory'),
  getModels: () => ipcRenderer.invoke('claude:get-models'),
  getModel: () => ipcRenderer.invoke('claude:get-model'),
  setModel: (model: string | null) => ipcRenderer.invoke('claude:set-model', model),
  getModes: () => ipcRenderer.invoke('claude:get-modes'),
  getMode: () => ipcRenderer.invoke('claude:get-mode'),
  setMode: (mode: string | null) => ipcRenderer.invoke('claude:set-mode', mode),
  getCommands: () => ipcRenderer.invoke('claude:get-commands'),
  builtinCommands: () => ipcRenderer.invoke('claude:builtin-commands'),
  clearContext: () => ipcRenderer.invoke('claude:clear-context'),
  getSkills: () => ipcRenderer.invoke('claude:get-skills'),
  getSkillDetail: (skillPath: string) => ipcRenderer.invoke('claude:skill-detail', skillPath),
  listFiles: (query: string, subdir?: string) => ipcRenderer.invoke('claude:list-files', query, subdir),
  saveImage: (dataB64: string, ext: string) => ipcRenderer.invoke('claude:save-image', dataB64, ext),
  readImage: (relPath: string) => ipcRenderer.invoke('claude:read-image', relPath),
  // 同步主题到系统外观（mac 毛玻璃明暗跟随系统外观）
  setNativeTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke('claude:set-native-theme', theme),
  loadHistory: (sessionId: string) => ipcRenderer.invoke('claude:load-history', sessionId),
  conv: {
    list: () => ipcRenderer.invoke('conv:list'),
    create: (firstMessage?: string) => ipcRenderer.invoke('conv:create', firstMessage),
    switch: (id: string) => ipcRenderer.invoke('conv:switch', id),
    delete: (id: string) => ipcRenderer.invoke('conv:delete', id),
    rename: (id: string, title: string) => ipcRenderer.invoke('conv:rename', id, title),
    import: () => ipcRenderer.invoke('conv:import'),
  },
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximizeToggle: () => ipcRenderer.send('win:maximize-toggle'),
    close: () => ipcRenderer.send('win:close'),
  },
} satisfies ClaudeAPI);
