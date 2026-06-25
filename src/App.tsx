import { useClaude } from './hooks/useClaude';
import { MessageList } from './components/MessageList';
import { InputBox } from './components/InputBox';

export default function App() {
  const { messages, status, error, send, stop, newChat } = useClaude();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部标题栏（可拖动） */}
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

      {/* 错误提示条 */}
      {error && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(248,81,73,.12)',
          color: '#ff7b72',
          fontSize: 12,
          borderBottom: '1px solid rgba(248,81,73,.25)',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* 消息列表 */}
      <MessageList messages={messages} status={status} />

      {/* 输入框 */}
      <InputBox onSend={send} onStop={stop} status={status} />
    </div>
  );
}
