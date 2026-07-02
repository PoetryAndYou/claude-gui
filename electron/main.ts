import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const isDev = !!process.env.VITE_DEV;

let win: BrowserWindow | null = null;

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 480,
    minHeight: 400,
    // mac: hiddenInset（红黄绿按钮内嵌）；Windows: 自定义无边框（前端自绘最小化/最大化/关闭按钮）
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Windows 无边框需要 frame:false（隐藏整个系统标题栏），mac 用 hiddenInset 即可
    frame: isMac,
    // mac 原生毛玻璃：窗口背景透明 + vibrancy，让侧边栏透出桌面/后方内容
    transparent: isMac,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: 'active',
    backgroundColor: isMac ? '#00000000' : '#1a1d23',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// ──────────────────────────────────────────────
// 窗口控制（无边框窗口自绘按钮用）
// ──────────────────────────────────────────────
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize-toggle', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('win:close', () => win?.close());

// ──────────────────────────────────────────────
// claude CLI 调用层
// 用 child_process.spawn 跑 claude -p --output-format stream-json
// 逐行解析 JSON，把增量文字推给前端
// ──────────────────────────────────────────────

// GUI 应用不读 shell 配置，PATH 里通常没有用户的 bin 目录（如 ~/.npm-global/bin）。
// 这里把常见的用户安装路径补进 PATH，让 claude 能被找到。
function ensureUserPath() {
  const { existsSync } = require('fs');
  const home = require('os').homedir();
  const isWin = process.platform === 'win32';
  // macOS / Linux 上常见的 npm/volta/nvm/用户 bin 目录
  let extraDirs = [
    // unix
    `${home}/.npm-global/bin`,
    `${home}/.local/bin`,
    `${home}/.volta/bin`,
    `${home}/.bun/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  if (isWin) {
    // Windows：用 path.join 生成路径。注意用正斜杠作为参数——path.join 在 win 上
    // 会自动转成反斜杠，且 Windows 原生 API/where/spawn 都能正确识别正斜杠。
    const a = (rel: string) => path.join(home, rel);
    extraDirs = [
      a('AppData/Roaming/npm'),                              // npm 全局（最常见，claude.cmd 在此）
      a('AppData/Local/nvm'),                                 // nvm-windows
      a('AppData/Local/fnm_multishells'),                    // fnm
      a('AppData/Local/Programs/claude'),                    // 原生安装器（2.1.x 新版）
      a('AppData/Local/Microsoft/WinGet/Packages/Anthropic.claude'), // winget
      a('scoop/shims'),                                      // scoop
      a('.bun/bin'),                                         // bun (win)
    ];
  }
  const extra = extraDirs.filter((d) => {
    try { return existsSync(d); } catch (_) { return false; }
  });
  const curPath = process.env.PATH || '';
  const dirs = curPath.split(path.delimiter);
  for (const d of extra) {
    if (!dirs.includes(d)) dirs.push(d);
  }
  process.env.PATH = dirs.join(path.delimiter);
}

ensureUserPath();

// 探测 claude 可执行路径（扩充 PATH 后再 which）
function findClaude(): string {
  const { existsSync } = require('fs');
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? ['claude.cmd', 'claude.exe', 'claude']
    : ['claude'];
  for (const c of candidates) {
    try {
      // Windows: where 命令；Linux/Mac: which 命令
      const which = require('child_process').execSync(
        isWin ? `where ${c}` : `which ${c}`,
        { stdio: 'pipe', shell: isWin ? process.env.ComSpec || 'cmd.exe' : false }
      ).toString().trim().split(/\r?\n/)[0];
      if (which && existsSync(which) && which.toLowerCase() !== c) return which;
    } catch (_) {}
  }
  return 'claude';
}

// 跨平台执行 claude 子命令（--help / --version）：
// Windows 下 claudeBin 是 claude.cmd，execSync 直接跑 .cmd 必须设 shell:true（用 cmd.exe），
// 否则 Node 抛 EINVAL / 未知命令 → detectFlags 走 catch → 所有 flag 退化 → 行为异常。
// Unix 下不需要 shell。
function execClaude(claudeBin: string, subArgs: string, timeoutMs = 10000): string {
  const isWin = process.platform === 'win32';
  const needsShell = isWin && /\.(cmd|bat)$/i.test(claudeBin);
  if (needsShell) {
    // 走 cmd.exe，整体加引号防路径含空格
    return String(execSync(`"${claudeBin}" ${subArgs}`, {
      shell: process.env.ComSpec || 'cmd.exe',
      encoding: 'utf8',
      timeout: timeoutMs,
    }));
  }
  // unix / .exe：直接跑
  return String(execSync(`"${claudeBin}" ${subArgs}`, {
    encoding: 'utf8',
    timeout: timeoutMs,
  }));
}

// 探测 claude 版本支持哪些 flag（旧版如 2.1.34 不认 --permission-mode / --include-partial-messages，
// 传不认的 flag 会直接退出报错 → GUI 卡死）。一次性探测，结果缓存。
let flagCache: { ok: boolean; checked: boolean } = { ok: false, checked: false };
let partialMsgSupport = false;
// --max-turns 仅新版支持；2.1.34 的 --help 里没有，传了虽不报错但也不生效，按版本决定加不加
let maxTurnsSupport = false;
// 放权方式优先级：新版的 --permission-mode > 老版的 --dangerously-skip-permissions > 无
let permFlag: 'mode' | 'danger' | 'none' = 'none';
function detectFlags() {
  if (flagCache.checked) return;
  flagCache.checked = true;
  try {
    const claudeBin = findClaude();
    // 注意：claude --help 在 Electron 环境下输出被截断（~8KB，缺 permission-mode），
    // 不能靠 --help 探测。改用更可靠的方式：直接试 --permission-mode 参数是否被接受。
    // 2.1.34+ 全部支持 --permission-mode，且即使老版不识别也只会报 unknown option（不影响主流程）。
    // 所以默认就认为支持（partial-messages 同理，靠 --help 不可靠）。
    partialMsgSupport = true;   // 2.1.34+ 支持，实测可靠
    maxTurnsSupport = true;
    permFlag = 'mode';          // 优先用 --permission-mode（确认功能依赖它）
    flagCache.ok = true;
  } catch (e) {
    // findClaude 失败才走这里
    partialMsgSupport = true;
    maxTurnsSupport = true;
    permFlag = 'mode';
    flagCache.ok = false;
  }
}

// ──────────────────────────────────────────────
// 两轮调用：变更前确认
// 实测：headless 模式下 claude 权限不会暂停等用户（要么自动放行要么自动拒绝）。
// 所以用两轮：第一轮 default 模式让 claude 尝试写操作→被拒→但我们已抓到 tool_use 意图；
// 前端展示这些意图 + diff，用户点「执行」→ 第二轮 acceptEdits 重跑相同 prompt 真正落地。
// 仅在对话开启「变更前确认」时走两轮，默认关闭（保持原有 acceptEdits 单轮体验）。
// ──────────────────────────────────────────────
// 当前等待用户确认的变更意图（第一轮收集到的写工具调用）
interface PendingChange { toolUseId: string; name: string; input: unknown; }
let pendingChanges: PendingChange[] = [];
let pendingPrompt: string | null = null;   // 第一轮的 prompt，第二轮复用
let confirmConvId: string | null = null;   // 当前等待确认的对话 id
// 写/执行类工具（需要确认的）；只读工具（Read/Grep/Glob/WebSearch）和提问类（AskUserQuestion）不拦截
// Task = 子 agent 执行（可能含写操作），需确认；AskUserQuestion 只是提问，不拦截
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task']);

// 跨平台目录递归扫描（替代 Unix find，Windows 也能用）
// maxDepth: 最大深度；返回找到的文件/目录绝对路径数组
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', 'tmp']);
function walkDir(root: string, maxDepth: number, limit = 500): string[] {
  const results: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (results.length >= limit) return;
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const ent of entries) {
      if (results.length >= limit) break;
      // 所有 . 开头的隐藏项一律跳过（.agents/.claude/.git 等是工具/缓存目录，
      // 递归进去会占用 @列表名额，把真正的项目文件挤掉）
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        results.push(full);
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        results.push(full);
      }
    }
  };
  walk(root, 0);
  return results;
}

// 在 root 下按文件名查找（跨平台，递归到指定深度），返回路径数组
function findFilesByName(root: string, name: string, maxDepth = 8, limit = 200): string[] {
  const results: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (results.length >= limit) return;
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const ent of entries) {
      if (results.length >= limit) break;
      const full = path.join(dir, ent.name);
      if (ent.isFile() && ent.name === name) {
        results.push(full);
      } else if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(full, depth + 1);
      }
    }
  };
  walk(root, 0);
  return results;
}

// ──────────────────────────────────────────────
// 对话管理：多对话，每个对话 {id, title, sessionId, workspace, createdAt}
// workspace = 该对话绑定的项目目录（claude 在此 cwd 执行），持久化
// ──────────────────────────────────────────────
interface Conversation {
  id: string;            // GUI 内部 id
  title: string;         // 显示名（取首条消息）
  sessionId: string | null;  // claude 的 session_id（用于 --resume）
  workspace: string;     // 该对话的工作目录
  workspacePicked: boolean;  // 用户是否显式选过工作空间（决定首屏/空态输入框居中布局）
  model: string | null;  // 该对话用的模型别名（sonnet/opus/haiku），null = claude 默认
  mode: string | null;   // 该对话的权限模式（acceptEdits/plan/bypassPermissions），null = acceptEdits
  createdAt: number;
}

let conversations: Conversation[] = [];
let activeConvId: string | null = null;

// 可选模型列表（别名 → 全名/说明），用于前端下拉
const MODELS: { alias: string; name: string; desc: string }[] = [
  { alias: 'sonnet', name: 'Sonnet', desc: '均衡 · 推荐' },
  { alias: 'opus', name: 'Opus', desc: '最强 · 慢/贵' },
  { alias: 'haiku', name: 'Haiku', desc: '最快 · 轻量' },
];

// 可选权限模式列表，用于前端下拉
// GUI 非交互，必须放行；acceptEdits 适中最常用
const MODES: { alias: string; name: string; desc: string }[] = [
  { alias: 'acceptEdits', name: '自动改文件', desc: '读写编辑无需确认' },
  { alias: 'plan', name: '只规划', desc: '只读分析·不动手' },
  { alias: 'bypassPermissions', name: '全自动', desc: '放行一切·含命令' },
];

// ──────────────────────────────────────────────
// 内置/原生命令：新版 claude init 事件不再暴露这些，需 GUI 侧补全。
// action 字段空 = 仅展示/按字面 ask 发送（-p 下可能不生效，但至少出现在补全里供用户用）；
// action 非空 = GUI 接管（前端拦截、不透传给 claude，执行真实动作）。
// ──────────────────────────────────────────────
interface BuiltinCmd {
  name: string;       // 不含前导 /
  desc?: string;
  action?: 'clear' | 'model' | 'cost';   // 非空 = GUI 接管
}
const BUILTIN_COMMANDS: BuiltinCmd[] = [
  // GUI 接管（有真实 GUI 动作，或前端处理后再决定是否走 claude）
  { name: 'clear',  desc: '清空上下文（重置 session，开始新会话）', action: 'clear' },
  { name: 'model',  desc: '选择 LLM 模型（弹出模型选择器）',        action: 'model' },
  { name: 'cost',   desc: '统计当前对话的 token 用量与费用',         action: 'cost' },
  // 仅展示 / 按字面发送（headless 下多数不生效，但补全里可见，方便用户熟悉）
  { name: 'compact',          desc: '压缩上下文（保留摘要继续会话）' },
  { name: 'resume',           desc: '恢复指定会话' },
  { name: 'review',           desc: '请求代码审查' },
  { name: 'agents',           desc: '管理子代理' },
  { name: 'memory',           desc: '编辑 CLAUDE.md 记忆文件' },
  { name: 'config',           desc: '查看/编辑配置' },
  { name: 'mcp',              desc: '管理 MCP 服务器' },
  { name: 'add-dir',          desc: '添加工作目录' },
  { name: 'init',             desc: '初始化项目 CLAUDE.md' },
  { name: 'login',            desc: '登录 Anthropic 账户' },
  { name: 'logout',           desc: '退出登录' },
  { name: 'status',           desc: '查看账户与连接状态' },
  { name: 'doctor',           desc: '诊断 claude 安装/环境问题' },
  { name: 'bug',              desc: '提交 bug 报告' },
  { name: 'release-notes',    desc: '查看版本更新日志' },
  { name: 'vim',              desc: '切换 vim 输入模式' },
  { name: 'terminal-setup',   desc: '安装 Shift+Enter 终端键绑定' },
];

// 当前激活对话的工作目录（spawn/listFiles 等都用它）
function currentWorkspace(): string {
  const c = conversations.find((c) => c.id === activeConvId);
  if (c?.workspace) return c.workspace;
  // 首屏无对话但用户已选过：用 pending 值
  if (pendingPickedWorkspace) return pendingPickedWorkspace;
  return require('os').homedir();
}

// 当前激活对话是否已显式选过工作空间（决定首屏/空态布局）
function currentWorkspacePicked(): boolean {
  const c = conversations.find((c) => c.id === activeConvId);
  if (c) return !!c.workspacePicked;
  // 首屏无对话：看 pending 标记
  return pendingPicked;
}

// 兼容旧的全局 workspace 引用（现在都改成 currentWorkspace()，但部分函数仍引用此变量）
let workspace: string = require('os').homedir();
// 同步 workspace 到当前对话（每次用到前调一下）
function syncWorkspace() {
  workspace = currentWorkspace();
}

function convStorePath(): string {
  const dir = require('path').join(app.getPath('userData'), 'claude-gui-data');
  try { require('fs').mkdirSync(dir, { recursive: true }); } catch (_) {}
  return require('path').join(dir, 'conversations.json');
}

function loadConversations() {
  try {
    conversations = JSON.parse(require('fs').readFileSync(convStorePath(), 'utf8'));
  } catch (_) { conversations = []; }
  // 向后兼容：老对话没有 workspace/model 字段，补默认值
  const home = require('os').homedir();
  conversations.forEach((c) => {
    if (!c.workspace) c.workspace = home;
    if (!c.model) c.model = null;
    if (!c.mode) c.mode = null;
    // workspacePicked：老数据无此字段 → 视为「选过」（沿用旧布局，避免老用户被打回居中态）
    if (c.workspacePicked === undefined) c.workspacePicked = true;
  });
}

// 当前激活对话用的模型（null = claude 默认）
function currentModel(): string | null {
  const c = conversations.find((c) => c.id === activeConvId);
  return c?.model ?? null;
}

// 当前激活对话用的权限模式（null = acceptEdits 兜底）
function currentMode(): string {
  const c = conversations.find((c) => c.id === activeConvId);
  return c?.mode || 'acceptEdits';
}

function saveConversations() {
  try {
    require('fs').writeFileSync(convStorePath(), JSON.stringify(conversations), 'utf8');
  } catch (_) {}
}

loadConversations();

// 当前 claude session_id（取自激活对话，便于 spawn 时 --resume）
function currentSessionId(): string | null {
  const c = conversations.find((c) => c.id === activeConvId);
  return c ? c.sessionId : null;
}

// 从 result 事件提取用量信息（token / 耗时 / 成本），供前端在助手消息底部展示
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  totalCostUsd: number;
}
function extractUsage(obj: any): Usage | null {
  const u = obj?.usage;
  const inTok = u?.input_tokens ?? u?.prompt_tokens ?? 0;
  const outTok = u?.output_tokens ?? u?.completion_tokens ?? 0;
  const dur = obj?.duration_ms ?? obj?.duration_api_ms ?? 0;
  const cost = obj?.total_cost_usd ?? obj?.cost_usd ?? 0;
  if (!inTok && !outTok && !dur && !cost) return null;
  return { inputTokens: inTok, outputTokens: outTok, durationMs: dur, totalCostUsd: cost };
}

// 把 tool_result 的 content（可能是 string 或 [{type,text}] 数组）压平成字符串，限长
function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (b && typeof b === 'object') {
        const bb = b as any;
        if (typeof bb.text === 'string') parts.push(bb.text);
        else if (typeof bb.content === 'string') parts.push(bb.content);
      }
    }
    return parts.join('\n');
  }
  try {
    return content == null ? '' : String(content);
  } catch (_) { return ''; }
}
function makeTitle(text: string): string {
  let t = text.trim();
  // 去掉开头的 / 命令、@ 文件
  t = t.replace(/^\/[\w-]+\s*/, '').replace(/^@\S+\s*/, '');
  // 取首行或首句
  const firstLine = t.split(/\r?\n/)[0] || t;
  const firstSentence = firstLine.split(/[。.！!？?；;\n]/)[0] || firstLine;
  let clean = firstSentence.trim();
  // 去掉 markdown 符号
  clean = clean.replace(/[#*`>~_-]/g, '').trim();
  if (!clean) clean = firstLine.slice(0, 30);
  return clean.length > 30 ? clean.slice(0, 30) + '…' : clean;
}

