import { useState, useMemo } from 'react';
import type { Conversation } from '../../electron/preload';
import { Icon } from './Icon';

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
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  const startEdit = (c: Conversation) => {
    setEditingId(c.id);
    setEditText(c.title);
  };
  const commitEdit = () => {
    if (editingId && editText.trim()) onRename(editingId, editText.trim());
    setEditingId(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button onClick={onNew} style={newBtnStyle}>
        <Icon name="plus" size={14} color="#fff" /> 新对话
      </button>

      {/* 搜索框 */}
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
          <Icon name="search" size={13} color="#6e7681" />
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索对话…"
          style={searchInputStyle}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '36vh', overflowY: 'auto' }}>
        {conversations.length === 0 && (
          <div style={{ fontSize: 12, color: '#6e7681', padding: '8px 4px' }}>暂无对话</div>
        )}
        {conversations.length > 0 && filtered.length === 0 && (
          <div style={{ fontSize: 12, color: '#6e7681', padding: '8px 4px' }}>无匹配对话</div>
        )}
        {filtered.map((c) => (
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
  cursor: 'pointer', fontWeight: 500,
  display: 'flex', alignItems: 'center', gap: 6,
};
const searchInputStyle: React.CSSProperties = {
  width: '100%', background: '#0d1117', border: '1px solid #30363d',
  color: '#c9d1d9', padding: '6px 10px 6px 28px', borderRadius: 6,
  fontSize: 12, outline: 'none', fontFamily: 'inherit',
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
