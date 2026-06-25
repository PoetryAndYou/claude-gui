import { useState, useRef, useEffect, useCallback } from 'react';
import { useClaude, type Theme } from './hooks/useClaude';
import { MessageList } from './components/MessageList';
import { InputBox } from './components/InputBox';
import { Sidebar } from './components/Sidebar';
import { Icon } from './components/Icon';

const THEME_KEY = 'claude-gui-theme';

export default function App() {
  const {
    messages, status, error, commands,
    convList, activeId,
    send, stop, newChat, switchConv, deleteConv, renameConv, loadCommands,
    regenerate, editAndResend,
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
  }, [theme]);
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  // 侧边栏折叠
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const pickCommand = (cmd: string) => {
    setDraft(cmd + ' ');
    draftRef.current(cmd + ' ');
  };

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Cmd/Ctrl+B：切换侧边栏
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setSidebarOpen((v) => !v); return; }
      // Cmd/Ctrl+K：新对话
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); newChat(); return; }
      // Cmd/Ctrl+Shift+L：切换主题（Shift+L）
      if ((e.key === 'l' || e.key === 'L') && e.shiftKey) { e.preventDefault(); toggleTheme(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat, toggleTheme]);

  const isMac = navigator.platform.toLowerCase().includes('mac');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部标题栏 */}
      <header style={{
        height: 40, flex: '0 0 auto',
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px 0 14px', borderBottom: '1px solid var(--border-soft)',
        background: 'var(--bg-elev-2)', WebkitAppRegion: 'drag',
      } as React.CSSProperties}>
        {/* 左侧红绿灯区域留白 */}
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
        {/* 右侧：主题切换 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={toggleTheme}
            className="no-drag"
            title={`切换${theme === 'dark' ? '浅色' : '深色'}主题 (⌘⇧L)`}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 4, color: 'var(--text-muted)' }}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} color="var(--text-muted)" />
          </button>
        </div>
      </header>

      {/* 主体：侧边栏 + 对话区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {sidebarOpen && (
          <Sidebar
            onPickCommand={pickCommand}
            conversations={convList}
            activeConvId={activeId}
            onSelectConv={switchConv}
            onNewConv={newChat}
            onDeleteConv={deleteConv}
            onRenameConv={renameConv}
          />
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {error && (
            <div style={{
              padding: '8px 16px', background: 'var(--red-soft)', color: 'var(--red)',
              fontSize: 12, borderBottom: '1px solid color-mix(in srgb, var(--red) 25%, transparent)', whiteSpace: 'pre-wrap',
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
          />

          <InputBox
            onSend={send}
            onStop={stop}
            status={status}
            draft={draft}
            registerDraftSetter={(fn) => (draftRef.current = fn)}
            commands={commands}
            onLoadCommands={loadCommands}
          />
        </div>
      </div>
    </div>
  );
}
