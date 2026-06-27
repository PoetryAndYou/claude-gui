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
  confirmEnabled,
  onToggleConfirm,
  queueCount,
  onClearQueue,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  status: string;
  draft: string;
  registerDraftSetter: (fn: (text: string) => void) => void;
  commands: ClaudeItems;
  onLoadCommands: () => void;
  confirmEnabled?: boolean;
  onToggleConfirm?: () => void;
  queueCount?: number;
  onClearQueue?: () => void;
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

  // 粘贴的图片附件：{ path(相对,发给claude用), preview(dataURL,缩略图预览用) }
  const [images, setImages] = useState<{ path: string; preview: string }[]>([]);
  // @提及的文件/文件夹：以彩色 chip 形式显示（不插进 textarea 文字）
  const [mentions, setMentions] = useState<FileEntry[]>([]);
  // @ 文件浏览器当前所在子目录（相对 workspace，空=顶层）
  const [atSubdir, setAtSubdir] = useState('');

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
    // 文字、图片、提及 至少有一个才能发
    if (!trimmed && images.length === 0 && mentions.length === 0) return;
    // 附件路径追加到消息文本：claude 读 @路径 指向的文件/图片
    const attachParts = [...mentions.map((m) => '@' + m.path), ...images.map((im) => '@' + im.path)];
    const attach = attachParts.join(' ');
    const payload = attach ? (trimmed ? trimmed + '\n' + attach : attach) : trimmed;
    onSend(payload);   // 思考中也调用：send 内部会入队，回复完自动发送
    setText('');
    setSlashOpen(false);
    setAtOpen(false);
    setImages([]);
    setMentions([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const acceptSlash = (entry: CmdEntry) => {
    const before = text.slice(0, slashAnchor.current);
    setText(before + entry.cmd + ' ');
    setSlashOpen(false);
    focusTextarea();
  };

  // @ 文件补全：读取 atSubdir 目录下的直接子项
  const loadAtFiles = async (query: string) => {
    setAtLoading(true);
    const dirs = await window.claude.listFiles(query, atSubdir);
    setAtFiles(dirs);
    setAtIdx(0);
    setAtLoading(false);
  };

  // @ 浏览器进入子目录
  const enterDir = (dir: FileEntry) => {
    setAtSubdir(dir.path);
    setAtIdx(0);
    setAtLoading(true);
    window.claude.listFiles('', dir.path).then((d) => { setAtFiles(d); setAtLoading(false); });
  };
  // @ 浏览器返回上一级
  const goUp = () => {
    const parent = atSubdir.includes('/') ? atSubdir.slice(0, atSubdir.lastIndexOf('/')) : '';
    setAtSubdir(parent);
    setAtIdx(0);
    setAtLoading(true);
    window.claude.listFiles('', parent).then((d) => { setAtFiles(d); setAtLoading(false); });
  };

  const acceptAt = (entry: FileEntry) => {
    // 点文件夹=进入子目录；点文件=选中（作为 chip 提及附件）
    if (entry.isDir) { enterDir(entry); return; }
    setMentions((prev) => prev.some((m) => m.path === entry.path) ? prev : [...prev, entry]);
    // 从 textarea 删掉触发用的 @ 及其后已输入的筛选文本
    const el = textareaRef.current;
    const pos = el ? el.selectionStart : text.length;
    const at = atAnchor.current;
    const before = text.slice(0, Math.min(at, pos));
    const after = text.slice(pos);
    setText(before + after);
    setAtOpen(false);
    focusTextarea();
  };
  // 选中当前目录本身（@一个文件夹给 claude）
  const acceptCurrentDir = () => {
    if (!atSubdir) return;
    const name = atSubdir.includes('/') ? atSubdir.slice(atSubdir.lastIndexOf('/') + 1) : atSubdir;
    setMentions((prev) => prev.some((m) => m.path === atSubdir) ? prev : [...prev, { name, path: atSubdir, isDir: true }]);
    const el = textareaRef.current;
    const pos = el ? el.selectionStart : text.length;
    const at = atAnchor.current;
    setText(text.slice(0, Math.min(at, pos)) + text.slice(pos));
    setAtOpen(false);
    focusTextarea();
  };

  // 粘贴图片：存到工作区 .gui-assets/，在输入框内显示缩略图块（不插文字路径）
  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let img: File | null = null;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        img = it.getAsFile();
        break;
      }
    }
    if (!img) return; // 非图片，走默认粘贴
    e.preventDefault();
    const ext = (img.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    // dataURL 同时用于预览（内存）和传给主进程存盘
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(img!);
    });
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const res = await window.claude.saveImage(b64, ext);
    if (res.error || !res.path) return;
    setImages((prev) => [...prev, { path: res.path!, preview: dataUrl }]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // / 补全导航
    if (slashOpen && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((i) => (i + 1) % filtered.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx((i) => (i - 1 + filtered.length) % filtered.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); acceptSlash(filtered[slashIdx] || filtered[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); return; }
    }
    // @ 补全导航（循环范围 = 实际显示的条数，与菜单一致）
    if (atOpen && atFiles.length > 0) {
      const max = Math.min(atFiles.length, 100);
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtIdx((i) => (i + 1) % max); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAtIdx((i) => (i - 1 + max) % max); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); acceptAt(atFiles[Math.min(atIdx, max - 1)]); return; }
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
    // @ 触发：支持中文文件名（一-龥）+ 英文/数字/常见符号，否则中文筛不出
    const atMatch = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (atMatch) {
      atAnchor.current = before.lastIndexOf('@');
      setAtOpen(true);
      loadAtFiles(atMatch[1]);
    } else {
      setAtOpen(false);
      setAtSubdir(''); // @ 关闭后重置到顶层，下次重新从根开始浏览
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
    setAtSubdir(''); // 从顶层开始
    setAtOpen(true);
    setAtLoading(true);
    window.claude.listFiles('', '').then((d) => { setAtFiles(d); setAtIdx(0); setAtLoading(false); });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos + 1, pos + 1); });
  };

  return (
    <div style={{ position: 'relative', padding: '16px 20px 20px', borderTop: '1px solid var(--border-soft)', background: 'var(--bg-app)' }}>
      {/* / 补全菜单：限宽跟随输入框，不盖全行 */}
      {showSlash && <SlashMenu items={filtered} idx={slashIdx} onPick={acceptSlash} onHover={setSlashIdx} />}

      {/* @ 文件补全菜单 */}
      {showAt && (
        <AtMenu
          files={atFiles}
          loading={atLoading}
          idx={atIdx}
          subdir={atSubdir}
          onPick={acceptAt}
          onHover={setAtIdx}
          onUp={goUp}
          onSelectDir={acceptCurrentDir}
        />
      )}

      <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* 输入框容器：内部含 textarea + 底部操作栏 */}
        <div style={inputContainerStyle} ref={containerRef}>
          {/* 附件区：@提及的文件/文件夹 chip + 粘贴的图片缩略图 */}
          {(mentions.length > 0 || images.length > 0) && (
            <div style={{ display: 'flex', gap: 8, padding: '10px 12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
              {mentions.map((m) => (
                <div key={m.path} style={mentionChipStyle}>
                  <Icon name={m.isDir ? 'folder' : 'file'} size={13} color="#e0995e" />
                  <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}{m.isDir ? '/' : ''}</span>
                  <button
                    title="移除"
                    onClick={() => setMentions((prev) => prev.filter((x) => x.path !== m.path))}
                    style={chipDelBtnStyle}
                  >×</button>
                </div>
              ))}
              {images.map((im) => (
                <div key={im.path} style={thumbWrapStyle}>
                  <img src={im.preview} alt="" style={thumbImgStyle} />
                  <button
                    title="移除"
                    onClick={() => setImages((prev) => prev.filter((x) => x.path !== im.path))}
                    style={thumbDelBtnStyle}
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={2}
            placeholder="发消息给 Claude…"
            style={{ flex: 1, resize: 'none', border: 'none', background: 'transparent', color: 'var(--text)', padding: '12px 14px 4px', fontSize: 15, lineHeight: 1.6, fontFamily: 'inherit', outline: 'none', maxHeight: 200 }}
            onFocus={() => { if (containerRef.current) containerRef.current.style.borderColor = 'var(--accent)'; }}
            onBlur={() => { if (containerRef.current) containerRef.current.style.borderColor = 'var(--border)'; }}
          />
          {/* 底部操作栏：左侧快捷按钮，右侧发送/停止 */}
          <div style={toolbarStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button onClick={insertSlash} style={toolBtnStyle} title="插入命令">
                <Icon name="command" size={16} color="var(--text-muted)" />
              </button>
              <button onClick={insertAt} style={toolBtnStyle} title="提及文件">
                <span style={{ fontSize: 16, color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1 }}>@</span>
              </button>
              {onToggleConfirm && (
                <button
                  onClick={onToggleConfirm}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500,
                    border: confirmEnabled ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: confirmEnabled ? 'var(--accent-soft)' : 'transparent',
                    color: confirmEnabled ? 'var(--accent)' : 'var(--text-muted)',
                    transition: 'all .15s',
                  }}
                  title={confirmEnabled ? '变更前确认：开启（写操作需确认后执行）' : '变更前确认：关闭'}
                >
                  <Icon name="edit" size={13} color={confirmEnabled ? 'var(--accent)' : 'var(--text-muted)'} />
                  <span>确认</span>
                </button>
              )}
              {/* 消息队列计数：思考中再发的消息排队，点 × 清空 */}
              {queueCount != null && queueCount > 0 && onClearQueue && (
                <button
                  onClick={onClearQueue}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500,
                    border: '1px solid var(--accent)', background: 'var(--accent-soft)',
                    color: 'var(--accent)', transition: 'all .15s',
                  }}
                  title={`${queueCount} 条排队中，点击清空`}
                >
                  <Icon name="command" size={13} color="var(--accent)" />
                  <span>队列 {queueCount}</span>
                  <span style={{ fontSize: 13, lineHeight: 1, opacity: 0.7 }}>×</span>
                </button>
              )}
              {text && (
                <button onClick={() => { setText(''); focusTextarea(); }} style={toolBtnStyle} title="清空">
                  <Icon name="trash" size={15} color="var(--text-muted)" />
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isThinking ? (
                <button onClick={onStop} style={stopCircleBtnStyle} title="停止生成">
                  <span style={{ width: 10, height: 10, background: 'var(--red)', borderRadius: 2, display: 'inline-block' }} />
                </button>
              ) : (
                <button onClick={submit} disabled={!text.trim()} style={sendCircleBtnStyle(!text.trim())} title="发送">
                  <Icon name="arrowUp" size={16} color={!text.trim() ? 'var(--text-fainter)' : '#fff'} />
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
      {items.map((entry, i) => (
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
            <div style={{ fontSize: 11, color: i === idx ? 'rgba(255,255,255,.7)' : 'var(--text-faint)', marginTop: 2, paddingLeft: 32 }}>{entry.desc}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function kindBadge(kind: string): React.CSSProperties {
  const map: Record<string, string> = { '技能': 'var(--purple)', '代理': 'var(--green)', '命令': 'var(--accent)' };
  const c = map[kind] || 'var(--accent)';
  return {
    fontSize: 10, padding: '1px 5px', borderRadius: 3, fontWeight: 600,
    background: `${c}33`, color: c,
  };
}

// @ 文件补全菜单：顶部面包屑(当前目录+返回+选中当前目录) + 列出直接子项
function AtMenu({ files, loading, idx, subdir, onPick, onHover, onUp, onSelectDir }: {
  files: FileEntry[]; loading: boolean; idx: number; subdir: string;
  onPick: (e: FileEntry) => void; onHover: (i: number) => void;
  onUp: () => void; onSelectDir: () => void;
}) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const el = itemRefs.current[idx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const inSub = !!subdir; // 是否在子目录（决定显示返回上级 / 选中当前目录）
  const menuPos = { left: 'max(20px, calc((100% - 880px) / 2 + 20px))', right: 'max(20px, calc((100% - 880px) / 2 + 132px))' };

  if (loading) {
    return <div style={{ ...slashMenuStyle, ...menuPos, padding: '10px 14px', fontSize: 13, color: 'var(--text-faint)' }}>扫描中…</div>;
  }

  const shown = files.slice(0, 100);
  return (
    <div style={{ ...slashMenuStyle, ...menuPos }}>
      {/* 面包屑栏：当前目录路径 + 返回上级 + 选中当前目录 */}
      <div style={crumbBarStyle}>
        {inSub && (
          <button onMouseDown={(e) => { e.preventDefault(); onUp(); }} style={crumbBtnStyle} title="返回上级">‹</button>
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {inSub ? subdir : '当前工作空间'}
        </span>
        {inSub && (
          <button onMouseDown={(e) => { e.preventDefault(); onSelectDir(); }} style={{ ...crumbBtnStyle, color: 'var(--accent)' }} title="选中此目录">@ 此目录</button>
        )}
      </div>
      {shown.length === 0 && <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-faint)' }}>无匹配文件</div>}
      {shown.map((f, i) => {
        const active = i === idx;
        return (
        <div
          key={f.path}
          ref={(el) => { itemRefs.current[i] = el; }}
          onMouseDown={(e) => { e.preventDefault(); onPick(f); }}
          onMouseEnter={() => onHover(i)}
          style={{ ...slashItemStyle(active), display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {/* 文件夹用主题色图标 + 加粗 + 末尾 /；文件用灰色普通样式 → 视觉区分 */}
          <Icon
            name={f.isDir ? 'folder' : 'file'}
            size={14}
            color={active ? '#fff' : (f.isDir ? 'var(--accent)' : 'var(--text-muted)')}
          />
          <span style={{ fontWeight: f.isDir ? 600 : 400, color: active ? '#fff' : (f.isDir ? 'var(--text)' : 'var(--text-soft)') }}>
            {f.path}{f.isDir ? '/' : ''}
          </span>
        </div>
        );
      })}
      {files.length > 20 && <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-fainter)' }}>还有 {files.length - 20} 项，继续输入以筛选…</div>}
    </div>
  );
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
  border: '1px solid var(--border)', borderRadius: 16, background: 'var(--bg-input)',
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

// 图片缩略图块（Codex 风格）：40×40 圆角 + 右上角 × 删除
const thumbWrapStyle: React.CSSProperties = {
  position: 'relative', width: 40, height: 40, flex: '0 0 auto',
};
const thumbImgStyle: React.CSSProperties = {
  width: 40, height: 40, objectFit: 'cover',
  borderRadius: 6, border: '1px solid var(--border)', display: 'block',
};
const thumbDelBtnStyle: React.CSSProperties = {
  position: 'absolute', top: -6, right: -6,
  width: 16, height: 16, borderRadius: '50%',
  background: 'var(--text-muted)', color: '#fff',
  border: '1px solid var(--bg-input)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 11, lineHeight: 1, padding: 0,
};

// @提及 chip：圆角块，橙色图标 + 名称 + × 删除（ZCode/Cursor 风格）
const mentionChipStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  height: 28, padding: '0 6px 0 8px',
  borderRadius: 8, background: 'var(--bg-elev)',
  border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-soft)',
};
const chipDelBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 16, height: 16, borderRadius: '50%',
  border: 'none', background: 'transparent', cursor: 'pointer',
  color: 'var(--text-faint)', fontSize: 13, lineHeight: 1, padding: 0,
};

// @ 文件浏览器顶部面包屑栏
const crumbBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', borderBottom: '1px solid var(--border-soft)',
  fontSize: 12, color: 'var(--text-muted)', position: 'sticky', top: 0,
  background: 'var(--bg-elev)', zIndex: 1,
};
const crumbBtnStyle: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer',
  color: 'var(--text-muted)', fontSize: 14, padding: '0 4px',
};

// 圆形发送按钮（ZCode 风格：深色圆角方块 + 上箭头）
function sendCircleBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 32, height: 32, borderRadius: 8, border: 'none',
    background: disabled ? 'var(--border-soft)' : 'var(--accent-2)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background .12s',
  };
}
// 停止按钮（方形停止图标）
const stopCircleBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid var(--red-border-strong)',
  background: 'var(--red-soft)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const slashMenuStyle: React.CSSProperties = {
  position: 'absolute', bottom: '100%', marginBottom: 4,
  background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8,
  boxShadow: '0 -8px 24px var(--shadow)', maxHeight: 280, overflowY: 'auto', zIndex: 10,
};
function slashItemStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 12px', fontSize: 13, cursor: 'pointer', lineHeight: 1.4,
    background: active ? 'var(--accent-2)' : 'transparent', color: active ? '#fff' : 'var(--text-soft)',
  };
}
