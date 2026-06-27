import { Icon } from './Icon';

/**
 * 消息队列列表：显示在输入框上方
 * - 每条排队消息显示文本预览
 * - 单条删除（×）
 * - 单条立即执行（▶）—— 跳过队列顺序直接发这条
 * - 全部清空
 * 仅在有排队消息时显示
 */
export function QueueList({
  queue,
  onRemove,
  onRunNow,
  onClear,
}: {
  queue: string[];
  onRemove: (index: number) => void;
  onRunNow: (index: number) => void;
  onClear: () => void;
}) {
  if (queue.length === 0) return null;

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <Icon name="command" size={12} color="var(--accent)" />
        <span style={{ fontWeight: 600 }}>消息队列</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{queue.length} 条待发</span>
        <button onClick={onClear} style={clearBtnStyle} title="清空全部">
          <span style={{ fontSize: 11 }}>清空</span>
        </button>
      </div>
      {queue.map((msg, i) => (
        <div key={i} style={itemStyle}>
          <span style={indexStyle}>{i + 1}</span>
          <span style={previewStyle}>{msg.length > 60 ? msg.slice(0, 60) + '…' : msg}</span>
          <div style={{ display: 'flex', gap: 2, marginLeft: 'auto', flex: '0 0 auto' }}>
            <button
              onClick={() => onRunNow(i)}
              style={iconBtnStyle}
              title="插队立即执行"
            >
              <svg width="11" height="11" viewBox="0 0 11 11"><path d="M3 2 L9 5.5 L3 9 Z" fill="currentColor"/></svg>
            </button>
            <button
              onClick={() => onRemove(i)}
              style={iconBtnStyle}
              title="删除"
            >
              <svg width="11" height="11" viewBox="0 0 11 11"><path d="M2 2 L9 9 M9 2 L2 9" stroke="currentColor" strokeWidth="1.3"/></svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  margin: '0 12px 6px',
  border: '1px solid var(--accent)',
  borderRadius: 8,
  background: 'rgba(88,166,255,.06)',
  maxHeight: 200,
  overflowY: 'auto',
  flex: '0 0 auto',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', borderBottom: '1px solid var(--border-soft)',
  fontSize: 12, color: 'var(--text)',
  position: 'sticky', top: 0, background: 'rgba(88,166,255,.1)',
};
const clearBtnStyle: React.CSSProperties = {
  marginLeft: 'auto', padding: '2px 8px', borderRadius: 5,
  border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
};
const itemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 10px', borderBottom: '1px solid var(--border-soft)',
  fontSize: 12, color: 'var(--text-soft)',
};
const indexStyle: React.CSSProperties = {
  width: 18, height: 18, borderRadius: '50%', flex: '0 0 auto',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-elev)', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600,
};
const previewStyle: React.CSSProperties = {
  flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5,
};
const iconBtnStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 5, border: 'none',
  background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  transition: 'background .12s',
};
