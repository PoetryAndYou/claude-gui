import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, execSync, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const isDev = !!process.env.VITE_DEV;

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 480,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
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
// claude CLI 调用层
// 用 child_process.spawn 跑 claude -p --output-format stream-json
// 逐行解析 JSON，把增量文字推给前端
// ──────────────────────────────────────────────

// GUI 应用不读 shell 配置，PATH 里通常没有用户的 bin 目录（如 ~/.npm-global/bin）。
// 这里把常见的用户安装路径补进 PATH，让 claude 能被找到。
function ensureUserPath() {
  const { existsSync } = require('fs');
  const home = require('os').homedir();
  // macOS / Linux 上常见的 npm/volta/nvm/用户 bin 目录
  const extraDirs = [
    `${home}/.npm-global/bin`,
    `${home}/.local/bin`,
    `${home}/.volta/bin`,
    `${home}/.bun/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    // Windows nvm / npm 全局
    `${home}/AppData/Roaming/npm`,
    `${home}/AppData/Local/nvml`,
  ];
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
      const which = require('child_process').execSync(
        isWin ? `where ${c}` : `which ${c}`, { stdio: 'pipe' }
      ).toString().trim().split(/\r?\n/)[0];
      if (which && existsSync(which)) return which;
    } catch (_) {}
  }
  return 'claude';
}

// ──────────────────────────────────────────────
// 对话管理：多对话，每个对话 {id, title, sessionId, createdAt}
// 持久化到 userData/conversations.json，切换对话 = 切换 activeId + sessionId
// ──────────────────────────────────────────────
interface Conversation {
  id: string;            // GUI 内部 id
  title: string;         // 显示名（取首条消息）
  sessionId: string | null;  // claude 的 session_id（用于 --resume）
  createdAt: number;
}

let conversations: Conversation[] = [];
let activeConvId: string | null = null;

function convStorePath(): string {
  const dir = require('path').join(app.getPath('userData'), 'claude-gui-data');
  try { require('fs').mkdirSync(dir, { recursive: true }); } catch (_) {}
  return require('path').join(dir, 'conversations.json');
}

function loadConversations() {
  try {
    conversations = JSON.parse(require('fs').readFileSync(convStorePath(), 'utf8'));
  } catch (_) { conversations = []; }
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

// 当前正在运行的 claude 进程（用于中断）
let currentProc: ChildProcessWithoutNullStreams | null = null;

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
let workspace: string = require('os').homedir();

ipcMain.handle('claude:set-workspace', (_e, dir: string) => {
  workspace = dir || require('os').homedir();
  return workspace;
});
ipcMain.handle('claude:get-workspace', () => workspace);
ipcMain.handle('claude:pick-directory', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths.length) {
    workspace = result.filePaths[0];
    return workspace;
  }
  return null;
});

// 启动一次 claude 对话
ipcMain.handle('claude:ask', (_e, prompt: string) => {
  return new Promise<void>((resolve) => {
    let retried = false;
    // 记住本次生成属于哪个对话，切对话不影响后台 chunk 路由
    const genConvId = activeConvId;

    const runOnce = (useResume: boolean) => {
      const sid = currentSessionId();
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
      if (useResume && sid) {
        args.unshift('--resume', sid);
      }

      const claudeBin = findClaude();
      sendConv(genConvId, 'claude:status', 'thinking');
      let buffer = '';

      try {
        currentProc = spawn(claudeBin, args, {
          cwd: workspace,
          env: process.env,
          shell: process.platform === 'win32',
        });
      } catch (e) {
        send('claude:error', `无法启动 claude: ${(e as Error).message}`);
        send('claude:status', 'error');
        resolve();
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

        // 流式增量
        if (obj.type === 'stream_event' && obj.event?.type === 'content_block_delta') {
          const text = obj.event?.delta?.text;
          if (text) sendConv(genConvId, 'claude:chunk', text);
        }
        // 助手完整消息
        else if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'text' && block.text) sendConv(genConvId, 'claude:chunk', block.text);
          if (block.type === 'tool_use') {
            sendConv(genConvId, 'claude:chunk', `\n🔧 工具调用: ${block.name}\n`);
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
          try { if (currentProc) currentProc.kill(); } catch (_) {}
          sendConv(genConvId, 'claude:chunk', '\n（会话已失效，重新发起…）\n');
          setTimeout(() => runOnce(false), 200);
          return;
        }
        if (obj.session_id) {
          const c = conversations.find((cc) => cc.id === genConvId);
          if (c) { c.sessionId = obj.session_id; saveConversations(); }
        }
        sendConv(genConvId, 'claude:status', 'done');
      }
    };

    currentProc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) onLine(line);
    });

    let stderrBuf = '';
    currentProc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    currentProc.on('error', (err) => {
      const msg = err.message.includes('ENOENT') || err.message.includes('spawn')
        ? `找不到 claude 命令。请确认已安装：npm install -g @anthropic-ai/claude-code\n（错误：${err.message}）`
        : `claude 启动失败: ${err.message}`;
      sendConv(genConvId, 'claude:error', msg);
      sendConv(genConvId, 'claude:status', 'error');
      resolve();
    });

    currentProc.on('close', (code) => {
      if (buffer.trim()) onLine(buffer);
      if (retried) { resolve(); return; }
      if (code !== 0 && stderrBuf.trim() && !retried) {
        sendConv(genConvId, 'claude:error', stderrBuf.trim());
      }
      sendConv(genConvId, 'claude:status', 'done');
      currentProc = null;
      resolve();
    });
  };

    // 启动首次执行（带 --resume，失败会自动降级）
    runOnce(true);
  });
});

// 中断当前对话
ipcMain.handle('claude:stop', () => {
  if (currentProc) {
    try { currentProc.kill(); } catch (_) {}
    currentProc = null;
  }
  send('claude:status', 'done');
});

// ── 对话管理 IPC ──
ipcMain.handle('conv:list', () => ({
  conversations,
  activeId: activeConvId,
}));

// 新建对话，返回新对话 id；可选首条消息（用于设标题）
ipcMain.handle('conv:create', (_e, firstMessage?: string) => {
  const conv: Conversation = {
    id: `c-${Date.now()}`,
    title: firstMessage ? firstMessage.slice(0, 30) : '新对话',
    sessionId: null,
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

// 兼容旧的 new-chat（建空对话并激活）
ipcMain.handle('claude:new-chat', () => {
  const conv: Conversation = {
    id: `c-${Date.now()}`,
    title: '新对话',
    sessionId: null,
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
}
export interface ClaudeItems {
  commands: string[];
  skills: CmdItem[];
  agents: string[];
}

// skill 列表：纯文件扫描，即时返回（不依赖 claude 进程）
ipcMain.handle('claude:get-skills', () => scanSkills());

// 文件列表：@ 提及用，扫描工作空间下的文件/目录
ipcMain.handle('claude:list-files', (_e, query: string) => {
  try {
    const q = (query || '').trim();
    // 从工作空间根扫描，拼相对路径
    let cmd = `find "${workspace}" -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' 2>/dev/null | head -200`;
    const out = execSync(cmd, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).slice(0, 200);
    const entries = out.map((p) => {
      const rel = path.relative(workspace, p);
      const name = path.basename(p);
      let isDir = false;
      try { isDir = fs.statSync(p).isDirectory(); } catch (_) {}
      return { name, path: rel, isDir };
    });
    // 按 query 过滤
    if (q) {
      const lq = q.toLowerCase();
      return entries.filter((e) => e.name.toLowerCase().includes(lq) || e.path.toLowerCase().includes(lq)).slice(0, 50);
    }
    // 无 query 时优先列目录
    return entries.filter((e) => e.isDir || e.path.indexOf('/') === -1).slice(0, 50);
  } catch (_) {
    return [];
  }
});