// 当前正在运行的 claude 进程（用于中断）
let currentProc: ChildProcess | null = null;

// 杀掉整个进程树：Windows 下 shell:true spawn 时，kill() 只杀外壳 cmd.exe，
// 真正的 claude 子进程会变孤儿继续跑。用 taskkill /T 杀整树；其他平台直接 kill。
function killProcTree(proc: ChildProcess | null) {
  if (!proc || proc.exitCode != null) return;
  if (process.platform === 'win32') {
    try {
      // /T 杀进程树（含子进程），/F 强制
      require('child_process').execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
    } catch (_) {
      try { proc.kill(); } catch (__) {}
    }
  } else {
    try { proc.kill(); } catch (_) {}
  }
}

// 文本流式吐出定时器（模拟逐字效果，避免整段一次性蹦出）
let streamTimers: NodeJS.Timeout[] = [];
let streamMaxDelay = 0;  // 本轮最大的 chunk 延迟（用于估算何时吐完）
// 杂项定时器引用（getCommands 超时等），窗口关闭时统一清理避免 UV_HANDLE_CLOSING 崩溃
let miscTimers: NodeJS.Timeout[] = [];
function clearAllTimers() {
  for (const t of streamTimers) clearTimeout(t);
  streamTimers = [];
  streamMaxDelay = 0;
  for (const t of miscTimers) clearTimeout(t);
  miscTimers = [];
}
// 把一段文本分块、按节奏推给前端（模拟流式打字，每块 ~12 字符，间隔 ~16ms）
function streamText(convId: string | null, text: string) {
  const chunkSize = 12;
  const step = 16;
  for (let i = 0; i < text.length; i += chunkSize) {
    const piece = text.slice(i, i + chunkSize);
    const delay = (i / chunkSize) * step;
    streamMaxDelay = Math.max(streamMaxDelay, delay);
    const t = setTimeout(() => sendConv(convId, 'claude:chunk', piece), delay);
    streamTimers.push(t);
  }
}

