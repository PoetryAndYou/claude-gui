import { useState, useEffect, useRef, memo } from 'react';
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

// 从用户消息 content 中提取图片相对路径（粘贴图片时附加的 @.gui-assets/xxx）
function extractImages(content: string): string[] {
  const out: string[] = [];
  const re = /@(\.gui-assets\/[^\s@]+\.(?:png|jpe?g|gif|webp|bmp))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push(m[1]);
  return out;
}

// 去掉图片路径后的纯文本（避免把 @.gui-assets/xxx 当文字显示）
function stripImages(content: string): string {
  return content.replace(/@\.gui-assets\/[^\s@]+\.(?:png|jpe?g|gif|webp|bmp)\s*/gi, '').trim();
}

// 用户消息里的图片缩略图（懒加载 dataURL），点击放大（全屏 lightbox）
function UserImages({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all(paths.map(async (p) => {
      const r = await window.claude.readImage(p);
      return [p, r.dataUrl || ''] as const;
    })).then((res) => { if (alive) setUrls(Object.fromEntries(res)); });
    return () => { alive = false; };
  }, [paths.join(',')]);
  const loaded = paths.filter((p) => urls[p]);
  if (loaded.length === 0) return null;
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {loaded.map((p) => (
          <img key={p} src={urls[p]} alt="" onClick={() => setZoom(urls[p])}
            style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in', border: '1px solid rgba(128,128,128,.25)' }} />
        ))}
      </div>
      {zoom && (
        <div onClick={() => setZoom(null)} style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 24,
        }}>
          <img src={zoom} alt="" style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: 8, objectFit: 'contain' }} />
        </div>
      )}
    </>
  );
}

// markdown 渲染封装（代码块/行内 code 规则）
function Markdown({ content, theme, streaming }: { content: string; theme: Theme; streaming?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }: any) {
          const text = String(children ?? '');
          const match = /language-(\w+)/.exec(className || '');
          // react-markdown 9.x 不再传 inline prop：靠"有 language class"或"内容含换行"判定为代码块。
          // 否则视为行内 code（不套带复制按钮的 CodeBlock，避免满屏复制按钮）
          const isBlock = !!match || text.includes('\n');
          if (isBlock) {
            return <CodeBlock language={match ? match[1] : 'text'} theme={theme} streaming={streaming}>{text.replace(/\n$/, '')}</CodeBlock>;
          }
          return <code style={inlineCodeStyle} {...props}>{children}</code>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// 流式中 markdown：节流渲染 + 长文本降级纯文本，避免每个 delta 全量重解析卡顿
function StreamingMarkdown({ content, theme }: { content: string; theme: Theme }) {
  const [shown, setShown] = useState(content);
  const last = useRef(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    // 内容超过 4000 字符时降级：纯文本直接显示，不再走 ReactMarkdown（避免卡顿）
    if (content.length > 4000) {
      setShown(content);
      return;
    }
    // 节流：每 250ms 最多解析一次（长答案时降低重渲染频率）
    if (now - last.current >= 250) {
      last.current = now;
      setShown(content);
    } else if (raf.current == null) {
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        last.current = Date.now();
        setShown(content);
      });
    }
    return () => { if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; } };
  }, [content]);
  // 长内容降级：纯文本 pre-wrap，不用 markdown（保留换行和代码缩进）
  if (shown.length > 4000) {
    return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{shown}</div>;
  }
  return <Markdown content={shown} theme={theme} />;
}

