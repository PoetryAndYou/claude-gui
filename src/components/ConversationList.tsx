import { useState } from 'react';
import type { Conversation } from '../../electron/preload';

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const startEdit = (c: Conversation) => {
    setEditingId(c.id);
    setEditText(c.title);
  };
  const commitEdit = () => {
    if (editingId && editText.trim()) onRename(editingId, editText.trim());
    setEditingId(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button onClick={onNew} style={newBtnStyle}>+ 新对话</button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '40vh', overflowY: 'auto' }}>
        {conversations.length === 0 && (
          <div style={{ fontSize: 12, color: '#6e7681', padding: '8px 4px' }}>暂无对话</div>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => !editingId && onSelect(c.id)}
            onDoubleClick={(e) => { e.stopPropagation(); startEdit(c); }}
            style={convItemStyle(c.id === activeId)}
            title="单击切换 · 双击重命名"
          >
            {editingId === c.id ? (
              <input
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                autoFocus
                style={editInputStyle}
              />
            ) : (
              <>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.title || '新对话'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                  style={delBtnStyle}
                  title="删除"
                >×</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const newBtnStyle: React.CSSProperties = {
  width: '100%', textAlign: 'left',
  background: '#1f6feb', border: 'none', color: '#fff',
  padding: '8px 12px', borderRadius: 6, fontSize: 13,
  cursor: 'pointer', marginBottom: 6, fontWeight: 500,
};
const convItemStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '7px 8px', borderRadius: 5, fontSize: 12,
  cursor: 'pointer',
  background: active ? '#161b22' : 'transparent',
  color: active ? '#e6edf3' : '#8b949e',
  border: active ? '1px solid #30363d' : '1px solid transparent',
  whiteSpace: 'nowrap',
});
const delBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#484f58',
  fontSize: 14, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
};
const editInputStyle: React.CSSProperties = {
  flex: 1, background: '#0d1117', border: '1px solid #58a6ff',
  color: '#e6edf3', borderRadius: 3, padding: '2px 6px', fontSize: 12, outline: 'none',
};