function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}
// 发送事件并带上生成所属的对话 id（前端据此路由 chunk，切换对话不打断后台生成）
function sendConv(convId: string | null, channel: string, ...args: unknown[]) {
  send(channel, convId, ...args);
}

// 当前工作空间目录（用户可改）
ipcMain.handle('claude:set-workspace', (_e, dir: string) => {
  applyWorkspace(dir, true);
  return currentWorkspace();
});
ipcMain.handle('claude:get-workspace', () => currentWorkspace());
ipcMain.handle('claude:workspace-info', () => ({
  workspace: currentWorkspace(),
  picked: currentWorkspacePicked(),
}));
ipcMain.handle('claude:pick-directory', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths.length) {
    const dir = result.filePaths[0];
    applyWorkspace(dir, true);
    return currentWorkspace();
  }
  return null;
});

// 模型管理：列表 + 读取/设置当前对话模型
ipcMain.handle('claude:get-models', () => MODELS);
ipcMain.handle('claude:get-model', () => currentModel());
ipcMain.handle('claude:set-model', (_e, model: string | null) => {
  const c = conversations.find((c) => c.id === activeConvId);
  if (c) { c.model = model || null; saveConversations(); }
  return currentModel();
});

// 模式管理：列表 + 读取/设置当前对话权限模式
ipcMain.handle('claude:get-modes', () => MODES);
ipcMain.handle('claude:get-mode', () => currentMode());
ipcMain.handle('claude:set-mode', (_e, mode: string | null) => {
  const c = conversations.find((c) => c.id === activeConvId);
  if (c) { c.mode = mode || null; saveConversations(); }
  return currentMode();
});

