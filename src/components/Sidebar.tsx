import { useState, useEffect } from 'react';
import type { ClaudeItems, Conversation } from '../../electron/preload';
import type { Theme } from '../hooks/useClaude';
import { ConversationList } from './ConversationList';
import { Icon } from './Icon';

export function Sidebar({
  theme,
  onPickCommand,
  onOpenSkill,
  conversations,
  activeConvId,
  onSelectConv,
  onNewConv,
  onDeleteConv,
  onRenameConv,
  onImportConv,
  onWorkspaceChange,
}: {
  theme: Theme;
  onPickCommand: (cmd: string) => void;
  onOpenSkill: (skill: ClaudeItems['skills'][number]) => void;
  conversations: Conversation[];
  activeConvId: string | null;
  onSelectConv: (id: string) => void;
  onNewConv: () => void;
  onDeleteConv: (id: string) => void;
  onRenameConv: (id: string, title: string) => void;
  onImportConv?: () => Promise<number>;
  onWorkspaceChange?: () => void;   // 选/改工作空间后通知 App 刷新 picked 状态
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

  // 工作空间随对话切换变化（每个对话绑定自己的工作目录）
  useEffect(() => {
    window.claude.getWorkspace().then(setWorkspace);
  }, [activeConvId]);

  const pickDir = async () => {
    const dir = await window.claude.pickDirectory();
    if (dir) setWorkspace(dir);
    onWorkspaceChange?.();
  };

  // force=false: 切换展开/收起（未见数据则加载，已展开则收起）
  // force=true: 强制刷新（重新从 claude 拉取）
  const load = async (force = false) => {
    if (force) {
      // 刷新：重新拉取并确保展开
      setLoading(true);
      setLoaded(true);
      setCollapsedVisible(true);
      const list = await window.claude.getCommands();
      setItems(list);
      setLoading(false);
      return;
    }
    // 切换：没数据→加载并展开；有数据→收起/展开
    if (!loaded) {
      setLoading(true);
      setLoaded(true);
      setCollapsedVisible(true);
      const list = await window.claude.getCommands();
      setItems(list);
      setLoading(false);
    } else {
      // 有数据，切换显示
      setCollapsedVisible((v) => !v);
    }
  };
  // 列表是否可见（用于收起/展开）
  const [collapsedVisible, setCollapsedVisible] = useState(true);

  const shortPath = workspace.replace(/^\/Users\/[^/]+/, '~');

  const toggle = (key: 'commands' | 'skills' | 'agents') =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <div style={{
      width: 232, flex: '0 0 auto',
      borderRight: '1px solid rgba(128,128,128,.2)',
      // mac：透明透毛玻璃；Windows/Linux：实色跟随主题（无毛玻璃可透，否则黑底深字看不见）
      background: isMac ? 'transparent' : (isLight ? '#ffffff' : 'var(--bg-app)'),
      padding: '12px 10px 10px',
      // 根不滚动：对话列表区自己 flex:1 滚动，底部命令区独立滚动，互不挤压重叠
      overflow: 'hidden',
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
          onImport={onImportConv}
        />
      </div>

      {/* 次要工具：工作空间 + 命令/技能/代理。沉到底部，用细分隔线与对话区隔开。
          flex:0 0 auto 保证不被压缩；命令列表内部 maxHeight+滚动，多命令不挤压上方对话区 */}
      <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid rgba(128,128,128,.18)', display: 'flex', flexDirection: 'column', gap: 8, flex: '0 0 auto' }}>
        <button onClick={pickDir} title={workspace} style={{ ...footerBtnStyle, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="folder" size={14} color="var(--text-muted)" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortPath.length > 22 ? '…' + shortPath.slice(-21) : shortPath || '选择工作空间'}</span>
        </button>

        {/* 查看 + 刷新 分开：查看仅展示已加载（不跑 claude 不覆盖对话）；刷新才重新拉取 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
          <button onClick={() => load(false)} style={{ ...footerBtnStyle, flex: 1, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Icon name="zap" size={14} color="var(--accent)" />
            {!loaded ? '查看命令/技能' : collapsedVisible ? '收起命令技能' : '展开命令技能'}
          </button>
          <button
            onClick={() => load(true)}
            title="刷新（重新从 claude 拉取）"
            style={{
              flex: '0 0 auto', width: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(128,128,128,.1)', border: '1px solid transparent', cursor: 'pointer',
              borderRadius: 7, color: 'var(--text-muted)', fontFamily: 'inherit',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? 'spin .8s linear infinite' : 'none', transformOrigin: 'center' }}>
              <path d="M11.5 5 A4.5 4.5 0 1 0 12.5 8" />
              <path d="M11.5 2 L11.5 5 L8.5 5" />
            </svg>
          </button>
        </div>

        {/* 三组列表：独立滚动区，命令多时不挤压上方对话区。collapsedVisible 控制收起/展开 */}
        {loaded && !loading && collapsedVisible && (
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 2 }}>
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
                  onClick={() => onOpenSkill(s)}
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
          </div>
        )}
      </div>
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
