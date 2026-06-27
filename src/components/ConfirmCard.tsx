import { useState } from 'react';
import type { PendingChange } from '../../electron/preload';
import { Icon } from './Icon';

// 把工具参数对象格式化成可读文本
function fmtInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    const obj = input as Record<string, unknown>;
    if (obj.command) return String(obj.command);
    if (obj.file_path) return String(obj.file_path);
    if (obj.pattern) return String(obj.pattern);
    if (obj.path) return String(obj.path);
    return JSON.stringify(input, null, 2);
  } catch (_) {
    return String(input);
  }
}

// 工具图标/颜色/标签
function toolMeta(name: string | undefined): { icon: string; color: string; label: string } {
  switch (name) {
    case 'Write': return { icon: 'edit', color: 'var(--green)', label: '写入文件' };
    case 'Edit': case 'MultiEdit': return { icon: 'edit', color: 'var(--purple)', label: '编辑文件' };
    case 'NotebookEdit': return { icon: 'edit', color: 'var(--purple)', label: '编辑 Notebook' };
    case 'Bash': return { icon: 'command', color: 'var(--green)', label: '执行命令' };
    case 'Task': return { icon: 'circle', color: 'var(--purple)', label: '子任务' };
    default: return { icon: 'zap', color: 'var(--text-muted)', label: name || '工具' };
  }
}

// diff 预览（Edit/MultiEdit/Write 的红绿行）
function DiffPreview({ name, input }: { name: string; input: unknown }) {
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
  // 非 diff 类工具（Bash/Task 等）不展示 diff
  if (!pairs.length || (!pairs[0].newS && !pairs[0].oldS)) return null;

  return (
    <div style={diffWrapStyle}>
      {filePath && (
        <div style={diffPathStyle}>
          <Icon name="file" size={12} color="var(--text-muted)" />
          <span>{filePath}</span>
        </div>
      )}
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {pairs.map((p, i) => (
          <div key={i}>
            {name === 'Edit' && p.oldS && p.oldS.split('\n').map((ln, j) => (
              <div key={'o' + j} style={delLineStyle}><span style={gutterStyle}>-</span><span style={codeLineStyle}>{ln || ' '}</span></div>
            ))}
            {p.newS.split('\n').slice(0, 30).map((ln, j) => (
              <div key={'n' + j} style={addLineStyle}><span style={gutterStyle}>+</span><span style={codeLineStyle}>{ln || ' '}</span></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const diffWrapStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border-soft)',
  background: 'var(--bg-app)',
  fontFamily: 'Menlo,Consolas,monospace', fontSize: 11.5,
};
const diffPathStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '5px 10px', fontSize: 11, color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-elev-2)',
};
const gutterStyle: React.CSSProperties = {
  display: 'inline-block', width: 22, textAlign: 'center',
  userSelect: 'none', flex: '0 0 auto', fontWeight: 600,
};
const codeLineStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1,
};
const delLineStyle: React.CSSProperties = {
  display: 'flex', background: 'rgba(248,81,73,.12)', color: '#ffa8a8',
};
const addLineStyle: React.CSSProperties = {
  display: 'flex', background: 'rgba(63,185,80,.12)', color: '#9be6a8',
};

/**
 * 变更确认卡片：第一轮（default 模式）抓到写操作后展示，用户点「执行」或「拒绝」
 */
export function ConfirmCard({
  changes,
  onApprove,
  onReject,
}: {
  changes: PendingChange[];
  onApprove: () => void;
  onReject: () => void;
}) {
  const [decided, setDecided] = useState<'approve' | 'reject' | null>(null);

  const handleApprove = () => {
    if (decided) return;
    setDecided('approve');
    onApprove();
  };
  const handleReject = () => {
    if (decided) return;
    setDecided('reject');
    onReject();
  };

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <Icon name="model" size={13} color="var(--accent)" />
        <span style={{ fontWeight: 600 }}>变更前确认</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {changes.length} 项操作
        </span>
      </div>

      {/* 每个变更意图 */}
      {changes.map((ch, i) => {
        const meta = toolMeta(ch.name);
        return (
          <div key={ch.toolUseId || i} style={changeItemStyle}>
            <div style={changeHeaderStyle}>
              <Icon name={meta.icon} size={12} color={meta.color} />
              <span style={{ fontWeight: 500, color: meta.color, fontSize: 12 }}>{meta.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Menlo,Consolas,monospace', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {fmtInput(ch.input).slice(0, 60)}
              </span>
            </div>
            <DiffPreview name={ch.name} input={ch.input} />
          </div>
        );
      })}

      {/* 操作按钮 */}
      {!decided ? (
        <div style={actionsStyle}>
          <button onClick={handleReject} style={rejectBtnStyle}>
            拒绝
          </button>
          <button onClick={handleApprove} style={approveBtnStyle}>
            <Icon name="edit" size={12} color="#fff" />
            执行变更
          </button>
        </div>
      ) : (
        <div style={decidedStyle}>
          {decided === 'approve' ? (
            <><span style={{ color: 'var(--green)' }}>✓ 已批准，正在执行…</span></>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>已拒绝，不执行变更</span>
          )}
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  border: '1px solid var(--accent)',
  borderRadius: 8,
  marginBottom: 8,
  background: 'var(--bg-app)',
  overflow: 'hidden',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', background: 'rgba(88,166,255,.08)',
  fontSize: 12.5, color: 'var(--text)',
};
const changeItemStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border-soft)',
};
const changeHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', fontSize: 12,
};
const actionsStyle: React.CSSProperties = {
  display: 'flex', gap: 8, padding: '10px 12px', justifyContent: 'flex-end',
};
const approveBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
  background: 'var(--green)', color: '#fff', fontSize: 12.5, fontWeight: 600,
  fontFamily: 'inherit',
};
const rejectBtnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
  background: 'transparent', color: 'var(--text-muted)',
  border: '1px solid var(--border)', fontSize: 12.5, fontFamily: 'inherit',
};
const decidedStyle: React.CSSProperties = {
  padding: '10px 12px', fontSize: 12.5, textAlign: 'center',
};