// 启动一次 claude 对话
// confirmEnabled: 是否走两轮（第一轮 default 预览，第二轮 acceptEdits 执行）
// 核心执行体：抽出来供 claude:ask 和 claude:confirm-approve 复用
// onDone 回调：claude 进程真正结束（result 事件 / close）后调用，闸门用它驱动串行
function executeAsk(prompt: string, confirmEnabled: boolean, convId: string | null, onDone?: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let retried = false;
    // 统一收尾：保证 onDone 只调一次（多个 resolve 路径都可能触发）
    let doneFired = false;
    const fireDone = () => { if (!doneFired) { doneFired = true; onDone?.(); } };
    // 包装 resolve：先触发 onDone，再 resolve 给闸门
    const done = () => { fireDone(); resolve(); };
    // 显式传入本次生成所属的对话 id（不依赖全局 activeConvId，切对话不打扰后台路由）
    const genConvId = convId ?? activeConvId;
    // 按 convId 查该对话的 session / model / mode / workspace（不再用全局 current*）
    const convFor = () => conversations.find((c) => c.id === genConvId) || null;
    // 降级保护：确认模式依赖 --permission-mode（default/acceptEdits 切换）。
    // 探测不到 permission-mode 的极旧版 claude，强制退化为单轮 execute，保证不崩。
    detectFlags();
    if (confirmEnabled && permFlag !== 'mode') {
      confirmEnabled = false;
    }
    // 第一轮前清空收集到的变更意图
    if (confirmEnabled) { pendingChanges = []; pendingPrompt = prompt; confirmConvId = genConvId; }

    // phase: 'preview' = 第一轮(default 模式抓意图)，'execute' = 第二轮(acceptEdits 真跑)
    const runOnce = (useResume: boolean, phase: 'preview' | 'execute' = 'execute') => {
      const conv = convFor();
      // 用该对话自己的 workspace / session / model / mode（不受全局 activeConvId 切换影响）
      const convWs = conv?.workspace || currentWorkspace();
      workspace = convWs;  // spawn cwd 用它
      clearAllTimers();  // 清掉上一轮残留的吐字定时器
      const sid = conv?.sessionId ?? null;
      const model = conv?.model ?? null;
      const mode = conv?.mode || 'acceptEdits';
      detectFlags();  // 探测 claude 支持的 flag
      // 参数：2.1.34 及以上都支持，探测到才加（探测不到则退化保证能跑）
      // --verbose 必填：2.1.193 起 -p --output-format stream-json 不配 --verbose 直接报错退出
      // 注意：prompt 含换行时，若走 shell(Windows .cmd)，换行会被 shell 截断导致只发第一行。
      // 解决：prompt 通过 stdin 管道传（claude -p 从 stdin 读，支持多行），不走 args。
      const args = ['-p', '', '--output-format', 'stream-json', '--verbose'];
      // 逐字流式（实测 2.1.34 支持）
      if (partialMsgSupport) {
        args.push('--include-partial-messages');
      }
      // 权限放行：
      // - preview 阶段强制 default（写操作被拒，但我们能抓到 tool_use 意图）
      // - execute 阶段用 acceptEdits/bypassPermissions 真正执行
      // - 未开启确认时，按对话原有 mode 走（单轮）
      const effectiveMode = phase === 'preview' ? 'default' : mode;
      if (permFlag === 'mode') {
        args.push('--permission-mode', effectiveMode);
      } else if (permFlag === 'danger') {
        args.push('--dangerously-skip-permissions');
      }
      if (useResume && sid) {
        args.unshift('--resume', sid);
      }
      if (model) {
        args.push('--model', model);
      }

      const claudeBin = findClaude();

      // 启动前自检：验证 claudeBin 真能跑。失败就把诊断信息发给前端，
      // 避免前端"一直思考"却不知道为什么（GUI 不继承 shell PATH，claude 常找不到）
      try {
        execClaude(claudeBin, '--version', 10000);
      } catch (verr) {
        const home = require('os').homedir();
        const pathHead = (process.env.PATH || '').split(path.delimiter).slice(0, 8).join('\n  • ');
        const diag = `无法启动 claude。\n\n` +
          `findClaude 返回的路径：${claudeBin}\n` +
          `错误：${(verr as Error).message}\n\n` +
          `当前进程 PATH 前 8 项：\n  • ${pathHead}\n\n` +
          `请确认 claude 已安装：npm install -g @anthropic-ai/claude-code\n` +
          `常见 claude 位置（确认存在其一）：\n` +
          `  • ${home}\\AppData\\Roaming\\npm\\claude.cmd\n` +
          `  • ${home}\\AppData\\Local\\nvm\\<版本>\\claude.cmd`;
        sendConv(genConvId, 'claude:error', diag);
        sendConv(genConvId, 'claude:status', 'error');
        done();
        return;
      }

      sendConv(genConvId, 'claude:status', 'thinking');
      let buffer = '';
      let streamedAnyText = false;  // 是否已收到 text_delta（用于完整块兜底去重）
      let assistantFullTextSent = false;  // 完整 text 块是否已补差量（防重复）
      let anyOutput = false;        // 是否产生过任何 stdout（用于检测"启动即崩"）

      try {
        currentProc = spawn(claudeBin, args, {
          cwd: workspace,
          env: process.env,
          shell: process.platform === 'win32',
          // stdin 用 pipe：把多行 prompt 写入 stdin（避免 shell 模式截断换行）
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        // 立即把完整 prompt 写入 stdin 并关闭（claude -p '' 会从 stdin 读完整多行内容）
        // 写完 end() 关闭 stdin，避免 Windows claude.cmd 卡在等待输入
        if (currentProc.stdin) {
          currentProc.stdin.write(prompt);
          currentProc.stdin.end();
        }
      } catch (e) {
        send('claude:error', `无法启动 claude: ${(e as Error).message}`);
        send('claude:status', 'error');
        done();
        return;
      }

      const onLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let obj: any;
        try { obj = JSON.parse(trimmed); } catch (_) { return; }

        // 捕获 session_id
        if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
          const c = conversations.find((cc) => cc.id === genConvId);
          if (c) { c.sessionId = obj.session_id; saveConversations(); }
        }

        // API 限流重试
        if (obj.type === 'system' && obj.subtype === 'api_retry') {
          sendConv(genConvId, 'claude:chunk', `\n⏳ 请求繁忙，重试中 (${obj.attempt}/${obj.max_retries})…\n`);
        }

        // 流式增量（真实逐字，来自 --include-partial-messages）
        if (obj.type === 'stream_event' && obj.event?.type === 'content_block_delta') {
          const delta = obj.event?.delta;
          if (delta?.type === 'thinking_delta' && delta.thinking) {
            sendConv(genConvId, 'claude:event', { kind: 'thinking', text: delta.thinking });
            streamedAnyText = streamedAnyText || false;
          }
          else if (delta?.type === 'text_delta' && delta.text) {
            streamedAnyText = true;
            sendConv(genConvId, 'claude:chunk', delta.text);
          }
        }
        // 助手完整消息：工具调用用完整块（带完整 input）；text 仅在没收到任何 delta 时兜底
        else if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
          for (const block of obj.message.content) {
            if (block.type === 'tool_use') {
              // preview 阶段：收集写/执行类工具的意图（default 模式下这些会被拒，但参数已拿到）
              if (phase === 'preview' && WRITE_TOOLS.has(block.name)) {
                pendingChanges.push({ toolUseId: block.id, name: block.name, input: block.input });
              }
              sendConv(genConvId, 'claude:event', {
                kind: 'tool_use',
                toolUseId: block.id,
                name: block.name,
                input: block.input,
              });
            } else if (block.type === 'text' && block.text) {
              // 完整 text 块：若没流式过（旧 claude）整段吐出；
              // 若流式过，对比已发内容补差量（防止思考时间长导致流式不完整丢消息）
              if (!streamedAnyText) {
                streamText(genConvId, String(block.text));
              } else if (!assistantFullTextSent) {
                // 标记完整 text 已处理（一个 assistant 消息只补一次差量）
                assistantFullTextSent = true;
                sendConv(genConvId, 'claude:full-text', String(block.text));
              }
            }
          }
        }
        // user 消息里的 tool_result：把工具执行结果接到对应工具调用后面
        else if (obj.type === 'user' && Array.isArray(obj.message?.content)) {
          for (const block of obj.message.content) {
            if (block.type === 'tool_result') {
              sendConv(genConvId, 'claude:event', {
                kind: 'tool_result',
                toolUseId: block.tool_use_id,
                content: summarizeToolResult(block.content),
                isError: !!block.is_error,
              });
            }
          }
        }
        // 最终结果
      else if (obj.type === 'result') {
        // 检测 --resume 失败（session 不存在）：自动降级重试一次（不带 resume）
        if (
          obj.is_error &&
          useResume &&
          !retried &&
          Array.isArray(obj.errors) &&
          obj.errors.some((e: string) => /not a UUID|does not match|No conversation/i.test(e))
        ) {
          retried = true;
          // 清掉失效的 sessionId，避免后续继续用
          const c = conversations.find((cc) => cc.id === genConvId);
          if (c) { c.sessionId = null; saveConversations(); }
          killProcTree(currentProc);
          sendConv(genConvId, 'claude:chunk', '\n（会话已失效，重新发起…）\n');
          setTimeout(() => runOnce(false, phase), 200);
          return;
        }
        if (obj.session_id) {
          const c = conversations.find((cc) => cc.id === genConvId);
          if (c) { c.sessionId = obj.session_id; saveConversations(); }
        }
        // 用量：result 事件里带 usage / duration_ms / total_cost_usd，发给前端展示
        const usage = extractUsage(obj);
        if (usage) sendConv(genConvId, 'claude:usage', usage);
        // preview 阶段结束：若收集到写操作意图，发确认请求（不直接 done），等用户点执行
        if (phase === 'preview' && pendingChanges.length > 0 && confirmConvId === genConvId) {
          sendConv(genConvId, 'claude:confirm-request', pendingChanges);
          sendConv(genConvId, 'claude:status', 'awaiting-confirm');
        } else {
          sendConv(genConvId, 'claude:status', 'done');
        }
      }
    };

    currentProc!.stdout!.on('data', (chunk: Buffer) => {
      anyOutput = true;
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) onLine(line);
    });

    // stderr 实时攒起来（旧版 claude 不认新 flag 会把 "unknown option" 写这里）
    let stderrBuf = '';
    currentProc!.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    // 无自动超时（长回答不误杀）。用户可用停止按钮手动终止。
    // 启动即崩/PATH 错误等"真卡死"由 close 时的 anyOutput 检测兜底报错。

    currentProc!.on('error', (err) => {
      const msg = err.message.includes('ENOENT') || err.message.includes('spawn')
        ? `找不到 claude 命令。请确认已安装：npm install -g @anthropic-ai/claude-code\n（错误：${err.message}）`
        : `claude 启动失败: ${err.message}`;
      sendConv(genConvId, 'claude:error', msg);
      sendConv(genConvId, 'claude:status', 'error');
      done();
    });

    currentProc!.on('close', (code) => {
      if (buffer.trim()) onLine(buffer);
      if (retried) { done(); return; }
      // 启动即崩没输出（典型：旧版 claude 不认 --permission-mode / --include-partial-messages）
      // 必须明确报错，否则前端从 thinking→done 无内容，看起来就是"转圈后空白"
      if (!anyOutput && stderrBuf.trim()) {
        sendConv(genConvId, 'claude:error',
          `claude 启动失败（退出码 ${code}）：${stderrBuf.trim()}\n\n请升级 claude: npm install -g @anthropic-ai/claude-code@latest`);
        sendConv(genConvId, 'claude:status', 'error');
        done();
        return;
      }
      if (code !== 0 && stderrBuf.trim() && !retried) {
        sendConv(genConvId, 'claude:error', stderrBuf.trim());
      }
      // 等流式吐完再标记完成
      const pendingDelay = streamMaxDelay;
      // preview 阶段：result 事件已发 awaiting-confirm（或 done），close 不再强制覆盖状态
      // execute 阶段或未开启确认：正常标记 done
      const finish = () => {
        if (phase !== 'preview' || pendingChanges.length === 0 || confirmConvId !== genConvId) {
          sendConv(genConvId, 'claude:status', 'done');
        }
        currentProc = null;
        done();
      };
      if (pendingDelay > 0) setTimeout(finish, pendingDelay + 60);
      else finish();
    });
  };

    // 启动首次执行（带 --resume，失败会自动降级）
    // confirmEnabled: 第一轮用 preview（default 模式抓意图）；否则直接 execute
    runOnce(true, confirmEnabled ? 'preview' : 'execute');
  });
}

