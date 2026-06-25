import { useState, useEffect } from 'react';
import type { ClaudeItems, Conversation } from '../../electron/preload';
import { ConversationList } from './ConversationList';

export function Sidebar({
  onPickCommand,
  conversations,
  activeConvId,
  onSelectConv,
  onNewConv,
  onDeleteConv,
  onRenameConv,
}: {
  onPickCommand: (cmd: string) => void;
  conversations: Conversation[];
  activeConvId: string | null;
  onSelectConv: (id: string) => void;
  onNewConv: () => void;
  onDeleteConv: (id: string) => void;
  onRenameConv: (id: string, title: string) => void;
}) {
  const [workspace, setWorkspace] = useState('');
  const [items, setItems] = useState<ClaudeItems>({ commands: [], skills: [], agents: [] });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<{ commands: boolean; skills: boolean; agents: boolean }>({
    commands: false, skills: false, agents: false,
  });

  useEffect(() => {
    window.claude.getWorkspace().then(setWorkspace);
  }, []);

  const pickDir = async () => {
    const dir = await window.claude.pickDirectory();
    if (dir) setWorkspace(dir);
  };

  const load = async () => {
    setLoading(true);
    setLoaded(true);
    const list = await window.claude.getCommands();
    setItems(list);
    setLoading(false);
  };

  const shortPath = workspace.replace(/^\/Users\/[^/]+/, '~');

  const toggle = (key: 'commands' | 'skills' | 'agents') =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <div style={{
      width: 230, flex: '0 0 auto',
      borderRight: '1px solid #21262d',
      background: '#010409',
      padding: '12px 10px',
      overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 14,
    } as React.CSSProperties}>
      {/* 对话列表 */}
      <ConversationList
        conversations={conversations}
        activeId={activeConvId}
        onSelect={onSelectConv}
        onNew={onNewConv}
        onDelete={onDeleteConv}
        onRename={onRenameConv}
      />

      {/* 工作空间 */}
      <div>
        <div style={labelStyle}>工作空间</div>
        <button onClick={pickDir} title={workspace} style={sideBtnStyle}>
          📁 {shortPath.length > 22 ? '…' + shortPath.slice(-21) : shortPath}
        </button>
      </div>

      {/* 拉取按钮 */}
      <button onClick={load} style={{ ...sideBtnStyle, color: '#58a6ff', borderColor: '#1f6feb33' }}>
        ⚡ {loading ? '加载中…' : loaded ? '刷新命令/技能' : '加载命令/技能'}
      </button>

      {/* 三组列表 */}
      {loaded && !loading && (
        <>
          <CommandGroup
            title="命令" icon="/" count={items.commands.length}
            collapsed={collapsed.commands}
            onToggle={() => toggle('commands')}
            renderItem={(c) => (
              <button key={c} onClick={() => onPickCommand('/' + c)} style={itemStyle}>
                /{c}
              </button>
            )}
            items={items.commands}
          />
          <CommandGroup
            title="技能" icon="★" count={items.skills.length}
            collapsed={collapsed.skills}
            onToggle={() => toggle('skills')}
            renderItem={(s) => (
              <button key={s.name} onClick={() => onPickCommand('/' + s.name)} style={itemStyle} title={s.description}>
                <div style={{ fontWeight: 500 }}>{s.name}</div>
                {s.description && <div style={{ fontSize: 10, color: '#6e7681', marginTop: 1 }}>{s.description}</div>}
              </button>
            )}
            items={items.skills}
          />
          <CommandGroup
            title="代理" icon="◎" count={items.agents.length}
            collapsed={collapsed.agents}
            onToggle={() => toggle('agents')}
            renderItem={(c) => (
              <button key={c} onClick={() => onPickCommand('/' + c)} style={itemStyle}>
                {c}
              </button>
            )}
            items={items.agents}
          />
          {items.commands.length === 0 && items.skills.length === 0 && items.agents.length === 0 && (
            <div style={{ fontSize: 12, color: '#6e7681' }}>未获取到（请确认 claude 已登录）</div>
          )}
        </>
      )}
    </div>
  );
}

function CommandGroup<T>({
  title, icon, count, collapsed, onToggle, items, renderItem,
}: {
  title: string; icon: string; count: number;
  collapsed: boolean; onToggle: () => void;
  items: T[]; renderItem: (item: T) => React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <button onClick={onToggle} style={groupHeaderStyle}>
        <span>{icon} {title} <span style={{ color: '#484f58' }}>{count}</span></span>
        <span style={{ color: '#484f58' }}>{collapsed ? '▶' : '▼'}</span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2 }}>
          {items.map((it) => renderItem(it))}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, color: '#6e7681', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const sideBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  background: '#161b22', border: '1px solid #30363d', color: '#c9d1d9',
  padding: '8px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const groupHeaderStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', color: '#8b949e',
  padding: '6px 4px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};
const itemStyle: React.CSSProperties = {
  display: 'block', textAlign: 'left', background: 'transparent', border: 'none',
  color: '#8b949e', padding: '5px 10px', borderRadius: 4,
  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', width: '100%',
  lineHeight: 1.4, whiteSpace: 'normal',
};
