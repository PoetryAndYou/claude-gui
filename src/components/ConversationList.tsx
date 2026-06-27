import { useState, useMemo } from 'react';
import type { Conversation } from '../../electron/preload';
import { Icon } from './Icon';

// 按时间分桶：今天 / 昨天 / 本周 / 更早（Mail.app 式结构，编码时间信息）
function timeBucket(ts: number): string {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86400000;
  const diff = startToday - ts;
  if (diff < 0) return '今天';
  if (diff < day) return '昨天';
  if (diff < 7 * day) return '本周';
  return '更早';
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onImport,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onImport?: () => Promise<number>;   // 触发导入；返回跳过数供提示
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  // 按时间分桶（保留数组顺序，假定已按新→旧排好）
  const groups = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of filtered) {
      const b = search.trim() ? '' : timeBucket(c.createdAt);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered, search]);

  const startEdit = (c: Conversation) => {
    setEditingId(c.id);
    setEditText(c.title);
  };
  const commitEdit = () => {
    if (editingId && editText.trim()) onRename(editingId, editText.trim());
    setEditingId(null);
  };

  // 导入：调用注入的 onImport，跳过的（重复）条目数 >0 时提示
  const handleImport = async () => {
    if (!onImport) return;
    const skipped = await onImport();
    if (skipped > 0) {
      window.alert(`已跳过 ${skipped} 条已存在的对话`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <button onClick={onNew} style={{ ...newBtnStyle, flex: 1 }}>
          <Icon name="plus" size={14} color="var(--accent)" /> 新对话
        </button>
        {onImport && (
          <button
            onClick={handleImport}
            title="导入 claude session 对话"
            className="no-drag"
            style={importBtnStyle}
          >
            <Icon name="download" size={14} color="var(--accent)" />
          </button>
        )}
      </div>

      {/* 搜索框：内嵌底色，去硬边框 */}
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
          <Icon name="search" size={13} color="var(--text-faint)" />
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索对话…"
          style={searchInputStyle}
        />
      </div>

      {/* 列表：flex:1 自身滚动，按时间分组 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 2 }}>
        {conversations.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '12px 8px' }}>暂无对话</div>
        )}
        {conversations.length > 0 && filtered.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '12px 8px' }}>无匹配对话</div>
        )}
        {groups.map(([label, convs]) => (
          <div key={label || 'all'} style={{ marginBottom: 2 }}>
            {label && <div style={groupLabelStyle}>{label}</div>}
            {convs.map((c) => (
              <div
                key={c.id}
                onClick={() => !editingId && onSelect(c.id)}
                onDoubleClick={(e) => { e.stopPropagation(); startEdit(c); }}
                className={'conv-item' + (c.id === activeId ? ' active' : '')}
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
                      className="conv-del"
                      title="删除"
                    ><Icon name="close" size={12} color="var(--text-muted)" /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const newBtnStyle: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '7px 10px', borderRadius: 8, fontSize: 13, fontWeight: 500,
  background: 'var(--accent-soft)', color: 'var(--accent)',
  border: 'none', cursor: 'pointer',
};
// 导入按钮：与「新对话」等高并排，图标按钮
const importBtnStyle: React.CSSProperties = {
  flex: '0 0 auto', width: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '7px 0', borderRadius: 8, fontSize: 13, fontWeight: 500,
  background: 'var(--accent-soft)', color: 'var(--accent)',
  border: 'none', cursor: 'pointer',
};
const searchInputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(128,128,128,.14)',
  border: '1px solid transparent',
  color: 'inherit', padding: '6px 10px 6px 30px', borderRadius: 7,
  fontSize: 12.5, outline: 'none', fontFamily: 'inherit',
};
const groupLabelStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-faint)',
  padding: '10px 8px 4px', letterSpacing: 0.3, fontWeight: 500,
};
const editInputStyle: React.CSSProperties = {
  flex: 1, background: 'var(--bg-app)', border: '1px solid var(--accent)',
  color: 'var(--text)', borderRadius: 4, padding: '2px 6px', fontSize: 12.5, outline: 'none',
};