// 发起对话（前端入口）
// main 进程串行闸门：用 executeAsk 的 onDone 回调（claude 真正结束时触发）驱动下一条
// 不用 Promise.then：executeAsk 的 resolve 时机和 claude close 不一致，onDone 才准确
let askBusy = false;
let askQueue: Array<{ prompt: string; confirmEnabled: boolean; convId: string | null; resolve: () => void }> = [];
function runAskOne(prompt: string, confirmEnabled: boolean, convId: string | null, onQueueDone: () => void) {
  askBusy = true;
  executeAsk(prompt, confirmEnabled, convId, () => {
    if (askQueue.length > 0) {
      const item = askQueue.shift()!;
      runAskOne(item.prompt, item.confirmEnabled, item.convId, () => item.resolve());
    } else {
      askBusy = false;
    }
    onQueueDone();
  });
}
ipcMain.handle('claude:ask', (_e, prompt: string, confirmEnabled = false, convId: string | null = null) => {
  const cid = convId || activeConvId;  // 用发起对话的 id（切对话后仍路由回它）
  if (askBusy) {
    return new Promise<void>((resolve) => {
      askQueue.push({ prompt, confirmEnabled, convId: cid, resolve });
    });
  }
  return new Promise<void>((resolve) => {
    runAskOne(prompt, confirmEnabled, cid, () => resolve());
  });
});

