import { useState, useRef, useEffect, useCallback } from 'react';
import { useClaude, type Theme } from './hooks/useClaude';
import { MessageList } from './components/MessageList';
import { InputBox } from './components/InputBox';
import { Sidebar } from './components/Sidebar';
import { Icon } from './components/Icon';
import { ModelSwitcher } from './components/ModelSwitcher';
import { ModeSwitcher } from './components/ModeSwitcher';
import { CommandPalette } from './components/CommandPalette';
import type { ModelItem } from '../electron/preload';

const THEME_KEY = 'claude-gui-theme';

// Windows 无边框窗口控制按钮样式（最小化/最大化/关闭）
const winBtnStyle: React.CSSProperties = {
  width: 38, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', fontFamily: 'inherit', transition: 'background .12s',
};

export default function App() {
  const {
    messages, status, error, commands,
    convList, activeId,
    send, stop, newChat, switchConv, deleteConv, renameConv, loadCommands,
    regenerate, editAndResend,
    confirmEnabled, setConfirmEnabled,
    confirmApprove, confirmReject,
    queue, clearQueue,
  } = useClaude();
  const [draft, setDraft] = useState('');
  const draftRef = useRef<(text: string) => void>(() => {});

  // 主题：从 localStorage 读，默认深色
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    return saved === 'light' ? 'light' : 'dark';
  });
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('dark', 'light');
    html.classList.add(theme);
    localStorage.setItem(THEME_KEY, theme);
    // 同步到系统外观，让 mac 毛玻璃明暗跟随
    window.claude.setNativeTheme(theme).catch(() => {});
  }, [theme]);
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  // 侧边栏折叠
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ⌘P 命令面板
  const [paletteOpen, setPaletteOpen] = useState(false);

  // 模型列表（命令面板用），对话切换时刷新当前模型由 ModelSwitcher 自管
  const [models, setModels] = useState<ModelItem[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  useEffect(() => {
    window.claude.getModels().then(setModels).catch(() => {});
  }, []);
  useEffect(() => {
    window.claude.getModel().then(setCurrentModel).catch(() => {});
  }, [activeId]);
  const setModel = useCallback(async (m: string | null) => {
    const next = await window.claude.setModel(m);
    setCurrentModel(next);
  }, []);

  // 模式列表（命令面板用），对话切换时刷新当前模式由 ModeSwitcher 自管
  const [modes, setModes] = useState<ModelItem[]>([]);
  const [currentMode, setCurrentMode] = useState<string>('acceptEdits');
  useEffect(() => {
    window.claude.getModes().then(setModes).catch(() => {});
  }, []);
  useEffect(() => {
    window.claude.getMode().then(setCurrentMode).catch(() => {});
  }, [activeId]);
  const setMode = useCallback(async (m: string) => {
    const next = await window.claude.setMode(m);
    setCurrentMode(next);
  }, []);

  const pickCommand = (cmd: string) => {
    setDraft(cmd + ' ');
    draftRef.current(cmd + ' ');
  };

  const pickDirectory = useCallback(async () => {
    await window.claude.pickDirectory();
  }, []);

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // ⌘P 命令面板（阻止浏览器打印对话框）
      if (e.key === 'p' || e.key === 'P') {
        if (!e.shiftKey) { e.preventDefault(); setPaletteOpen((o) => !o); return; }
      }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setSidebarOpen((v) => !v); return; }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); newChat(); return; }
      if ((e.key === 'l' || e.key === 'L') && e.shiftKey) { e.preventDefault(); toggleTheme(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat, toggleTheme]);

  const isMac = navigator.platform.toLowerCase().includes('mac');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: isMac ? 'transparent' : 'var(--bg-app)' }}>
      {/* 顶部标题栏 */}
      <header style={{
        height: 40, flex: '0 0 auto',
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px 0 14px', borderBottom: '1px solid var(--border-soft)',
        // mac：透毛玻璃；Windows/Linux：实色跟随主题（无毛玻璃，否则透出窗口黑底）
        background: isMac ? 'transparent' : 'var(--bg-elev-2)',
        // 自定义无边框标题栏：整个 header 可拖动窗口，按钮区域设 no-drag
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}>
        <span style={{ width: isMac ? 64 : 0, flex: '0 0 auto' }} />
        {/* 侧边栏切换 */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="no-drag"
          title="切换侧边栏 (⌘B)"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 4, color: 'var(--text-muted)' }}
        >
          <Icon name="panel" size={16} color="var(--text-muted)" />
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="bolt" size={14} color="var(--accent)" /> Claude
        </span>
        {/* 右侧：命令面板 + 模型 + 主题 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setPaletteOpen(true)}
            className="no-drag"
            title="命令面板 (⌘P)"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'transparent', border: '1px solid var(--border-soft)',
              borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
              color: 'var(--text-faint)', fontSize: 12,
            }}
          >
            <Icon name="search" size={13} color="var(--text-faint)" />
            <span>{isMac ? '⌘P' : 'Ctrl+P'}</span>
          </button>
          <ModelSwitcher convId={activeId} />
          <ModeSwitcher convId={activeId} />
          <button
            onClick={toggleTheme}
            className="no-drag"
            title={`切换${theme === 'dark' ? '浅色' : '深色'}主题 (⌘⇧L)`}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 4, color: 'var(--text-muted)' }}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} color="var(--text-muted)" />
          </button>
          {/* Windows/Linux 窗口控制按钮（mac 用原生红黄绿） */}
          {!isMac && (
            <div className="no-drag" style={{ display: 'flex', marginLeft: 4, marginRight: -10 }}>
              <button
                onClick={() => window.claude.win.minimize()}
                title="最小化"
                style={winBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(128,128,128,.18)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="5" width="9" height="1" fill="currentColor"/></svg>
              </button>
              <button
                onClick={() => window.claude.win.maximizeToggle()}
                title="最大化/还原"
                style={winBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(128,128,128,.18)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
              </button>
              <button
                onClick={() => window.claude.win.close()}
                title="关闭"
                style={{ ...winBtnStyle, borderBottomRightRadius: 6 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#e81123'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <svg width="11" height="11" viewBox="0 0 11 11"><path d="M1 1 L10 10 M10 1 L1 10" stroke="currentColor" strokeWidth="1.2"/></svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 主体：侧边栏 + 对话区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {sidebarOpen && (
          <Sidebar
            theme={theme}
            onPickCommand={pickCommand}
            conversations={convList}
            activeConvId={activeId}
            onSelectConv={switchConv}
            onNewConv={newChat}
            onDeleteConv={deleteConv}
            onRenameConv={renameConv}
          />
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-app)' }}>
          {error && (
            <div style={{
              padding: '8px 16px', background: 'var(--red-soft)', color: 'var(--red)',
              fontSize: 12, borderBottom: '1px solid var(--red-border)', whiteSpace: 'pre-wrap',
            }}>
              ⚠️ {error}
            </div>
          )}

          <MessageList
            messages={messages}
            status={status}
            theme={theme}
            onRegenerate={regenerate}
            onEdit={editAndResend}
            onConfirmApprove={confirmApprove}
            onConfirmReject={confirmReject}
          />

          <InputBox
            onSend={send}
            onStop={stop}
            status={status}
            draft={draft}
            registerDraftSetter={(fn) => (draftRef.current = fn)}
            commands={commands}
            onLoadCommands={loadCommands}
            confirmEnabled={confirmEnabled}
            onToggleConfirm={() => setConfirmEnabled(!confirmEnabled)}
            queueCount={queue.length}
            onClearQueue={clearQueue}
          />
        </div>
      </div>

      {/* ⌘P 命令面板 */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        conversations={convList}
        activeConvId={activeId}
        commands={commands}
        models={models}
        currentModel={currentModel}
        modes={modes}
        currentMode={currentMode}
        onSwitchConv={switchConv}
        onNewConv={newChat}
        onPickCommand={pickCommand}
        onToggleTheme={toggleTheme}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onSetModel={setModel}
        onSetMode={setMode}
        onPickDirectory={pickDirectory}
      />
    </div>
  );
}
