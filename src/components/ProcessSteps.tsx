import { useState, useEffect, useRef } from 'react';
import type { ToolEvent } from '../../electron/preload';
import type { Theme } from '../hooks/useClaude';
import { Icon } from './Icon';

// 把工具参数对象格式化成可读文本
function fmtInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    const obj = input as Record<string, unknown>;
    // 常见工具：优先展示有意义的字段
    if (obj.command) return String(obj.command);
    if (obj.file_path) return String(obj.file_path);
    if (obj.pattern) return String(obj.pattern);
    if (obj.path) return String(obj.path);
    if (obj.query) return String(obj.query);
    return JSON.stringify(input, null, 2);
  } catch (_) {
    return String(input);
  }
}

// 截断长文本
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

// 工具图标/颜色映射
function toolMeta(name: string | undefined): { icon: string; color: string; label: string } {
  switch (name) {
    case 'Read': return { icon: 'file', color: 'var(--accent)', label: '读取文件' };
    case 'Write': return { icon: 'edit', color: 'var(--green)', label: '写入文件' };
    case 'Edit': case 'MultiEdit': return { icon: 'edit', color: 'var(--purple)', label: '编辑文件' };
    case 'Bash': return { icon: 'command', color: 'var(--green)', label: '执行命令' };
    case 'Grep': return { icon: 'search', color: 'var(--accent)', label: '搜索内容' };
    case 'Glob': return { icon: 'search', color: 'var(--accent)', label: '查找文件' };
    case 'WebSearch': case 'WebFetch': return { icon: 'search', color: 'var(--accent)', label: '网络搜索' };
    case 'Task': return { icon: 'circle', color: 'var(--purple)', label: '子任务' };
    default: return { icon: 'zap', color: 'var(--text-muted)', label: name || '工具' };
  }
}

// 代码 diff 预览：Edit（old→new 红绿行）、MultiEdit（多组）、Write（全绿新内容）
function DiffView({ name, input }: { name: string; input: unknown }) {
  const obj = (input || {}) as Record<string, any>;
  let pairs: { oldS: string; newS: string }[] = [];
  let filePath = '';
  if (name === 'Edit') {
    pairs = [{ oldS: String(obj.old_string ?? ''), newS: String(obj.new_string ?? '') }];
    filePath = String(obj.file_path ?? '');
  } else if (name === 'MultiEdit' && Array.isArray(obj.edits)) {
    pairs = obj.edits.map((e: any) => ({ oldS: String(e.old_string ?? ''), newS: String(e.new_string ?? '') }));
    filePath = String(obj.file_path ?? '');
  } else if (name === 'Write') {
    pairs = [{ oldS: '', newS: String(obj.content ?? '') }];
    filePath = String(obj.file_path ?? '');
  }

  return (
    <div style={diffWrapStyle}>
      {filePath && (
        <div style={diffPathStyle}>
          <Icon name="file" size={12} color="var(--text-muted)" />
          <span>{filePath}</span>
        </div>
      )}
      {pairs.map((p, i) => (
        <div key={i} style={diffBlockStyle}>
          {name === 'Edit' && p.oldS && p.oldS.split('\n').map((ln, j) => (
            <div key={'o' + j} style={delLineStyle}><span style={gutterStyle}>-</span><span style={codeLineStyle}>{ln || ' '}</span></div>
          ))}
          {p.newS.split('\n').map((ln, j) => (
            <div key={'n' + j} style={addLineStyle}><span style={gutterStyle}>+</span><span style={codeLineStyle}>{ln || ' '}</span></div>
          ))}
        </div>
      ))}
    </div>
  );
}
const diffWrapStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border-soft)',
  background: 'var(--bg-app)',
  fontFamily: 'Menlo,Consolas,monospace', fontSize: 11.5,
  maxHeight: 320, overflowY: 'auto',
};
const diffPathStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '5px 10px', fontSize: 11, color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-elev-2)',
};
const diffBlockStyle: React.CSSProperties = { padding: '4px 0' };
const gutterStyle: React.CSSProperties = {
  display: 'inline-block', width: 22, textAlign: 'center',
  userSelect: 'none', flex: '0 0 auto', fontWeight: 600,
};
const codeLineStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1,
};
const delLineStyle: React.CSSProperties = {
  display: 'flex', background: 'rgba(248,81,73,.12)',
  color: '#ffa8a8',
};
const addLineStyle: React.CSSProperties = {
  display: 'flex', background: 'rgba(63,185,80,.12)',
  color: '#9be6a8',
};