// 用户点「执行」：用 acceptEdits 重跑第一轮的 prompt（第二轮真正落地）
ipcMain.handle('claude:confirm-approve', () => {
  if (!pendingPrompt || !confirmConvId) return;
  const prompt = pendingPrompt;
  const cid = confirmConvId;
  // 清空待确认状态
  pendingChanges = [];
  pendingPrompt = null;
  confirmConvId = null;
  // 第二轮：切到目标对话，execute phase（acceptEdits/bypassPermissions 真正执行）
  activeConvId = cid;
  sendConv(cid, 'claude:status', 'thinking');
  return executeAsk(prompt, false, cid);
});

// 用户点「拒绝」：清空待确认状态，标记对话结束
ipcMain.handle('claude:confirm-reject', () => {
  const cid = confirmConvId;
  pendingChanges = [];
  pendingPrompt = null;
  confirmConvId = null;
  if (cid) sendConv(cid, 'claude:status', 'done');
});

// 中断当前对话
ipcMain.handle('claude:stop', () => {
  clearAllTimers();  // 停掉还没吐完的文字
  killProcTree(currentProc);  // 杀进程树（Windows 下否则孤儿继续跑，前端终止无反应）
  currentProc = null;
  // 清空待确认状态（避免 stop 后还残留确认卡片）
  pendingChanges = [];
  pendingPrompt = null;
  confirmConvId = null;
  send('claude:status', 'done');
});

// ── 对话管理 IPC ──
ipcMain.handle('conv:list', () => ({
  conversations,
  activeId: activeConvId,
}));

// 新建对话，返回新对话 id；可选首条消息（用于设标题）
ipcMain.handle('conv:create', (_e, firstMessage?: string) => {
  // 新对话继承上一个激活对话的工作目录、模型和模式
  const inheritedWs = currentWorkspace();
  const inheritedModel = currentModel();
  const inheritedMode = currentMode();
  const conv: Conversation = {
    id: `c-${Date.now()}`,
    title: firstMessage ? makeTitle(firstMessage) : '新对话',
    sessionId: null,
    workspace: inheritedWs,
    workspacePicked: true,   // 继承当前工作空间，默认已选
    model: inheritedModel,
    mode: inheritedMode,
    createdAt: Date.now(),
  };
  conversations.unshift(conv);
  activeConvId = conv.id;
  saveConversations();
  return conv.id;
});

// 切换对话
ipcMain.handle('conv:switch', (_e, id: string) => {
  if (conversations.some((c) => c.id === id)) {
    activeConvId = id;
    return true;
  }
  return false;
});

// 删除对话
ipcMain.handle('conv:delete', (_e, id: string) => {
  conversations = conversations.filter((c) => c.id !== id);
  if (activeConvId === id) activeConvId = conversations[0]?.id ?? null;
  saveConversations();
  return { conversations, activeId: activeConvId };
});

// 重命名对话
ipcMain.handle('conv:rename', (_e, id: string, title: string) => {
  const c = conversations.find((c) => c.id === id);
  if (c) { c.title = title.slice(0, 60); saveConversations(); return true; }
  return false;
});

// 导入 session 文件：选 .jsonl（可多选）→ 解析成对话（提取 sessionId/标题/cwd）
// 已导入过的（sessionId 相同）跳过，返回跳过数给前端提示
ipcMain.handle('conv:import', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    title: '导入 claude session 对话',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Claude Session', extensions: ['jsonl'] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { conversations, activeId: activeConvId, skipped: 0, canceled: true };
  }
  const home = require('os').homedir();
  const baseWs = currentWorkspace();
  let skipped = 0;
  let firstImportedId: string | null = null;
  const stamp = Date.now();
  result.filePaths.forEach((file: string, i: number) => {
    // sessionId 取文件名（claude session 文件名就是 UUID）
    const sessionId = path.basename(file, '.jsonl');
    // 去重：已有相同 sessionId 的对话 → 跳过
    if (conversations.some((c) => c.sessionId === sessionId)) { skipped++; return; }
    // 解析：提取首条 user 文本（标题）和 cwd（工作目录）
    let title = '导入的对话';
    let cwd = '';
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj: any;
        try { obj = JSON.parse(line); } catch (_) { continue; }
        if (!cwd && obj.cwd) cwd = obj.cwd;
        if (!title || title === '导入的对话') {
          if (obj?.type === 'user' && obj?.message?.role === 'user') {
            const c = obj.message.content;
            if (typeof c === 'string') title = c;
            else if (Array.isArray(c)) {
              const txt = c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
              if (txt) title = txt;
            }
          }
        }
        if (cwd && title !== '导入的对话') break;
      }
    } catch (_) { /* 读取/解析失败：用默认标题、空 cwd */ }
    const conv: Conversation = {
      id: `c-${stamp}-${i}`,
      title: makeTitle(title) || '导入的对话',
      sessionId,
      workspace: cwd || baseWs,
      workspacePicked: true,
      model: null,
      mode: null,
      createdAt: Date.now(),
    };
    conversations.unshift(conv);
    if (!firstImportedId) firstImportedId = conv.id;
  });
  if (firstImportedId) {
    activeConvId = firstImportedId;
    saveConversations();
  }
  // 全部跳过：列表不变，仅返回 skipped 提示
  return { conversations, activeId: activeConvId, skipped };
});

// 首屏（无任何对话时）用户先选过的工作空间：供 conv:create 继承 &
// getWorkspace 返回，当用户选了空间但还没发消息（无对话）时也能记住
let pendingPickedWorkspace: string | null = null;
let pendingPicked: boolean = false;

