import { useState, useRef } from 'react';
import { useClaude } from './hooks/useClaude';
import { MessageList } from './components/MessageList';
import { InputBox } from './components/InputBox';
import { Sidebar } from './components/Sidebar';

export default function App() {
  const { messages, status, error, send, stop, newChat } = useClaude();
  // 输入框内容（命令列表点击时填入）
  const [draft, setDraft] = useState('');
  const draftRef = useRef<(text: string) => void>(() => {});

  // 点击命令 → 填入输入框
  const pickCommand = (cmd: string) => {
    setDraft(cmd + ' ');
    draftRef.current(cmd + ' ');
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部标题栏 */}
      <header style={{
        height: 40,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        borderBottom: '1px solid #21262d',
        background: '#010409',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}>
        <span style={{ marginLeft: 70, fontSize: 13, color: '#6e7681' }}>⚡ Claude</span>
        <button
          onClick={newChat}
          style={{
            marginLeft: 'auto',
            WebkitAppRegion: 'no-drag',
            border: '1px solid #30363d',
            background: '#161b22',
            color: '#c9d1d9',
            padding: '4px 12px',
            borderRadius: 6,
            fontSize: 12,
            cursor: 'pointer',
          } as React.CSSProperties}
        >
          新对话
        </button>
      </header>

      {/* 主体：侧边栏 + 对话区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar onPickCommand={pickCommand} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {error && (
            <div style={{
              padding: '8px 16px',
              background: 'rgba(248,81,73,.12)',
              color: '#ff7b72',
              fontSize: 12,
              borderBottom: '1px solid rgba(248,81,73,.25)',
              whiteSpace: 'pre-wrap',
            }}>
              ⚠️ {error}
            </div>
          )}

          <MessageList messages={messages} status={status} />

          <InputBox
            onSend={send}
            onStop={stop}
            status={status}
            draft={draft}
            registerDraftSetter={(fn) => (draftRef.current = fn)}
          />
        </div>
      </div>
    </div>
  );
}