// 加载历史消息：从 claude session jsonl 文件解析对话历史
ipcMain.handle('claude:load-history', (_e, sessionId: string) => {
  if (!sessionId) return [];
  const home = require('os').homedir();
  // session 文件在 ~/.claude/projects/<编码cwd>/<session>.jsonl，cwd 的 / 替换成 -
  const encodedCwd = workspace.replace(/\//g, '-');
  const candidates = [
    path.join(home, '.claude/projects', encodedCwd, `${sessionId}.jsonl`),
  ];
  // 兜底：在所有 projects 子目录里找 session 文件
  let file = candidates.find((f) => { try { return fs.existsSync(f); } catch (_) { return false; } });
  if (!file) {
    try {
      const found = execSync(`find "${path.join(home, '.claude/projects')}" -name "${sessionId}.jsonl" 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (found) file = found.split('\n')[0];
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
  return new Promise<ClaudeItems>((resolve) => {
    const claudeBin = findClaude();
    const args = ['-p', ' ', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'];
    const proc = spawn(claudeBin, args, { cwd: workspace, env: process.env, shell: process.platform === 'win32' });
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
            // skill 不用 init 的 skills 数组（那只是 claude 内置命令，无描述），
            // 改为直接用 SKILL.md 扫描结果（真正的插件/项目 skill，带描述）
            finish({
              commands: Array.isArray(obj.slash_commands) ? obj.slash_commands : [],
              skills: scanSkills(),
              agents: Array.isArray(obj.agents) ? obj.agents : [],
            });
            return;
          }
        } catch (_) {}
      }
    };
    proc.stdout.on('data', collect);
    proc.on('close', () => finish({ commands: [], skills: scanSkills(), agents: [] }));
    setTimeout(() => { try { proc.kill(); } catch (_) {} finish({ commands: [], skills: scanSkills(), agents: [] }); }, 8000);
  });
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
      files = execSync(`find "${root}" -name "SKILL.md" 2>/dev/null`, { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);
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
        if (desc.length > 80) desc = desc.slice(0, 78) + '…';
        out.push({ name, description: desc || undefined });
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
  if (currentProc) { try { currentProc.kill(); } catch (_) {} }
  if (process.platform !== 'darwin') app.quit();
});