// 流式实时计时器：从 startedAt 起每 500ms 跳动（降低重渲染频率），显示「⏱ X.Xs」
const LiveTimer = memo(function LiveTimer({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const sec = (Date.now() - startedAt) / 1000;
  return <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>⏱ {sec.toFixed(1)}s</span>;
});

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
// 行内 code：浅灰底圆角，与正文区分但不喧宾夺主
const inlineCodeStyle: React.CSSProperties = {
  background: 'var(--bg-elev)', color: 'var(--text-soft)',
  padding: '1px 6px', borderRadius: 4, fontSize: '0.9em',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

// 带复制按钮的代码块包装。memo 化：内容不变就不重渲染（流式中其他消息更新不触发）
const CodeBlock = memo(function CodeBlock({ language, children, theme, streaming }: { language: string; children: string; theme: Theme; streaming?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div style={{ position: 'relative', margin: '8px 0' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={copy} style={copyBtnStyle(hovered, theme)}>
        <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? 'var(--green)' : 'var(--text-muted)'} />
        <span style={{ color: copied ? 'var(--green)' : 'var(--text-muted)' }}>{copied ? '已复制' : '复制'}</span>
      </button>
      {streaming ? (
        // 流式中：纯 pre 显示代码（不跑语法高亮，避免每个 delta 重算高亮卡顿），完成后才高亮
        <pre style={{ margin: 0, borderRadius: 8, fontSize: 13, padding: '30px 12px 12px', background: theme === 'light' ? '#f6f8fa' : '#161b22', color: theme === 'light' ? '#1f2328' : '#e6edf3', overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          <code>{children}</code>
        </pre>
      ) : (
        <SyntaxHighlighter
          language={language}
          style={theme === 'light' ? (oneLight as any) : (vscDarkPlus as any)}
          customStyle={{ margin: 0, borderRadius: 8, fontSize: 13, paddingTop: 30 }}
        >
          {children}
        </SyntaxHighlighter>
      )}
    </div>
  );
});

// 加载动画：三个错峰跳动的圆点（思考中状态）
function ThreeDotsSpinner() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)',
            display: 'inline-block',
            animation: `dotBounce 1.2s ${i * 0.18}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}
// 复制按钮：hover 才高亮（默认半透明不抢眼），背景随主题（白底下能看见）
function copyBtnStyle(hovered: boolean, theme: Theme): React.CSSProperties {
  return {
    position: 'absolute', top: 6, right: 6, zIndex: 2,
    display: 'flex', alignItems: 'center', gap: 4,
    background: theme === 'light'
      ? (hovered ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.7)')
      : (hovered ? 'rgba(22,27,34,.95)' : 'rgba(13,17,23,.7)'),
    border: '1px solid var(--border)',
    borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
    backdropFilter: 'blur(4px)',
    opacity: hovered ? 1 : 0.7,
    transition: 'opacity .12s',
  };
}

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

// 用户消息编辑按钮：与 ActionBtn 同款（透明底，放在消息下方操作行）
function EditToggleBtn({ onEdit }: { onEdit: () => void }) {
  return (
    <button
      title="编辑"
      onMouseDown={(e) => { e.preventDefault(); onEdit(); }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, border: 'none', borderRadius: 6,
        background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)',
      }}
    >
      <Icon name="edit" size={13} color="var(--text-muted)" />
    </button>
  );
}

export const MessageBubble = memo(MessageBubbleImpl, (prev, next) => {
  // 自定义 memo 比较：减少不必要重渲染
  // 内容/事件/streaming/theme/canAct 变化才重渲染；回调引用变化不触发（onRegenerate/onEdit 用 useCallback 稳定）
  if (prev.streaming !== next.streaming) return false;
  if (prev.theme !== next.theme) return false;
  if (prev.canAct !== next.canAct) return false;
  if (prev.message.content !== next.message.content) return false;
  if (prev.message.usage !== next.message.usage) return false;
  if (prev.message.events !== next.message.events) return false;
  if (prev.message.pendingChanges !== next.message.pendingChanges) return false;
  return true;
});

function MessageBubbleImpl({
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
              onClick={() => { if (editText.trim()) { onEdit?.(editText); setEditing(false); } }}
              disabled={!editText.trim()}
              style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: editText.trim() ? 'var(--accent-2)' : 'var(--border)', color: '#fff', fontSize: 12, cursor: editText.trim() ? 'pointer' : 'not-allowed' }}
            >发送</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        padding: '0 2px',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        maxWidth: isUser ? '85%' : '100%', padding: '8px 12px', borderRadius: 10,
        // 用户气泡：半透明玻璃质感（与侧栏风格统一），不再用蓝色块
        // 深主题=半透明白底+浅字；浅主题=半透明深底+深字。文字保持高对比
        background: isUser
          ? (theme === 'light' ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.09)')
          : 'transparent',
        color: isUser
          ? (theme === 'light' ? '#1f2328' : '#e6e9ef')
          : 'var(--text)',
        border: isUser ? '1px solid rgba(128,128,128,.18)' : 'none',
        lineHeight: 1.55, fontSize: 13, wordBreak: 'break-word',
      }}>
        {isUser ? (() => {
          const imgs = extractImages(message.content);
          const txt = stripImages(message.content);
          return (
            <>
              {txt && <div style={{ whiteSpace: 'pre-wrap' }}>{txt}</div>}
              <UserImages paths={imgs} />
            </>
          );
        })() : (
          <div className="markdown-body">
            {/* 过程展示：思考 + 工具调用卡片（Codex 式），出现在最终文字之前 */}
            <ProcessSteps events={message.events ?? []} streaming={streaming} />
            {/* 流式中也实时 markdown 渲染；StreamingMarkdown 内部节流(~150ms)避免长答案每个 delta 都重新解析卡顿 */}
            {streaming ? (
              <StreamingMarkdown content={message.content} theme={theme} />
            ) : (
              <Markdown content={message.content} theme={theme} />
            )}
            {/* 思考中且尚无文字/过程时：显示旋转加载动画（取代生硬的"思考中…"文字） */}
            {streaming && !message.content && (!message.events || message.events.length === 0) && (
              <ThreeDotsSpinner />
            )}
          </div>
        )}

        {/* 流式中：实时墙钟计时器（思考开始 → 回答完毕）。完毕后改用下方用量条的耗时 */}
        {!isUser && streaming && message.startedAt && (
          <div style={{ marginTop: 6 }}><LiveTimer startedAt={message.startedAt} /></div>
        )}
        {/* 助手消息用量条：始终占位（有 usage 才显示），不随 hover 变高，避免抖动 */}
        {/* 用量条见下方操作行（统一放消息下方，常驻） */}
      </div>

      {/* 操作行：消息下方预留固定高度(26px)，空间恒定 → 不抖、不盖文字。
          助手侧：用量条常驻；复制/重生成(仅 hover 淡入)。用户侧：编辑(仅 hover 淡入) */}
      <div style={{
        height: 26, minHeight: 26,
        display: 'flex', alignItems: 'center', gap: 2,
        padding: isUser ? '0' : '0 4px',
        marginTop: 2, marginBottom: -4,
      }}>
        {!isUser && message.usage && <UsageBar usage={message.usage} />}
        {canAct && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            marginLeft: 'auto',
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? 'auto' : 'none',
            transition: 'opacity .12s',
          }}>
            {isUser ? (
              <EditToggleBtn onEdit={() => { setEditText(message.content); setEditing(true); }} />
            ) : (
              <>
                <ActionBtn title="复制" onClick={() => navigator.clipboard.writeText(message.content)}>
                  <Icon name="copy" size={13} color="var(--text-muted)" />
                </ActionBtn>
                <ActionBtn title="重新生成" onClick={() => onRegenerate?.()}>
                  <Icon name="refresh" size={13} color="var(--text-muted)" />
                </ActionBtn>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
