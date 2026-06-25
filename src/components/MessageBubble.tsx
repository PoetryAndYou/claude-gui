import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../hooks/useClaude';
import type { Theme } from '../hooks/useClaude';
import { Icon } from './Icon';
import { ProcessSteps } from './ProcessSteps';
import type { Usage } from '../../electron/preload';

// 把 token 数转成可读字符串
function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
// 用量条：1.2k tokens · 3.4s · $0.01
function UsageBar({ usage }: { usage: Usage }) {
  const parts: string[] = [];
  const totalTok = usage.inputTokens + usage.outputTokens;
  if (totalTok) parts.push(`${fmtTokens(totalTok)} tokens`);
  if (usage.durationMs) parts.push(`${(usage.durationMs / 1000).toFixed(1)}s`);
  if (usage.totalCostUsd) parts.push(`$${usage.totalCostUsd.toFixed(4)}`);
  if (parts.length === 0) return null;
  return <div style={usageStyle}>{parts.join(' · ')}</div>;
}
const usageStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-faint)', marginTop: 6,
  display: 'flex', gap: 6, alignItems: 'center',
};

// 带复制按钮的代码块包装
function CodeBlock({ language, children, theme }: { language: string; children: string; theme: Theme }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div style={{ position: 'relative', margin: '8px 0' }}>
      <button onClick={copy} style={copyBtnStyle}>
        <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? 'var(--green)' : 'var(--text-muted)'} />
        <span style={{ color: copied ? 'var(--green)' : 'var(--text-muted)' }}>{copied ? '已复制' : '复制'}</span>
      </button>
      <SyntaxHighlighter
        language={language}
        style={theme === 'light' ? (oneLight as any) : (vscDarkPlus as any)}
        customStyle={{ margin: 0, borderRadius: 8, fontSize: 13 }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}
const copyBtnStyle: React.CSSProperties = {
  position: 'absolute', top: 6, right: 6, zIndex: 2,
  display: 'flex', alignItems: 'center', gap: 4,
  background: 'rgba(13,17,23,.8)', border: '1px solid var(--border)',
  borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
  backdropFilter: 'blur(4px)',
};

// 操作按钮（hover 显示）
function ActionBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, border: 'none', borderRadius: 6,
        background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)',
      }}
    >
      {children}
    </button>
  );
}

const hoverBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 2, marginTop: 6,
};

export function MessageBubble({
  message, streaming, theme,
  onRegenerate, onEdit, canAct,
}: {
  message: Message;
  streaming: boolean;
  theme: Theme;
  onRegenerate?: () => void;
  onEdit?: (newText: string) => void;
  canAct?: boolean; // 是否允许操作（非 thinking 态）
}) {
  const isUser = message.role === 'user';
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);

  // 用户消息：编辑模式
  if (isUser && editing) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px' }}>
        <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            autoFocus
            rows={Math.min(8, editText.split('\n').length)}
            style={{
              width: '100%', minWidth: 280, padding: '10px 14px', borderRadius: 12,
              border: '1px solid var(--accent)', background: 'var(--bg-elev)',
              color: 'var(--text)', fontSize: 14, lineHeight: 1.6, resize: 'vertical',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => { setEditing(false); setEditText(message.content); }}
              style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
            >取消</button>
            <button
              onClick={() => { if (editText.trim() && editText.trim() !== message.content) { onEdit?.(editText); setEditing(false); } }}
              style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--accent-2)', color: '#fff', fontSize: 12, cursor: 'pointer' }}
            >发送</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', padding: '0 4px' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        maxWidth: '85%', padding: '12px 16px', borderRadius: 12,
        background: isUser ? 'var(--accent-2)' : 'var(--bg-elev)',
        color: isUser ? '#ffffff' : 'var(--text)',
        border: isUser ? 'none' : '1px solid var(--border)',
        lineHeight: 1.6, fontSize: 14, wordBreak: 'break-word',
      }}>
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        ) : (
          <div className="markdown-body">
            {/* 过程展示：思考 + 工具调用卡片（Codex 式），出现在最终文字之前 */}
            <ProcessSteps events={message.events ?? []} streaming={streaming} />
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  if (!inline && match) {
                    return <CodeBlock language={match[1]} theme={theme}>{String(children).replace(/\n$/, '')}</CodeBlock>;
                  }
                  if (!inline && !match) {
                    return <CodeBlock language="text" theme={theme}>{String(children).replace(/\n$/, '')}</CodeBlock>;
                  }
                  return <code className={className} {...props}>{children}</code>;
                },
              }}
            >
              {message.content || (streaming && (!message.events || message.events.length === 0) ? '思考中…' : '')}
            </ReactMarkdown>
            {streaming && message.content && (
              <span className="cursor-blink">▋</span>
            )}
          </div>
        )}

        {/* 助手消息底部：用量 + 操作（重生成/复制） */}
        {!isUser && (message.usage || (hovered && canAct)) && (
          <div style={{ ...hoverBarStyle, justifyContent: 'flex-start', opacity: hovered || message.usage ? 1 : 0.6 }}>
            {message.usage && <UsageBar usage={message.usage} />}
            {hovered && canAct && (
              <div style={{ display: 'flex', marginLeft: 'auto' }}>
                <ActionBtn title="复制" onClick={() => navigator.clipboard.writeText(message.content)}>
                  <Icon name="copy" size={13} color="var(--text-muted)" />
                </ActionBtn>
                <ActionBtn title="重新生成" onClick={() => onRegenerate?.()}>
                  <Icon name="refresh" size={13} color="var(--text-muted)" />
                </ActionBtn>
              </div>
            )}
          </div>
        )}

        {/* 用户消息底部：编辑按钮（hover） */}
        {isUser && hovered && canAct && (
          <div style={{ ...hoverBarStyle, justifyContent: 'flex-end' }}>
            <ActionBtn title="编辑" onClick={() => { setEditText(message.content); setEditing(true); }}>
              <Icon name="edit" size={13} color="#ffffffcc" />
            </ActionBtn>
          </div>
        )}
      </div>
    </div>
  );
}
