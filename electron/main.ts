import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';

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

// 当前会话 id（用于 --resume 多轮对话）
let sessionId: string | null = null;
// 当前正在运行的 claude 进程（用于中断）
let currentProc: ChildProcessWithoutNullStreams | null = null;

function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
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
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (sessionId) {
      args.unshift('--resume', sessionId);
    }

    const claudeBin = findClaude();
    send('claude:status', 'thinking');

    let buffer = '';

    try {
      currentProc = spawn(claudeBin, args, {
        cwd: workspace,           // 用用户设的工作空间
        env: process.env,
        shell: process.platform === 'win32', // Windows 需要 shell 找 .cmd
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
      try { obj = JSON.parse(trimmed); } catch (_) { return; } // 非 JSON 行忽略

      // 捕获 session_id（用于后续 --resume）
      if (obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
        sessionId = obj.session_id;
      }

      // API 限流重试：通知前端，避免用户以为卡死
      if (obj.type === 'system' && obj.subtype === 'api_retry') {
        send('claude:chunk', `\n⏳ 请求繁忙，重试中 (${obj.attempt}/${obj.max_retries})…\n`);
      }

      // 流式增量文字（最常见的实时输出）
      if (obj.type === 'stream_event' && obj.event?.type === 'content_block_delta') {
        const text = obj.event?.delta?.text;
        if (text) send('claude:chunk', text);
      }
      // 助手完整消息块（非流式回退）
      else if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'text' && block.text) send('claude:chunk', block.text);
          if (block.type === 'tool_use') {
            send('claude:chunk', `\n🔧 工具调用: ${block.name}\n`);
          }
        }
      }
      // 最终结果
      else if (obj.type === 'result') {
        if (obj.session_id) sessionId = obj.session_id;
        send('claude:status', 'done');
      }
    };

    currentProc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // 按行切分（最后一行可能不完整，留在 buffer）
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
      send('claude:error', msg);
      send('claude:status', 'error');
      resolve();
    });

    currentProc.on('close', (code) => {
      // 处理 buffer 里残留的最后一行
      if (buffer.trim()) onLine(buffer);
      if (code !== 0 && stderrBuf.trim()) {
        send('claude:error', stderrBuf.trim());
      }
      // 进程结束时若状态还是 thinking，说明没收到 result 事件，补一个 done
      send('claude:status', 'done');
      currentProc = null;
      resolve();
    });
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

// 重置会话（清空上下文）
ipcMain.handle('claude:new-chat', () => {
  sessionId = null;
});

// 获取可用的命令/技能/代理（跑一次极简查询，从 init 事件抓）
interface ClaudeItems {
  commands: string[];
  skills: string[];
  agents: string[];
}
ipcMain.handle('claude:get-commands', () => {
  return new Promise<ClaudeItems>((resolve) => {
    const claudeBin = findClaude();
    const args = ['-p', ' ', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'];
    const proc = spawn(claudeBin, args, { cwd: workspace, env: process.env, shell: process.platform === 'win32' });
    let collected = '';
    const collect = (chunk: Buffer) => {
      collected += chunk.toString('utf8');
      for (const line of collected.split(/\r?\n/)) {
        try {
          const obj = JSON.parse(line.trim());
          if (obj.type === 'system' && obj.subtype === 'init') {
            proc.kill();
            resolve({
              commands: Array.isArray(obj.slash_commands) ? obj.slash_commands : [],
              skills: Array.isArray(obj.skills) ? obj.skills : [],
              agents: Array.isArray(obj.agents) ? obj.agents : [],
            });
            return;
          }
        } catch (_) {}
      }
    };
    proc.stdout.on('data', collect);
    proc.on('close', () => resolve({ commands: [], skills: [], agents: [] }));
    setTimeout(() => { try { proc.kill(); } catch (_) {} resolve({ commands: [], skills: [], agents: [] }); }, 8000);
  });
});

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
