import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { Icon } from './Icon';
import type { Message, ChatStatus } from '../hooks/useClaude';

export function MessageList({ messages, status }: { messages: Message[]; status: ChatStatus }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新消息或流式更新时自动滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#484f58',
        gap: 12,
      }}>
        <div style={{ color: '#58a6ff' }}><Icon name="bolt" size={48} color="#58a6ff" /></div>
        <div style={{ fontSize: 18, color: '#6e7681' }}>Claude GUI</div>
        <div style={{ fontSize: 13 }}>在下方输入消息，开始对话</div>
      </div>
    );
  }

  const streamingId = status === 'thinking'
    ? messages.filter((m) => m.role === 'assistant').slice(-1)[0]?.id
    : undefined;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820, margin: '0 auto' }}>
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} streaming={m.id === streamingId} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