// 单个过程卡片：思考 / 工具调用（带结果）
function StepCard({ event, streaming }: { event: ToolEvent; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const isThinking = event.kind === 'thinking';
  const isToolUse = event.kind === 'tool_use';

  if (isThinking) {
    const text = event.text || '';
    const preview = truncate(text.replace(/\s+/g, ' ').trim(), 80);
    return (
      <div style={stepWrapStyle}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={thinkingHeaderStyle}
        >
          <Icon name="model" size={13} color="var(--text-faint)" />
          <span style={{ fontWeight: 500 }}>思考过程</span>
          {streaming && !text && <span style={spinnerDot} />}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
            {preview}
          </span>
          <span style={{ color: 'var(--text-fainter)', fontSize: 10 }}>{open ? '▼' : '▶'}</span>
        </button>
        {open && text && (
          <div style={thinkingBodyStyle}>{text}</div>
        )}
      </div>
    );
  }

  if (isToolUse) {
    const meta = toolMeta(event.name);
    const inputText = fmtInput(event.input);
    const hasResult = event.content != null;
    const isRunning = !hasResult && streaming;

    return (
      <div style={stepWrapStyle}>
        <button
          onClick={() => hasResult && setOpen((o) => !o)}
          style={{ ...toolHeaderStyle, cursor: hasResult ? 'pointer' : 'default' }}
        >
          <Icon name={meta.icon} size={13} color={meta.color} />
          <span style={{ fontWeight: 500, color: meta.color }}>{meta.label}</span>
          {isRunning ? (
            <span style={{ ...statusTag, color: 'var(--accent)' }}>运行中…</span>
          ) : event.isError ? (
            <span style={{ ...statusTag, color: 'var(--red)' }}>出错</span>
          ) : hasResult ? (
            <span style={{ ...statusTag, color: 'var(--green)' }}>完成</span>
          ) : null}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Menlo,Consolas,monospace', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
            {truncate(inputText, 60)}
          </span>
          {hasResult && <span style={{ color: 'var(--text-fainter)', fontSize: 10 }}>{open ? '▼' : '▶'}</span>}
        </button>
        {open && (
          <>
            {/* Edit/MultiEdit/Write：优先渲染 diff 预览 */}
            {(event.name === 'Edit' || event.name === 'MultiEdit' || event.name === 'Write') && (
              <DiffView name={event.name!} input={event.input} />
            )}
            {/* 工具执行结果（命令输出等） */}
            {hasResult && <pre style={resultPreStyle(event.isError)}>{event.content}</pre>}
          </>
        )}
      </div>
    );
  }

  // 孤立的 tool_result（没匹配到 tool_use，兜底展示）
  if (event.kind === 'tool_result' && event.content) {
    return (
      <div style={stepWrapStyle}>
        <pre style={resultPreStyle(event.isError)}>{event.content}</pre>
      </div>
    );
  }
  return null;
}

const stepWrapStyle: React.CSSProperties = {
  border: '1px solid var(--border-soft)',
  borderRadius: 8,
  marginBottom: 6,
  background: 'var(--bg-app)',
  overflow: 'hidden',
};
const thinkingHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
  padding: '7px 10px', background: 'transparent', border: 'none',
  color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textAlign: 'left',
  fontFamily: 'inherit',
};
const thinkingBodyStyle: React.CSSProperties = {
  padding: '8px 12px 10px', fontSize: 12.5, lineHeight: 1.6,
  color: 'var(--text-muted)', whiteSpace: 'pre-wrap',
  borderTop: '1px solid var(--border-soft)',
  maxHeight: 320, overflowY: 'auto',
};
const toolHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
  padding: '7px 10px', background: 'transparent', border: 'none',
  fontSize: 12, textAlign: 'left', fontFamily: 'inherit',
};
const statusTag: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '0 5px',
};
const spinnerDot: React.CSSProperties = {
  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
  display: 'inline-block', animation: 'blink 1s step-end infinite',
};
function resultPreStyle(isError?: boolean): React.CSSProperties {
  return {
    margin: 0, padding: '8px 12px', fontSize: 11.5, lineHeight: 1.5,
    fontFamily: 'Menlo,Consolas,monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    background: 'var(--bg-elev-2)',
    color: isError ? 'var(--red)' : 'var(--text-soft)',
    borderTop: '1px solid var(--border-soft)',
    maxHeight: 280, overflowY: 'auto',
  };
}

// 过程展示：思考 + 工具调用的有序列表（流式时新内容自动展开顶栏摘要）
export function ProcessSteps({
  events, streaming,
}: {
  events: ToolEvent[]; streaming: boolean;
}) {
  const lastCount = useRef(events.length);
  // 结果回流时把对应卡片自动展开（仅新到的结果）
  useEffect(() => {
    lastCount.current = events.length;
  }, [events.length]);

  if (!events || events.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      {events.map((ev, i) => (
        <StepCard key={i} event={ev} streaming={streaming} />
      ))}
    </div>
  );
}
