import { useState, useEffect, useRef } from 'react';
import type { ModelItem } from '../../electron/preload';
import { Icon } from './Icon';

// 顶栏模型切换：每个对话独立模型，下拉选择 sonnet/opus/haiku/默认
export function ModelSwitcher({ convId }: { convId: string | null }) {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 对话切换时重新读取模型
  useEffect(() => {
    window.claude.getModels().then(setModels).catch(() => {});
    window.claude.getModel().then(setCurrent).catch(() => {});
  }, [convId]);

  // 点外面关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = async (alias: string | null) => {
    const next = await window.claude.setModel(alias);
    setCurrent(next);
    setOpen(false);
  };

  const label = current
    ? (models.find((m) => m.alias === current)?.name ?? current)
    : '默认';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="切换模型"
        className="no-drag"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'transparent', border: '1px solid var(--border-soft)',
          borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
          color: 'var(--text-soft)', fontSize: 12,
        }}
      >
        <Icon name="model" size={13} color="var(--accent)" />
        <span>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 50,
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 8px 24px var(--shadow)',
          minWidth: 180, overflow: 'hidden',
        }}>
          <button
            onClick={() => pick(null)}
            style={itemStyle(current === null)}
          >
            <div style={{ fontWeight: 500 }}>默认</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>claude 自选</div>
          </button>
          {models.map((m) => (
            <button
              key={m.alias}
              onClick={() => pick(m.alias)}
              style={itemStyle(current === m.alias)}
            >
              <div style={{ fontWeight: 500 }}>{m.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{m.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function itemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '7px 12px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: 'var(--text-soft)', fontFamily: 'inherit', fontSize: 12,
    borderBottom: '1px solid var(--border-soft)',
  };
}
