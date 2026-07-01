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
  // 记录"离开底部时"的消息数，用于计算悬浮按钮上的"新消息 N"计数
  const [newCount, setNewCount] = useState(0);
  const leaveBottomCount = useRef(0);
  // 记录上次 messages 引用，用于区分"对话切换"(瞬间到底) vs "流式追加"(平滑跟随)
  const prevMsgsRef = useRef<Message[] | null>(null);

  // 判断是否贴底（留 32px 容差，避免亚像素导致永远 false）
  const checkBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAtBottom((prev) => {
      // 从"离开"变为"贴底"：清零新消息计数
      if (now && !prev) setNewCount(0);
      return now;
    });
  }, []);

  // 滚动监听：用户上滚 → atBottom=false（流式不再强行拽回底）
  // 依赖 hasContainer：首条消息后滚动容器才挂载，必须重新绑定监听，
  // 否则空态时 effect 跑一次拿到 scrollRef=null 就早退，之后监听永远不生效
  const hasContainer = messages.length > 0;
  useEffect(() => {
    if (!hasContainer) return;
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkBottom, { passive: true });
    // 容器刚挂载 → 立即校正一次贴底状态（否则 atBottom 残留旧值）
    checkBottom();
    return () => el.removeEventListener('scroll', checkBottom);
  }, [hasContainer, checkBottom]);

  // 在底部时，新消息/流式更新自动跟随到底
  // 对话切换（messages 引用突变、非连续增长）瞬间到底；流式追加平滑跟随
  useEffect(() => {
    const prev = prevMsgsRef.current;
    // 判断是否是对话切换：引用不同 + 新长度没有连续增长（变小或全新数组）
    const isSwitch = prev !== messages && (prev === null || messages.length < prev.length || messages[0] !== prev[0]);
    prevMsgsRef.current = messages;
    // 离开底部时有新消息到来：累加 newCount（用户能看到"新消息 N"提示）
    if (!atBottom && !isSwitch && prev && messages.length > prev.length) {
      setNewCount((c) => c + (messages.length - prev.length));
    }
    if (!atBottom) {
      // 切对话时重置计数
      if (isSwitch) setNewCount(0);
      return;
    }
    // 切对话：瞬间到底（auto）；流式内容更新（思考中、数组长度不变）：瞬间跟随，
    //   否则 smooth 滚动追不上不断增长的 scrollHeight，永远到不了最新消息；
    // 新消息追加等其它情况：平滑（smooth）
    const isStreaming = !isSwitch && !!prev && messages.length === prev.length && status === 'thinking';
    const behavior: ScrollBehavior = (isSwitch || isStreaming) ? 'auto' : 'smooth';
    // requestAnimationFrame 确保 DOM 完成布局后再滚（特别是首条消息时容器刚挂载）
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, [messages, atBottom, status]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: status === 'thinking' ? 'auto' : 'smooth' });
    });
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
      <div ref={scrollRef} style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '10px 10px' }}>
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