// 更新当前激活对话的工作空间；无激活对话时记到 pendingPickedWorkspace（等创建对话时继承）
function applyWorkspace(dir: string, picked: boolean) {
  const c = conversations.find((c) => c.id === activeConvId);
  if (c) {
    c.workspace = dir || require('os').homedir();
    if (picked) c.workspacePicked = true;
    saveConversations();
  } else {
    // 首屏无对话：暂存，conv:create 时继承
    pendingPickedWorkspace = dir || null;
    pendingPicked = picked;
  }
}
ipcMain.handle('claude:new-chat', () => {
  const inheritedWs = currentWorkspace();
  const inheritedModel = currentModel();
  const inheritedMode = currentMode();
  const conv: Conversation = {
    id: `c-${Date.now()}`,
    title: '新对话',
    sessionId: null,
    workspace: inheritedWs,
    workspacePicked: true,   // 继承当前工作空间，默认已选
    model: inheritedModel,
    mode: inheritedMode,
    createdAt: Date.now(),
  };
  conversations.unshift(conv);
  activeConvId = conv.id;
  saveConversations();
  return conv.id;
});

// 获取可用的命令/技能/代理（跑一次极简查询，从 init 事件抓）+ skill 描述（读 SKILL.md）
export interface CmdItem {
  name: string;
  description?: string;
  path?: string;   // SKILL.md 绝对路径（二级弹窗按需读完整内容用）
}
// 命令项（结构化）：支持区分项目命令 / 内置命令，以及内置命令的 GUI 接管动作
export interface AliasCmdItem {
  name: string;
  description?: string;
  builtin?: boolean;                  // true = claude 内置/原生命令（非项目自定义）
  action?: 'clear' | 'model' | 'cost';  // 非空 = GUI 端接管（不透传给 claude）
}
export interface ClaudeItems {
  commands: AliasCmdItem[];
  skills: CmdItem[];
  agents: string[];
}

// skill 列表：纯文件扫描，即时返回（不依赖 claude 进程）
ipcMain.handle('claude:get-skills', () => { syncWorkspace(); return scanSkills(); });

// skill 完整内容（二级弹窗用）：读 SKILL.md 原文（去掉 frontmatter 的 --- 包裹）
ipcMain.handle('claude:skill-detail', (_e, skillPath: string) => {
  try {
    if (!skillPath || !fs.existsSync(skillPath)) return { content: '', error: '文件不存在' };
    const content = fs.readFileSync(skillPath, 'utf8');
    // 去掉 frontmatter ---  --- 包裹，保留内容（含 frontmatter 字段 + 正文）
    return { content };
  } catch (e) {
    return { content: '', error: (e as Error).message };
  }
});

// 文件列表：@ 提及用，列出指定子目录(默认顶层)的直接子项（可逐级进入，不递归）
// query: 文件名筛选；subdir: 相对 workspace 的子目录路径（如 "TradingAgents/assets"），空=顶层
ipcMain.handle('claude:list-files', (_e, query: string, subdir?: string) => {
  try {
    syncWorkspace();
    const q = (query || '').trim();
    // 解析目标目录：限制在 workspace 内（防 .. 越界）
    const sub = (subdir || '').trim();
    const target = sub && !path.isAbsolute(sub) && !sub.includes('..')
      ? path.join(workspace, sub)
      : workspace;
    const relBase = path.relative(workspace, target) || ''; // 当前目录相对 workspace 的路径
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(target, { withFileTypes: true }); }
    catch (_) { return []; }
    let out = entries
      .filter((e) => !e.name.startsWith('.'))                         // 跳过隐藏项
      .filter((e) => !SKIP_DIRS.has(e.name))                          // 跳过 node_modules/dist 等
      .map((e) => {
        const rel = relBase ? path.join(relBase, e.name) : e.name;    // 相对 workspace 的完整路径
        return { name: e.name, path: rel, isDir: e.isDirectory() };
      });
    // 目录优先，再按名称排序
    out.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    // 按 query 过滤（匹配文件名）
    if (q) {
      const lq = q.toLowerCase();
      out = out.filter((e) => e.name.toLowerCase().includes(lq));
    }
    return out.slice(0, 200);
  } catch (_) {
    return [];
  }
});

// 保存粘贴的图片到工作区 .gui-assets/，返回相对路径（供输入框 @提及，claude 在 workspace 运行能读到）
ipcMain.handle('claude:save-image', (_e, dataB64: string, ext: string) => {
  syncWorkspace();
  const dir = path.join(currentWorkspace(), '.gui-assets');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const safeExt = /^\.(png|jpg|jpeg|gif|webp|bmp)$/i.test('.' + ext) ? ext : 'png';
  const name = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const full = path.join(dir, name);
  try {
    fs.writeFileSync(full, Buffer.from(dataB64, 'base64'));
  } catch (e) {
    return { error: '保存失败：' + (e as Error).message };
  }
  return { path: path.join('.gui-assets', name) };
});

// 读取工作区下的图片，返回 dataURL（供前端 <img> 显示，绕开 file:// 的 CSP 限制）
ipcMain.handle('claude:read-image', (_e, relPath: string) => {
  syncWorkspace();
  // 只允许相对路径（防止读任意文件）；拼到工作区下
  if (!relPath || path.isAbsolute(relPath) || relPath.includes('..')) return { error: 'invalid path' };
  const full = path.join(currentWorkspace(), relPath);
  try {
    if (!fs.existsSync(full)) return { error: 'not found' };
    const buf = fs.readFileSync(full);
    const ext = path.extname(full).slice(1).toLowerCase().replace('jpg', 'jpeg') || 'png';
    return { dataUrl: `data:image/${ext};base64,${buf.toString('base64')}` };
  } catch (e) {
    return { error: '读取失败：' + (e as Error).message };
  }
});

// 同步主题到系统外观：mac 毛玻璃(vibrancy)的明暗跟随系统外观，
// 切换 app 主题时设 nativeTheme，让毛玻璃也跟着变浅/变深
ipcMain.handle('claude:set-native-theme', (_e, theme: 'light' | 'dark') => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
});

