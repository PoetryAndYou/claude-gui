import { useState, useEffect } from 'react';
import type { ClaudeItems, Conversation } from '../../electron/preload';
import type { Theme } from '../hooks/useClaude';
import { ConversationList } from './ConversationList';
import { Icon } from './Icon';
import { SkillDetailModal } from './SkillDetailModal';

export function Sidebar({
  theme,
  onPickCommand,
  conversations,
  activeConvId,
  onSelectConv,
  onNewConv,
  onDeleteConv,
  onRenameConv,
}: {
  theme: Theme;
  onPickCommand: (cmd: string) => void;
  conversations: Conversation[];
  activeConvId: string | null;
  onSelectConv: (id: string) => void;
  onNewConv: () => void;
  onDeleteConv: (id: string) => void;
  onRenameConv: (id: string, title: string) => void;
}) {
  const isLight = theme === 'light';
  // mac 透毛玻璃；Windows/Linux 无毛玻璃，侧栏用实色（跟主题），否则会透出窗口黑底变深字看不见
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const [workspace, setWorkspace] = useState('');
  const [items, setItems] = useState<ClaudeItems>({ commands: [], skills: [], agents: [] });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<{ commands: boolean; skills: boolean; agents: boolean }>({
    commands: false, skills: false, agents: false,
  });
  // 技能二级弹窗
  const [skillModal, setSkillModal] = useState<ClaudeItems['skills'][number] | null>(null);

  // 工作空间随对话切换变化（每个对话绑定自己的工作目录）
  useEffect(() => {
    window.claude.getWorkspace().then(setWorkspace);
  }, [activeConvId]);

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
      width: 232, flex: '0 0 auto',
      borderRight: '1px solid rgba(128,128,128,.2)',
      // mac：透明透毛玻璃；Windows/Linux：实色跟随主题（无毛玻璃可透，否则黑底深字看不见）
      background: isMac ? 'transparent' : (isLight ? '#ffffff' : '#0d1117'),
      padding: '12px 10px 10px',
      overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 0,
      color: isLight ? '#1f2328' : '#e6e9ef',   /* 浅主题深字 / 深主题浅字 */
    } as React.CSSProperties}>
      {/* 对话列表：占据剩余高度，自身滚动 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ConversationList
          conversations={conversations}
          activeId={activeConvId}
          onSelect={onSelectConv}
          onNew={onNewConv}
          onDelete={onDeleteConv}
          onRename={onRenameConv}
        />
      </div>

      {/* 次要工具：工作空间 + 命令/技能/代理。沉到底部，用细分隔线与对话区隔开 */}
      <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid rgba(128,128,128,.18)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={pickDir} title={workspace} style={{ ...footerBtnStyle, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="folder" size={14} color="var(--text-muted)" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortPath.length > 22 ? '…' + shortPath.slice(-21) : shortPath || '选择工作空间'}</span>
        </button>

        <button onClick={load} style={{ ...footerBtnStyle, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="zap" size={14} color="var(--accent)" />
          {loading ? '加载中…' : loaded ? '刷新命令/技能' : '加载命令/技能'}
        </button>

        {/* 三组列表 */}
        {loaded && !loading && (
          <>
            <CommandGroup
              title="命令" icon={<Icon name="command" size={12} color="var(--accent)" />} count={items.commands.length}
              collapsed={collapsed.commands}
              onToggle={() => toggle('commands')}
              renderItem={(c) => (
                <button key={c} onClick={() => onPickCommand('/' + c)} style={itemStyle}>/{c}</button>
              )}
              items={items.commands}
            />
            <CommandGroup
              title="技能" icon={<Icon name="star" size={12} color="var(--purple)" />} count={items.skills.length}
              collapsed={collapsed.skills}
              onToggle={() => toggle('skills')}
              renderItem={(s) => (
                <button
                  key={s.name}
                  onClick={() => setSkillModal(s)}
                  style={itemStyle}
                  title={s.description}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 500 }}>{s.name}</span>
                    <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.5 }}><path d="M2 3 L4 5 L6 3" fill="none" stroke="var(--text-faint)" strokeWidth="1.2"/></svg>
                  </div>
                  {s.description && (
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.description}
                    </div>
                  )}
                </button>
              )}
              items={items.skills}
            />
            <CommandGroup
              title="代理" icon={<Icon name="circle" size={12} color="var(--green)" />} count={items.agents.length}
              collapsed={collapsed.agents}
              onToggle={() => toggle('agents')}
              renderItem={(c) => (
                <button key={c} onClick={() => onPickCommand('/' + c)} style={itemStyle}>{c}</button>
              )}
              items={items.agents}
            />
            {items.commands.length === 0 && items.skills.length === 0 && items.agents.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 8px' }}>未获取到（请确认 claude 已登录）</div>
            )}
          </>
        )}
      </div>

      {/* 技能二级弹窗 */}
      <SkillDetailModal
        skill={skillModal}
        onClose={() => setSkillModal(null)}
        onTrigger={(name) => {
          setSkillModal(null);
          onPickCommand('/' + name);
        }}
      />
    </div>
  );
}

function CommandGroup<T>({
  title, icon, count, collapsed, onToggle, items, renderItem,
}: {
  title: string; icon: React.ReactNode; count: number;
  collapsed: boolean; onToggle: () => void;
  items: T[]; renderItem: (item: T) => React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div>
      <button onClick={onToggle} style={groupHeaderStyle}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon} {title} <span style={{ color: '#484f58' }}>{count}</span>
        </span>
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

// 底部次要按钮：内嵌底色，去硬边框，与对话区的视觉重量区分开
const footerBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'rgba(128,128,128,.1)', border: '1px solid transparent', color: 'inherit',
  padding: '7px 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const groupHeaderStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', color: 'var(--text-muted)',
  padding: '6px 4px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};
const itemStyle: React.CSSProperties = {
  display: 'block', textAlign: 'left', background: 'transparent', border: 'none',
  color: 'var(--text-muted)', padding: '5px 10px', borderRadius: 4,
  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', width: '100%',
  lineHeight: 1.4, whiteSpace: 'normal',
};
