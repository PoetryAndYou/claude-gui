import { useState, useEffect, useRef, useMemo } from 'react';
import type { Conversation, ClaudeItems, ModelItem } from '../../electron/preload';
import { Icon } from './Icon';

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  group: '对话' | '命令' | '视图' | '模型' | '模式' | '工作空间';
  icon: string;
  iconColor: string;
  run: () => void;
  keywords?: string;
}

// ⌘P 快捷命令面板：聚合对话切换、命令/skill、视图(主题/侧边栏)、模型、模式、换目录
export function CommandPalette({
  open, onClose,
  conversations, activeConvId,
  commands,
  models, currentModel,
  modes, currentMode,
  onSwitchConv, onNewConv,
  onPickCommand,
  onToggleTheme, onToggleSidebar,
  onSetModel, onSetMode, onPickDirectory,
}: {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConvId: string | null;
  commands: ClaudeItems;
  models: ModelItem[];
  currentModel: string | null;
  modes: ModelItem[];
  currentMode: string;
  onSwitchConv: (id: string) => void;
  onNewConv: () => void;
  onPickCommand: (cmd: string) => void;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
  onSetModel: (model: string | null) => void;
  onSetMode: (mode: string) => void;
  onPickDirectory: () => void;
}) {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 打开时聚焦输入框、重置
  useEffect(() => {
    if (open) {
      setQuery('');
      setIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 构建全部动作
  const allActions = useMemo<CommandAction[]>(() => {
    const acts: CommandAction[] = [];
    // 新对话
    acts.push({
      id: 'new', label: '新建对话', hint: '⌘K', group: '对话',
      icon: 'plus', iconColor: 'var(--green)', run: () => { onNewConv(); onClose(); },
    });
    // 切换到已有对话
    conversations.forEach((c) => {
      if (c.id === activeConvId) return;
      acts.push({
        id: 'conv:' + c.id, label: c.title || '新对话', hint: '切换对话', group: '对话',
        icon: 'chat', iconColor: 'var(--text-muted)',
        keywords: c.title, run: () => { onSwitchConv(c.id); onClose(); },
      });
    });
    // 命令（含内置命令）
    commands.commands.forEach((c) => {
      acts.push({
        id: 'cmd:' + c.name, label: '/' + c.name, hint: c.builtin ? '内置' : '命令', group: '命令',
        icon: 'command', iconColor: c.builtin ? 'var(--blue)' : 'var(--accent)',
        keywords: c.name + ' ' + (c.description || ''),
        run: () => { onPickCommand('/' + c.name); onClose(); },
      });
    });
    // 技能
    commands.skills.forEach((s) => {
      acts.push({
        id: 'skill:' + s.name, label: s.name, hint: s.description || '技能', group: '命令',
        icon: 'star', iconColor: 'var(--purple)',
        keywords: s.name + ' ' + (s.description || ''),
        run: () => { onPickCommand('/' + s.name); onClose(); },
      });
    });
    // 模型
    acts.push({
      id: 'model:default', label: '默认模型', hint: currentModel === null ? '当前' : '', group: '模型',
      icon: 'model', iconColor: 'var(--accent)',
      run: () => { onSetModel(null); onClose(); },
    });
    models.forEach((m) => {
      acts.push({
        id: 'model:' + m.alias, label: m.name + ' · ' + m.desc, hint: currentModel === m.alias ? '当前' : '', group: '模型',
        icon: 'model', iconColor: 'var(--accent)', keywords: m.alias,
        run: () => { onSetModel(m.alias); onClose(); },
      });
    });
    // 模式（权限）
    modes.forEach((m) => {
      acts.push({
        id: 'mode:' + m.alias, label: m.name + ' · ' + m.desc, hint: currentMode === m.alias ? '当前' : '', group: '模式',
        icon: 'gear', iconColor: 'var(--green)', keywords: m.alias,
        run: () => { onSetMode(m.alias); onClose(); },
      });
    });
    // 视图
    acts.push({
      id: 'theme', label: '切换主题（深/浅）', hint: '⌘⇧L', group: '视图',
      icon: 'sun', iconColor: 'var(--accent)',
      run: () => { onToggleTheme(); onClose(); },
    });
    acts.push({
      id: 'sidebar', label: '切换侧边栏', hint: '⌘B', group: '视图',
      icon: 'panel', iconColor: 'var(--text-muted)',
      run: () => { onToggleSidebar(); onClose(); },
    });
    // 工作空间
    acts.push({
      id: 'pickdir', label: '更换工作目录…', hint: '选择文件夹', group: '工作空间',
      icon: 'folder', iconColor: 'var(--text-muted)',
      run: () => { onPickDirectory(); onClose(); },
    });
    return acts;
  }, [conversations, activeConvId, commands, models, currentModel, modes, currentMode,
      onNewConv, onSwitchConv, onPickCommand, onToggleTheme, onToggleSidebar, onSetModel, onSetMode, onPickDirectory, onClose]);

  // 过滤
  const filtered = useMemo(() => {
    if (!query.trim()) return allActions;
    const q = query.toLowerCase();
    return allActions.filter((a) =>
      a.label.toLowerCase().includes(q) ||
      (a.keywords || '').toLowerCase().includes(q) ||
      a.group.includes(q)
    );
  }, [allActions, query]);

  // 选中项联动滚动
  useEffect(() => {
    const el = itemRefs.current[idx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [idx]);
  // query 变化重置选中
  useEffect(() => { setIdx(0); }, [query]);

  if (!open) return null;

  // 按组分段渲染
  const groupOrder: CommandAction['group'][] = ['对话', '命令', '视图', '模型', '模式', '工作空间'];
  let lastGroup = '';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)', maxHeight: '70vh',
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 16px 48px var(--shadow)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* 搜索框 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
          <Icon name="search" size={16} color="var(--text-faint)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); filtered[idx]?.run(); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            placeholder="搜索对话、命令、动作…（↑↓ 选择，回车执行，Esc 关闭）"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 15, fontFamily: 'inherit',
            }}
          />
        </div>
        {/* 列表 */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
              无匹配项
            </div>
          )}
          {filtered.map((a, i) => {
            const showGroup = a.group !== lastGroup;
            lastGroup = a.group;
            return (
              <div key={a.id}>
                {showGroup && (
                  <div style={groupLabelStyle}>{a.group}</div>
                )}
                <button
                  ref={(el) => { itemRefs.current[i] = el; }}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => a.run()}
                  style={actionItemStyle(i === idx)}
                >
                  <Icon name={a.icon} size={15} color={a.iconColor} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
                  {a.hint && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{a.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const groupLabelStyle: React.CSSProperties = {
  padding: '6px 14px 3px', fontSize: 10, fontWeight: 600,
  color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.5,
  position: 'sticky', top: 0, background: 'var(--bg-elev)',
};
function actionItemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '8px 14px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: 'var(--text-soft)', fontFamily: 'inherit', fontSize: 13,
    textAlign: 'left',
  };
}
