import { useState, useEffect } from 'react';
import type { ClaudeItems } from '../../electron/preload';
import { Icon } from './Icon';

// 技能二级弹窗：显示完整描述 + 内容，可触发或关闭
export function SkillDetailModal({
  skill, onClose, onTrigger,
}: {
  skill: ClaudeItems['skills'][number] | null;
  onClose: () => void;
  onTrigger: (name: string) => void;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'desc' | 'content'>('desc');

  useEffect(() => {
    if (!skill) return;
    setContent('');
    setTab('desc');
    // 有 path 才能读完整内容
    const p = (skill as any).path as string | undefined;
    if (p) {
      setLoading(true);
      window.claude.getSkillDetail(p).then((r) => {
        setContent(r.content || '');
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [skill]);

  if (!skill) return null;

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        {/* 头部 */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="star" size={14} color="var(--purple)" />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{skill.name}</span>
          </div>
          <button onClick={onClose} style={closeBtnStyle} title="关闭">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>
        </div>

        {/* Tab 切换 */}
        <div style={tabBarStyle}>
          <button onClick={() => setTab('desc')} style={tab === 'desc' ? tabActiveStyle : tabStyle}>描述</button>
          {content && <button onClick={() => setTab('content')} style={tab === 'content' ? tabActiveStyle : tabStyle}>完整内容</button>}
        </div>

        {/* 内容区 */}
        <div style={bodyStyle}>
          {tab === 'desc' ? (
            skill.description ? (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{skill.description}</div>
            ) : (
              <div style={{ color: 'var(--text-faint)' }}>该技能没有描述</div>
            )
          ) : (
            loading ? (
              <div style={{ color: 'var(--text-faint)' }}>加载中…</div>
            ) : (
              <pre style={preStyle}>{content}</pre>
            )
          )}
        </div>

        {/* 底部操作 */}
        <div style={footerStyle}>
          <button onClick={onClose} style={cancelBtnStyle}>取消</button>
          <button onClick={() => onTrigger(skill.name)} style={runBtnStyle}>
            <Icon name="zap" size={12} color="#fff" />
            <span>使用此技能</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  backdropFilter: 'blur(2px)',
};
const modalStyle: React.CSSProperties = {
  width: '90%', maxWidth: 540, maxHeight: '80%',
  background: 'var(--bg-app)', borderRadius: 10,
  border: '1px solid var(--border)',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 8px 32px rgba(0,0,0,.4)',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 16px', borderBottom: '1px solid var(--border-soft)',
};
const closeBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center',
};
const tabBarStyle: React.CSSProperties = {
  display: 'flex', gap: 0, padding: '0 16px', borderBottom: '1px solid var(--border-soft)',
};
const tabStyle: React.CSSProperties = {
  padding: '8px 12px', background: 'transparent', border: 'none',
  color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
  borderBottom: '2px solid transparent',
};
const tabActiveStyle: React.CSSProperties = {
  ...tabStyle, color: 'var(--accent)', borderBottom: '2px solid var(--accent)',
};
const bodyStyle: React.CSSProperties = {
  padding: 16, overflowY: 'auto', flex: 1,
  fontSize: 13, color: 'var(--text)', minWidth: 0,
};
const preStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12, lineHeight: 1.5, margin: 0, color: 'var(--text-soft)',
};
const footerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8,
  padding: '12px 16px', borderTop: '1px solid var(--border-soft)',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
};
const runBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: 'var(--purple)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
};
