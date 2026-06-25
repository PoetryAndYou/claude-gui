import { useState, useRef, useEffect, type KeyboardEvent, useMemo } from 'react';
import type { ClaudeItems } from '../../electron/preload';

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
  const isThinking = status === 'thinking';

  // slash 命令自动补全状态
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const slashAnchor = useRef<number>(-1); // 输入框里 / 的位置

  // 合并所有命令（前置 / ）
  const allCmds = useMemo(() => {
    const list: string[] = [];
    commands.commands.forEach((c) => list.push('/' + c));
    commands.skills.forEach((c) => list.push('/' + c));
    commands.agents.forEach((c) => list.push('/' + c));
    return [...new Set(list)];
  }, [commands]);

  // 当前输入的 / 词，用于过滤
  const slashQuery = useMemo(() => {
    if (!slashOpen || slashAnchor.current < 0) return '';
    const after = text.slice(slashAnchor.current);
    const end = after.indexOf(' ');
    return (end === -1 ? after : after.slice(0, end)).toLowerCase();
  }, [text, slashOpen]);

  const filtered = useMemo(() => {
    if (!slashQuery) return allCmds;
    return allCmds.filter((c) => c.toLowerCase().includes(slashQuery));
  }, [allCmds, slashQuery]);

  // 注册外部 setter
  useEffect(() => {
    registerDraftSetter((t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + 'px';
        }
      });
    });
  }, [registerDraftSetter]);

  useEffect(() => {
    if (draft && !text) setText(draft);
  }, [draft]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;
    onSend(trimmed);
    setText('');
    setSlashOpen(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  // 接受选中的命令（替换输入框里的 /词）
  const acceptSlash = (cmd: string) => {
    const before = text.slice(0, slashAnchor.current);
    setText(before + cmd + ' ');
    setSlashOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 补全菜单激活时：箭头选择 / Tab/Enter 确认 / Esc 关闭
    if (slashOpen && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        acceptSlash(filtered[slashIdx] || filtered[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    // 检测是否刚打出 / 触发补全
    const pos = e.target.selectionStart;
    const before = val.slice(0, pos);
    const slashMatch = before.match(/(?:^|\s)\/([\w-]*)$/);
    if (slashMatch) {
      // 首次触发 / 时若命令没加载，自动加载
      if (allCmds.length === 0) onLoadCommands();
      slashAnchor.current = before.lastIndexOf('/');
      slashAnchor.current += 0; // 让 useEffect 捕获
      setSlashOpen(true);
      setSlashIdx(0);
    } else {
      setSlashOpen(false);
    }
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  };

  return (
    <div style={{ position: 'relative', padding: '12px 16px 16px', borderTop: '1px solid #21262d', background: '#0d1117' }}>
      {/* slash 命令补全菜单 */}
      {slashOpen && filtered.length > 0 && (
        <div style={slashMenuStyle}>
          {filtered.slice(0, 8).map((cmd, i) => (
            <div
              key={cmd}
              onMouseDown={(e) => { e.preventDefault(); acceptSlash(cmd); }}
              style={slashItemStyle(i === slashIdx)}
            >
              {cmd}
            </div>
          ))}
          {filtered.length > 8 && (
            <div style={{ padding: '4px 12px', fontSize: 11, color: '#484f58' }}>还有 {filtered.length - 8} 项…</div>
          )}
        </div>
      )}

      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={isThinking ? 'claude 正在回复…' : '输入消息，/ 触发命令，Enter 发送'}
          style={textareaStyle(slashOpen && filtered.length > 0)}
          onFocus={(e) => (e.target.style.borderColor = '#58a6ff')}
          onBlur={(e) => (e.target.style.borderColor = '#30363d')}
          disabled={isThinking}
        />
        {isThinking ? (
          <button onClick={onStop} style={btnStyle('#da3633')}>停止</button>
        ) : (
          <button onClick={submit} disabled={!text.trim()} style={btnStyle('#238636', !text.trim())}>发送</button>
        )}
      </div>
    </div>
  );
}

function textareaStyle(border: boolean): React.CSSProperties {
  return {
    flex: 1, resize: 'none',
    border: '1px solid #30363d',
    borderTopColor: border ? '#30363d' : '#30363d',
    borderRadius: 10, background: '#161b22', color: '#e6edf3',
    padding: '10px 14px', fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit',
    outline: 'none', maxHeight: 180, transition: 'border-color .15s',
  };
}
function btnStyle(bg: string, disabled = false): React.CSSProperties {
  return {
    flex: '0 0 auto', padding: '10px 20px', border: 'none', borderRadius: 10,
    background: disabled ? '#21262d' : bg, color: disabled ? '#484f58' : '#fff',
    fontSize: 14, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
const slashMenuStyle: React.CSSProperties = {
  position: 'absolute', bottom: '100%', left: 16, right: 16,
  maxWidth: 820, margin: '0 auto', marginBottom: 4,
  background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
  boxShadow: '0 -8px 24px rgba(0,0,0,.4)',
  maxHeight: 240, overflowY: 'auto', zIndex: 10,
};
function slashItemStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 12px', fontSize: 13, cursor: 'pointer',
    background: active ? '#1f6feb' : 'transparent',
    color: active ? '#fff' : '#c9d1d9',
  };
}
