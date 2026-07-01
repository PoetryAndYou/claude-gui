import { useState, useMemo, useEffect } from 'react';
import type { Conversation } from '../../electron/preload';
import { Icon } from './Icon';

const COLLAPSE_KEY = 'claude-gui-collapsed-groups';

// 工作空间分组键：用完整 workspace 路径作内部 key（唯一）；
// 但用户看到的标题用 basename（短名）+ 完整路径悬浮提示。
// 空 workspace（未选过空间）归入特殊键 ''（标题「未分组」）。
function workspaceKey(c: Conversation): string {
  return (c.workspace || '').trim();
}
// 分组标题（短名）：取 basename，空/无归「未分组」
function workspaceTitle(key: string): string {
  if (!key) return '未分组';
  const parts = key.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || key;
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

  // 可折叠分组状态：key(完整 workspace 路径) → 是否折叠。默认全展开
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (_) { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch (_) {}
  }, [collapsed]);
  const toggleGroup = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // 当前激活对话所在组，切换对话时自动展开（保证选中项始终可见）
  useEffect(() => {
    if (!activeId) return;
    const activeConv = conversations.find((c) => c.id === activeId);
    if (!activeConv) return;
    const k = workspaceKey(activeConv);
    setCollapsed((c) => (c[k] ? { ...c, [k]: false } : c));
  }, [activeId, conversations]);

  // 按工作空间分组：搜索时平铺（不分组）。
  // 组内按 createdAt 倒序（最新在上）；多组按组内最新对话时间倒序。
  const groups = useMemo(() => {
    const byKey = new Map<string, Conversation[]>();
    for (const c of filtered) {
      const k = search.trim() ? '' : workspaceKey(c);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(c);
    }
    // 组内倒序
    for (const arr of byKey.values()) {
      arr.sort((a, b) => b.createdAt - a.createdAt);
    }
    // 组间按组内最新对话时间倒序
    const entries = Array.from(byKey.entries());
    entries.sort((a, b) => {
      const ta = a[1].length ? a[1][0].createdAt : 0;
      const tb = b[1].length ? b[1][0].createdAt : 0;
      return tb - ta;
    });
    return entries;
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

      {/* 列表：flex:1 自身滚动，按工作空间分组（可折叠） */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 2 }}>
        {conversations.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '12px 8px' }}>暂无对话</div>
        )}
        {conversations.length > 0 && filtered.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '12px 8px' }}>无匹配对话</div>
        )}
        {groups.map(([key, convs]) => {
          const isCollapsed = !!collapsed[key];
          const title = search.trim() ? '' : workspaceTitle(key);
          return (
            <div key={key || 'all'} style={{ marginBottom: 2 }}>
              {title && (
                <button
                  onClick={() => toggleGroup(key)}
                  className="no-drag"
                  title={key}
                  style={groupLabelStyle}
                >
                  <Icon name="folder" size={12} color="var(--text-faint)" />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                  <span style={{ color: 'var(--text-faint)' }}>{isCollapsed ? '▶' : '▼'}</span>
                </button>
              )}
              {!isCollapsed && convs.map((c) => (
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
          );
        })}
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
  display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, width: '100%',
  fontSize: 11, color: 'var(--text-faint)', textAlign: 'left',
  padding: '10px 8px 5px', letterSpacing: 0.3, fontWeight: 600,
  background: 'transparent', border: 'none', cursor: 'pointer',
};
const editInputStyle: React.CSSProperties = {
  flex: 1, background: 'var(--bg-app)', border: '1px solid var(--accent)',
  color: 'var(--text)', borderRadius: 4, padding: '2px 6px', fontSize: 12.5, outline: 'none',
};
