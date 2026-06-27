import { useEffect, useRef, useState, useCallback } from 'react';
import { MessageBubble } from './MessageBubble';
import { ConfirmCard } from './ConfirmCard';
import { Icon } from './Icon';
import type { Message, ChatStatus, Theme } from '../hooks/useClaude';

export function MessageList({
  messages, status, theme,
  onRegenerate, onEdit,
  onConfirmApprove, onConfirmReject,
}: {
  messages: Message[];
  status: ChatStatus;
  theme: Theme;
  onRegenerate?: (assistantMsgId: string) => void;
  onEdit?: (userMsgId: string, newText: string) => void;
  onConfirmApprove?: () => void;
  onConfirmReject?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 用户是否在底部附近（决定自动滚底 + 是否显示"回到底部"按钮）
  const [atBottom, setAtBottom] = useState(true);

  // 判断是否贴底（留 32px 容差，避免亚像素导致永远 false）
  const checkBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  }, []);

  // 滚动监听：用户上滚 → atBottom=false（流式不再强行拽回底）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkBottom, { passive: true });
    return () => el.removeEventListener('scroll', checkBottom);
  }, [checkBottom]);

  // 在底部时，新消息/流式更新自动跟随到底
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, atBottom]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAtBottom(true);
  };

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
    <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--bg-app)' }}>
      <div ref={scrollRef} style={{ height: '100%', overflowY: 'auto', padding: '10px 10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820, margin: '0 auto' }}>
          {messages.map((m) => (
            <div key={m.id}>
              <MessageBubble
                message={m}
                streaming={m.id === streamingId}
                theme={theme}
                canAct={canAct}
                onRegenerate={m.role === 'assistant' ? () => onRegenerate?.(m.id) : undefined}
                onEdit={m.role === 'user' ? (t) => onEdit?.(m.id, t) : undefined}
              />
              {/* 变更确认卡片：第一轮（default 模式）抓到写操作时展示 */}
              {m.role === 'assistant' && m.pendingChanges && m.pendingChanges.length > 0 && (
                <ConfirmCard
                  changes={m.pendingChanges}
                  onApprove={() => onConfirmApprove?.()}
                  onReject={() => onConfirmReject?.()}
                />
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      {/* 不在底部时：浮动"回到底部"按钮（流式中还显示状态点） */}
      {!atBottom && (
        <button
          onClick={scrollToBottom}
          title="回到底部"
          style={scrollBtnStyle}
        >
          <Icon name="arrowDown" size={16} color="var(--text-soft)" />
          {status === 'thinking' && <span style={liveDotStyle} />}
        </button>
      )}
    </div>
  );
}

const scrollBtnStyle: React.CSSProperties = {
  position: 'absolute', right: 24, bottom: 16, zIndex: 20,
  width: 34, height: 34, borderRadius: 17,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  boxShadow: '0 4px 14px var(--shadow)', cursor: 'pointer',
};
const liveDotStyle: React.CSSProperties = {
  position: 'absolute', top: 7, right: 7,
  width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)',
};
