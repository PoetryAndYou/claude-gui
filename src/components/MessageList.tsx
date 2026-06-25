import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { Icon } from './Icon';
import type { Message, ChatStatus, Theme } from '../hooks/useClaude';

export function MessageList({
  messages, status, theme,
  onRegenerate, onEdit,
}: {
  messages: Message[];
  status: ChatStatus;
  theme: Theme;
  onRegenerate?: (assistantMsgId: string) => void;
  onEdit?: (userMsgId: string, newText: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新消息或流式更新时自动滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-fainter)', gap: 12,
      }}>
        <div style={{ color: 'var(--accent)' }}><Icon name="bolt" size={48} color="var(--accent)" /></div>
        <div style={{ fontSize: 18, color: 'var(--text-faint)' }}>Claude GUI</div>
        <div style={{ fontSize: 13 }}>在下方输入消息，开始对话</div>
      </div>
    );
  }

  const streamingId = status === 'thinking'
    ? messages.filter((m) => m.role === 'assistant').slice(-1)[0]?.id
    : undefined;
  const canAct = status !== 'thinking';

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820, margin: '0 auto' }}>
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            streaming={m.id === streamingId}
            theme={theme}
            canAct={canAct}
            onRegenerate={m.role === 'assistant' ? () => onRegenerate?.(m.id) : undefined}
            onEdit={m.role === 'user' ? (t) => onEdit?.(m.id, t) : undefined}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
