import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../hooks/useClaude';
import { Icon } from './Icon';

// 带复制按钮的代码块包装
function CodeBlock({ language, children }: { language: string; children: string }) {
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
        <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? '#3fb950' : '#8b949e'} />
        <span style={{ color: copied ? '#3fb950' : '#8b949e' }}>{copied ? '已复制' : '复制'}</span>
      </button>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus as any}
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
  background: 'rgba(13,17,23,.8)', border: '1px solid #30363d',
  borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
  backdropFilter: 'blur(4px)',
};

export function MessageBubble({ message, streaming }: { message: Message; streaming: boolean }) {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      padding: '0 4px',
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '12px 16px',
        borderRadius: 12,
        background: isUser ? '#1f6feb' : '#161b22',
        color: isUser ? '#ffffff' : '#e6edf3',
        border: isUser ? 'none' : '1px solid #30363d',
        lineHeight: 1.6,
        fontSize: 14,
        wordBreak: 'break-word',
      }}>
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        ) : (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  if (!inline && match) {
                    return <CodeBlock language={match[1]}>{String(children).replace(/\n$/, '')}</CodeBlock>;
                  }
                  if (!inline && !match) {
                    return <CodeBlock language="text">{String(children).replace(/\n$/, '')}</CodeBlock>;
                  }
                  return <code className={className} {...props}>{children}</code>;
                },
              }}
            >
              {message.content || (streaming ? '思考中…' : '')}
            </ReactMarkdown>
            {streaming && message.content && (
              <span className="cursor-blink">▋</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
