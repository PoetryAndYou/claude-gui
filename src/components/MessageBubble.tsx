import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '../hooks/useClaude';

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
                    return (
                      <SyntaxHighlighter
                        style={vscDarkPlus as any}
                        language={match[1]}
                        PreTag="div"
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    );
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
