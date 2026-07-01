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
  // atBottom 用 ref + state 双轨：ref 在事件回调中即读即用，state 驱动按钮渲染
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const setBottom = (v: boolean) => { atBottomRef.current = v; setAtBottom(v); };
  const [newCount, setNewCount] = useState(0);
  const prevMsgsRef = useRef<Message[] | null>(null);
  // 用户是否上滚（手动 scroll 时判断，用于区分流式追加）
  const userScrolledRef = useRef(false);

  const checkBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (now && !atBottomRef.current) setNewCount(0);
    setBottom(now);
    // 不在底部 = 用户上滚过
    userScrolledRef.current = !now;
  }, []);

  const hasContainer = messages.length > 0;
  useEffect(() => {
    if (!hasContainer) return;
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkBottom, { passive: true });
    checkBottom();
    return () => el.removeEventListener('scroll', checkBottom);
  }, [hasContainer, checkBottom]);

  // 在底部时，新消息/流式更新自动跟随到底
  useEffect(() => {
    const prev = prevMsgsRef.current;
    const isSwitch = prev !== messages && (prev === null || messages.length < prev.length || messages[0] !== prev[0]);
    prevMsgsRef.current = messages;
    // 新消息追加（用户刚发送）：即使用户上滚过也强制滚到底（这是用户主动行为）
    const isNewMessageAdded = !isSwitch && !!prev && messages.length > prev.length;
    if (!atBottomRef.current && !isSwitch && isNewMessageAdded) {
      setNewCount((c) => c + (messages.length - prev.length));
    }
    // 用户刚发消息 → 强制跟随到底（不看 atBottom）；非用户行为且用户上滚过 → 不跟随
    const shouldFollow = isSwitch || isNewMessageAdded || atBottomRef.current;
    if (!shouldFollow) return;
    const isStreaming = !isSwitch && !!prev && messages.length === prev.length && status === 'thinking';
    const behavior: ScrollBehavior = (isSwitch || isStreaming) ? 'auto' : 'smooth';
    // 用双 rAF 确保 DOM 布局完成
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior });
      });
    });
    // 用户发新消息后重置上滚标记
    if (isNewMessageAdded) userScrolledRef.current = false;
  }, [messages, status]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: status === 'thinking' ? 'auto' : 'smooth' });
    setBottom(true);
    setNewCount(0);
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
          <div style={{ height: 1 }} />
        </div>
      </div>
      {/* 不在底部时：浮动"跳到最新"按钮（毛玻璃 + 新消息计数 + 流式状态点） */}
      {!atBottom && (
        <button
          onClick={scrollToBottom}
          title="跳到最新消息"
          style={scrollBtnStyle}
          className="no-drag"
        >
          {newCount > 0 && (
            <span style={badgeStyle}>{newCount > 99 ? '99+' : newCount}</span>
          )}
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 2.5 L6.5 10" />
            <path d="M3 7 L6.5 10.5 L10 7" />
          </svg>
          {status === 'thinking' && <span style={liveDotStyle} />}
          {newCount > 0 && <span style={labelStyle}>{newCount > 99 ? '99+' : newCount} 条新消息</span>}
        </button>
      )}
    </div>
  );
}

const scrollBtnStyle: React.CSSProperties = {
  position: 'absolute', right: 24, bottom: 20, zIndex: 20,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  height: 36, padding: '0 12px', borderRadius: 18,
  color: 'var(--text-soft)', fontFamily: 'inherit', fontSize: 12,
  background: 'var(--bg-elev)',
  border: '1px solid var(--border)',
  boxShadow: '0 6px 20px var(--shadow), 0 2px 6px var(--shadow)',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  cursor: 'pointer',
  transition: 'transform .15s, box-shadow .15s, background .15s',
  animation: 'floatIn .2s ease-out',
};
// 新消息计数徽章（小圆点，无文字时显示）
const badgeStyle: React.CSSProperties = {
  minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--accent)', color: 'var(--bg-app)',
  fontSize: 10, fontWeight: 700, lineHeight: 1,
};
const liveDotStyle: React.CSSProperties = {
  width: 6, height: 6, borderRadius: '50%', background: 'var(--green)',
  animation: 'pulseGreen 1.5s ease-in-out infinite', flex: '0 0 auto',
};
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: 'var(--text-soft)',
  whiteSpace: 'nowrap',
};
