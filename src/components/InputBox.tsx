import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from 'react';
import type { ClaudeItems } from '../../electron/preload';
import { Icon } from './Icon';

interface CmdEntry { cmd: string; desc?: string; kind: '命令' | '技能' | '代理'; }
interface FileEntry { name: string; path: string; isDir: boolean; }

export function InputBox({
  onSend,
  onStop,
  status,
  draft,
  registerDraftSetter,
  commands,
  onLoadCommands,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  status: string;
  draft: string;
  registerDraftSetter: (fn: (text: string) => void) => void;
  commands: ClaudeItems;
  onLoadCommands: () => void;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isThinking = status === 'thinking';

  // / 补全
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const slashAnchor = useRef<number>(-1);

  // @ 文件提及
  const [atOpen, setAtOpen] = useState(false);
  const [atIdx, setAtIdx] = useState(0);
  const atAnchor = useRef<number>(-1);
  const [atFiles, setAtFiles] = useState<FileEntry[]>([]);
  const [atLoading, setAtLoading] = useState(false);

  const allCmds = useMemo<CmdEntry[]>(() => {
    const list: CmdEntry[] = [];
    const seen = new Set<string>();
    const add = (name: string, desc: string | undefined, kind: CmdEntry['kind']) => {
      const cmd = '/' + name;
      if (seen.has(cmd)) return;
      seen.add(cmd);
      list.push({ cmd, desc, kind });
    };
    commands.commands.forEach((c) => add(c, undefined, '命令'));
    commands.skills.forEach((s) => add(s.name, s.description, '技能'));
    commands.agents.forEach((c) => add(c, undefined, '代理'));
    return list;
  }, [commands]);

  const slashQuery = useMemo(() => {
    if (!slashOpen || slashAnchor.current < 0) return '';
    const after = text.slice(slashAnchor.current);
    const end = after.indexOf(' ');
    return (end === -1 ? after : after.slice(0, end)).toLowerCase();
  }, [text, slashOpen]);

  const filtered = useMemo(() => {
    if (!slashQuery) return allCmds;
    return allCmds.filter((c) => c.cmd.toLowerCase().includes(slashQuery) || (c.desc && c.desc.toLowerCase().includes(slashQuery)));
  }, [allCmds, slashQuery]);

  useEffect(() => {
    registerDraftSetter((t: string) => {
      setText(t);
      focusTextarea();
    });
  }, [registerDraftSetter]);

  useEffect(() => {
    if (draft && !text) setText(draft);
  }, [draft]);

  const focusTextarea = () => {
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 220) + 'px';
      }
    });
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isThinking) {
      // 思考中：不立即发送（会与当前回复冲突），但保留输入内容作草稿
      return;
    }
    onSend(trimmed);
    setText('');
    setSlashOpen(false);
    setAtOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const acceptSlash = (entry: CmdEntry) => {
    const before = text.slice(0, slashAnchor.current);
    setText(before + entry.cmd + ' ');
    setSlashOpen(false);
    focusTextarea();
  };

  // @ 文件补全：读取工作空间下的文件/目录
  const loadAtFiles = async (query: string) => {
    setAtLoading(true);
    const dirs = await window.claude.listFiles(query);
    setAtFiles(dirs);
    setAtIdx(0);
    setAtLoading(false);
  };

  const acceptAt = (entry: FileEntry) => {
    const before = text.slice(0, atAnchor.current);
    setText(before + entry.name + ' ');
    setAtOpen(false);
    focusTextarea();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // / 补全导航
    if (slashOpen && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((i) => (i + 1) % filtered.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx((i) => (i - 1 + filtered.length) % filtered.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); acceptSlash(filtered[slashIdx] || filtered[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); return; }
    }
    // @ 补全导航
    if (atOpen && atFiles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtIdx((i) => (i + 1) % atFiles.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAtIdx((i) => (i - 1 + atFiles.length) % atFiles.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); acceptAt(atFiles[atIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setAtOpen(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    const pos = e.target.selectionStart;
    const before = val.slice(0, pos);

    // 检测 / 触发
    const slashMatch = before.match(/(?:^|\s)\/([\w-]*)$/);
    if (slashMatch) {
      if (allCmds.length === 0) onLoadCommands();
      slashAnchor.current = before.lastIndexOf('/');
      setSlashOpen(true);
      setSlashIdx(0);
    } else {
      setSlashOpen(false);
    }

    // 检测 @ 触发
    const atMatch = before.match(/(?:^|\s)@([\w./-]*)$/);
    if (atMatch) {
      atAnchor.current = before.lastIndexOf('@');
      setAtOpen(true);
      loadAtFiles(atMatch[1]);
    } else {
      setAtOpen(false);
    }

    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  };

  // 同时只显示一个补全菜单
  const showSlash = slashOpen && filtered.length > 0;
  const showAt = atOpen && !showSlash;

  // 工具栏：插入 / 或 @ 触发补全
  const insertSlash = () => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    const newVal = text.slice(0, pos) + '/' + text.slice(pos);
    setText(newVal);
    slashAnchor.current = pos;
    setSlashOpen(true);
    if (allCmds.length === 0) onLoadCommands();
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos + 1, pos + 1); });
  };
  const insertAt = () => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    const newVal = text.slice(0, pos) + '@' + text.slice(pos);
    setText(newVal);
    atAnchor.current = pos;
    setAtOpen(true);
    loadAtFiles('');
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos + 1, pos + 1); });
  };

  return (
    <div style={{ position: 'relative', padding: '16px 20px 20px', borderTop: '1px solid #21262d', background: '#0d1117' }}>
      {/* / 补全菜单：限宽跟随输入框，不盖全行 */}
      {showSlash && <SlashMenu items={filtered} idx={slashIdx} onPick={acceptSlash} onHover={setSlashIdx} />}

      {/* @ 文件补全菜单 */}
      {showAt && (
        <div style={slashMenuStyle}>
          {atLoading ? (
            <div style={{ padding: '10px 14px', fontSize: 13, color: '#6e7681' }}>扫描中…</div>
          ) : atFiles.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 13, color: '#6e7681' }}>无匹配文件</div>
          ) : (
            atFiles.slice(0, 10).map((f, i) => (
              <div key={f.path} onMouseDown={(e) => { e.preventDefault(); acceptAt(f); }} onMouseEnter={() => setAtIdx(i)} style={slashItemStyle(i === atIdx)}>
                <span style={{ marginRight: 8, display: 'inline-flex', verticalAlign: 'middle' }}>
                  <Icon name={f.isDir ? 'folder' : 'file'} size={14} color={i === atIdx ? '#fff' : '#7d8590'} />
                </span>
                <span style={{ fontWeight: 500 }}>{f.name}</span>
                <span style={{ color: i === atIdx ? 'rgba(255,255,255,.5)' : '#6e7681', fontSize: 11, marginLeft: 8 }}>{f.path}</span>
              </div>
            ))
          )}
        </div>
      )}

      <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* 输入框容器：内部含 textarea + 底部操作栏 */}
        <div style={inputContainerStyle} ref={containerRef}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="给 claude 发送消息 · / 命令 · @ 文件 · Shift+Enter 换行"
            style={{ flex: 1, resize: 'none', border: 'none', background: 'transparent', color: '#e6edf3', padding: '12px 14px 4px', fontSize: 15, lineHeight: 1.6, fontFamily: 'inherit', outline: 'none', maxHeight: 200 }}
            onFocus={() => { if (containerRef.current) containerRef.current.style.borderColor = '#58a6ff'; }}
            onBlur={() => { if (containerRef.current) containerRef.current.style.borderColor = '#30363d'; }}
          />
          {/* 底部操作栏：左侧快捷按钮，右侧发送/停止 */}
          <div style={toolbarStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button onClick={insertSlash} style={toolBtnStyle} title="插入命令">
                <Icon name="command" size={16} color="#7d8590" />
              </button>
              <button onClick={insertAt} style={toolBtnStyle} title="提及文件">
                <span style={{ fontSize: 16, color: '#7d8590', fontWeight: 500, lineHeight: 1 }}>@</span>
              </button>
              {text && (
                <button onClick={() => { setText(''); focusTextarea(); }} style={toolBtnStyle} title="清空">
                  <Icon name="trash" size={15} color="#7d8590" />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isThinking ? (
                <button onClick={onStop} style={stopCircleBtnStyle} title="停止生成">
                  <span style={{ width: 10, height: 10, background: '#ff7b72', borderRadius: 2, display: 'inline-block' }} />
                </button>
              ) : (
                <button onClick={submit} disabled={!text.trim()} style={sendCircleBtnStyle(!text.trim())} title="发送">
                  <Icon name="arrowUp" size={16} color={!text.trim() ? '#484f58' : '#fff'} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// / 补全菜单组件：宽度跟随输入框（flex:1 的容器），不占满整行
function SlashMenu({ items, idx, onPick, onHover }: {
  items: CmdEntry[]; idx: number;
  onPick: (e: CmdEntry) => void; onHover: (i: number) => void;
}) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 选中项变化时，自动滚入菜单可视区（联动），但用 block:'nearest' 避免影响外层页面滚动
  useEffect(() => {
    const el = itemRefs.current[idx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  return (
    <div style={{
      ...slashMenuStyle,
      // 宽度只占输入框区域（避开右侧按钮宽度 12 + 按钮宽）
      left: 'max(20px, calc((100% - 880px) / 2 + 20px))',
      right: 'max(20px, calc((100% - 880px) / 2 + 132px))',
    }}>
      {items.slice(0, 8).map((entry, i) => (
        <div
          key={entry.cmd}
          ref={(el) => { itemRefs.current[i] = el; }}
          onMouseDown={(e) => { e.preventDefault(); onPick(entry); }}
          onMouseEnter={() => onHover(i)}
          style={slashItemStyle(i === idx)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={kindBadge(entry.kind)}>{entry.kind}</span>
            <span style={{ fontWeight: 600 }}>{entry.cmd}</span>
          </div>
          {entry.desc && (
            <div style={{ fontSize: 11, color: i === idx ? 'rgba(255,255,255,.7)' : '#6e7681', marginTop: 2, paddingLeft: 32 }}>{entry.desc}</div>
          )}
        </div>
      ))}
      {items.length > 8 && <div style={{ padding: '4px 12px', fontSize: 11, color: '#484f58' }}>还有 {items.length - 8} 项…</div>}
    </div>
  );
}

function kindBadge(kind: string): React.CSSProperties {
  const map: Record<string, string> = { '技能': '#bc8cff', '代理': '#3fb950', '命令': '#58a6ff' };
  const c = map[kind] || '#58a6ff';
  return {
    fontSize: 10, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
    background: `${c}33`, color: c,
  };
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: '-2px' }}>
      <path d="M2 12l20-9-9 20-2-7-9-4z" fill="currentColor" />
    </svg>
  );
}

// 输入框容器：圆角边框，内部含 textarea + 底部工具栏（ZCode 风格）
const inputContainerStyle: React.CSSProperties = {
  border: '1px solid #30363d', borderRadius: 16, background: '#161b22',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  transition: 'border-color .15s',
};

// 底部工具栏：左侧操作按钮 + 右侧发送/停止
const toolbarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '4px 6px 6px 6px',
};

// 工具栏小图标按钮
const toolBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, border: 'none', borderRadius: 8,
  background: 'transparent', cursor: 'pointer',
};

// 圆形发送按钮（ZCode 风格：深色圆角方块 + 上箭头）
function sendCircleBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 32, height: 32, borderRadius: 8, border: 'none',
    background: disabled ? '#21262d' : '#2f81f7',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background .12s',
  };
}
// 停止按钮（方形停止图标）
const stopCircleBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid #f8514966',
  background: 'rgba(248,81,73,.1)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const slashMenuStyle: React.CSSProperties = {
  position: 'absolute', bottom: '100%', marginBottom: 4,
  background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
  boxShadow: '0 -8px 24px rgba(0,0,0,.4)', maxHeight: 280, overflowY: 'auto', zIndex: 10,
};
function slashItemStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 12px', fontSize: 13, cursor: 'pointer', lineHeight: 1.4,
    background: active ? '#1f6feb' : 'transparent', color: active ? '#fff' : '#c9d1d9',
  };
}
