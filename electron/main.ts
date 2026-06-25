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

// 探测 claude 可执行路径（Windows 上可能是 claude.cmd / claude.ps1）
function findClaude(): string {
  const { existsSync } = require('fs');
  const isWin = process.platform === 'win32';
  // PATH 里的 claude（最常见）
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
  return 'claude'; // 兜底，让 spawn 报错给用户
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

// 启动一次 claude 对话
ipcMain.handle('claude:ask', (_e, prompt: string) => {
  return new Promise<void>((resolve) => {
    // 构造参数
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (sessionId) {
      args.unshift('--resume', sessionId);
    }

    const claudeBin = findClaude();
    send('claude:status', 'thinking');

    let buffer = ''; // 行缓冲（流式输出可能一行分多次到达）

    try {
      currentProc = spawn(claudeBin, args, {
        cwd: require('os').homedir(),
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
      send('claude:error', `claude 启动失败: ${err.message}\n（请确认 claude 已安装并在 PATH 中）`);
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