// 加载历史消息：从 claude session jsonl 文件解析对话历史
// 注意：用该 sessionId 所属对话的 workspace（而非全局 current），
// 否则切对话时 syncWorkspace 取了别的对话 cwd，加载到错误历史
ipcMain.handle('claude:load-history', (_e, sessionId: string) => {
  if (!sessionId) return [];
  const home = require('os').homedir();
  // 反查该 sessionId 对应对话的 workspace（历史文件路径依赖它）
  const targetConv = conversations.find((c) => c.sessionId === sessionId);
  let ws = '';
  if (targetConv?.workspace) ws = targetConv.workspace;
  else ws = currentWorkspace();
  const encodedCwd = ws.replace(/[/\\]/g, '-');
  const candidates = [
    path.join(home, '.claude/projects', encodedCwd, `${sessionId}.jsonl`),
  ];
  // 兜底：在所有 projects 子目录里找 session 文件
  let file = candidates.find((f) => { try { return fs.existsSync(f); } catch (_) { return false; } });
  if (!file) {
    try {
      const found = findFilesByName(path.join(home, '.claude/projects'), `${sessionId}.jsonl`, 3, 5);
      if (found.length) file = found[0];
    } catch (_) {}
  }
  if (!file) return [];

  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const msgs: { id: string; role: 'user' | 'assistant'; content: string }[] = [];
    for (const line of lines) {
      let obj: any;
      try { obj = JSON.parse(line); } catch (_) { continue; }
      const role = obj?.message?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      // 跳过工具调用产生的 user 消息（<command-*/工具结果）
      let content = '';
      const c = obj.message.content;
      if (typeof c === 'string') content = c;
      else if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type === 'text' && b.text) content += b.text;
        }
      }
      if (!content || content.startsWith('<command-') || content.startsWith('Caveat')) continue;
      msgs.push({ id: `${role}-${msgs.length}`, role, content });
    }
    return msgs;
  } catch (_) {
    return [];
  }
});

ipcMain.handle('claude:get-commands', () => {
  syncWorkspace();
  return new Promise<ClaudeItems>((resolve) => {
    const claudeBin = findClaude();
    detectFlags();
    // --max-turns 仅新版支持（2.1.34 的 --help 无此项），按探测结果决定是否加
    // 注意：空格 prompt 在新版 claude 不返回 init 事件(拿不到 slash_commands)，
    // 用一个极简有效 prompt，配 max-turns 1 让它拿到 init 后即可 kill，不真跑
    const cmds = ['-p', '.', '--output-format', 'stream-json', '--verbose'];
    if (maxTurnsSupport) cmds.push('--max-turns', '1');
    if (permFlag === 'mode') cmds.push('--permission-mode', 'acceptEdits');
    else if (permFlag === 'danger') cmds.push('--dangerously-skip-permissions');
    const proc = spawn(claudeBin, cmds, { cwd: workspace, env: process.env, shell: process.platform === 'win32' });
    let collected = '';
    let resolved = false;
    const finish = (items: ClaudeItems) => {
      if (resolved) return;
      resolved = true;
      resolve(items);
    };
    const collect = (chunk: Buffer) => {
      collected += chunk.toString('utf8');
      for (const line of collected.split(/\r?\n/)) {
        try {
          const obj = JSON.parse(line.trim());
          if (obj.type === 'system' && obj.subtype === 'init') {
            try { proc.kill(); } catch (_) {}
            // 项目自定义命令（init 事件里是 string[]），转成结构化项（builtin=false）
            const proj: AliasCmdItem[] = (Array.isArray(obj.slash_commands) ? obj.slash_commands : [])
              .filter((s: unknown): s is string => typeof s === 'string' && !!s)
              .map((s: string) => ({ name: s, builtin: false }));
            // skill 不用 init 的 skills 数组（那只是 claude 内置命令，无描述），
            // 改为直接用 SKILL.md 扫描结果（真正的插件/项目 skill，带描述）
            finish({
              commands: mergeCommands(proj),
              skills: scanSkills(),
              agents: Array.isArray(obj.agents) ? obj.agents : [],
            });
            return;
          }
        } catch (_) {}
      }
    };
    proc.stdout.on('data', collect);
    proc.on('close', () => finish({ commands: mergeCommands([]), skills: scanSkills(), agents: [] }));
    const t = setTimeout(() => { try { proc.kill(); } catch (_) {} finish({ commands: mergeCommands([]), skills: scanSkills(), agents: [] }); }, 8000);
    miscTimers.push(t);
  });
});

// 把项目命令和内置命令合并、去重（同名时项目命令优先），内置命令补全进补全菜单/
// ⌘P 面板，便于用户发现 /clear /model /cost 等原生 slash 命令（新版 claude init 不再返回这些）
function mergeCommands(projectCmds: AliasCmdItem[]): AliasCmdItem[] {
  const seen = new Set<string>();
  const out: AliasCmdItem[] = [];
  for (const c of projectCmds) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  for (const b of BUILTIN_COMMANDS) {
    if (seen.has(b.name)) continue;   // 项目已自定义同名命令则不覆盖
    seen.add(b.name);
    out.push({ name: b.name, description: b.desc, builtin: true, action: b.action });
  }
  return out;
}

// 暴露内置命令清单（前端拉取后合入补全/⌘P；与 get-commands 解耦，便于清晰区分）
ipcMain.handle('claude:builtin-commands', () =>
  BUILTIN_COMMANDS.map((b) => ({ name: b.name, description: b.desc, builtin: true, action: b.action }))
);

// /clear 接管：清除当前激活对话的 claude session（下次发送从全新 session 开始），
// 不动本地消息（保留可见历史，最接近交互式 /clear 语义）
ipcMain.handle('claude:clear-context', () => {
  const c = conversations.find((cc) => cc.id === activeConvId);
  if (c) { c.sessionId = null; saveConversations(); }
  return !!c;
});

// 单独把扫描逻辑抽出来：扫所有 SKILL.md，返回 {name, description}[] 作为 skill 来源
function scanSkills(): CmdItem[] {
  const home = require('os').homedir();
  const roots = [
    path.join(home, '.claude/skills'),
    path.join(home, '.zcode/cli/plugins/cache'),
    path.join(workspace, '.agents/skills'),
    path.join(workspace, '.claude/skills'),
  ];
  const seen = new Set<string>();
  const out: CmdItem[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let files: string[] = [];
    try {
      files = findFilesByName(root, 'SKILL.md', 6, 200);
    } catch (_) { continue; }
    for (const f of files) {
      if (seen.has(f)) continue;
      seen.add(f);
      try {
        const content = fs.readFileSync(f, 'utf8');
        const m = content.match(/^---\n([\s\S]*?)\n---/);
        if (!m) continue;
        const fm = m[1];
        const nameM = fm.match(/^name:\s*(.+)$/m);
        const descM = fm.match(/^description:\s*(.+)$/m);
        const name = nameM ? nameM[1].trim().replace(/^["']|["']$/g, '') : '';
        let desc = descM ? descM[1].trim().replace(/^["']|["']$/g, '') : '';
        if (!name) continue;
        // 不截断 description（二级弹窗需要完整；列表侧栏自行 truncate）
        // 去重：同名 skill 保留 path（用于按需读完整内容）
        out.push({ name, description: desc || undefined, path: f });
      } catch (_) {}
    }
  }
  return out;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  clearAllTimers();
  killProcTree(currentProc);
  // 释放 askQueue 中所有未决 Promise（避免 libuv 句柄悬空导致 Windows UV_HANDLE_CLOSING 崩溃）
  for (const item of askQueue) item.resolve();
  askQueue = [];
  if (process.platform !== 'darwin') app.quit();
});
