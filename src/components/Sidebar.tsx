import { useState, useEffect } from 'react';

export function Sidebar({
  onPickCommand,
}: {
  onPickCommand: (cmd: string) => void;
}) {
  const [workspace, setWorkspace] = useState('');
  const [commands, setCommands] = useState<string[]>([]);
  const [showCmds, setShowCmds] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.claude.getWorkspace().then(setWorkspace);
  }, []);

  const pickDir = async () => {
    const dir = await window.claude.pickDirectory();
    if (dir) setWorkspace(dir);
  };

  const loadCommands = async () => {
    if (loading) return;
    setLoading(true);
    setShowCmds(true);
    const list = await window.claude.getCommands();
    setCommands(list);
    setLoading(false);
  };

  const shortPath = workspace.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div style={{
      width: 220,
      flex: '0 0 auto',
      borderRight: '1px solid #21262d',
      background: '#010409',
      padding: '12px 10px',
      overflowY: 'auto',
      WebkitAppRegion: 'no-drag',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    } as React.CSSProperties}>
      {/* 工作空间 */}
      <div>
        <div style={{ fontSize: 11, color: '#6e7681', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          工作空间
        </div>
        <button
          onClick={pickDir}
          title={workspace}
          style={sideBtnStyle}
        >
          📁 {shortPath.length > 22 ? '…' + shortPath.slice(-21) : shortPath}
        </button>
      </div>

      {/* 命令列表 */}
      <div>
        <button onClick={loadCommands} style={{ ...sideBtnStyle, width: '100%', marginBottom: 8 }}>
          ⚡ 命令列表
        </button>
        {showCmds && (
          loading ? (
            <div style={{ fontSize: 12, color: '#6e7681', padding: '4px 0' }}>加载中…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {commands.map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => { onPickCommand('/' + cmd); setShowCmds(false); }}
                  style={cmdStyle}
                >
                  /{cmd}
                </button>
              ))}
              {commands.length === 0 && (
                <div style={{ fontSize: 12, color: '#6e7681' }}>未获取到命令（需 claude 已登录）</div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

const sideBtnStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: '#161b22',
  border: '1px solid #30363d',
  color: '#c9d1d9',
  padding: '8px 10px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const cmdStyle: React.CSSProperties = {
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: '#8b949e',
  padding: '5px 10px',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
