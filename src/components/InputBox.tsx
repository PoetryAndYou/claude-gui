import { useState, useRef, useEffect, type KeyboardEvent } from 'react';

export function InputBox({
  onSend,
  onStop,
  status,
  draft,
  registerDraftSetter,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  status: string;
  draft: string;
  registerDraftSetter: (fn: (text: string) => void) => void;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isThinking = status === 'thinking';

  // 注册外部设置内容的函数（命令列表点击时调用）
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

  // 外部 draft 变化时同步（命令填入）
  useEffect(() => {
    if (draft && !text) setText(draft);
  }, [draft]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  };

  return (
    <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #21262d', background: '#0d1117' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={isThinking ? 'claude 正在回复…' : '输入消息，Enter 发送，Shift+Enter 换行'}
          style={textareaStyle}
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

const textareaStyle: React.CSSProperties = {
  flex: 1,
  resize: 'none',
  border: '1px solid #30363d',
  borderRadius: 10,
  background: '#161b22',
  color: '#e6edf3',
  padding: '10px 14px',
  fontSize: 14,
  lineHeight: 1.5,
  fontFamily: 'inherit',
  outline: 'none',
  maxHeight: 180,
  transition: 'border-color .15s',
};

function btnStyle(bg: string, disabled = false): React.CSSProperties {
  return {
    flex: '0 0 auto',
    padding: '10px 20px',
    border: 'none',
    borderRadius: 10,
    background: disabled ? '#21262d' : bg,
    color: disabled ? '#484f58' : '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
