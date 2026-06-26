import type { CSSProperties } from 'react';

// 矢量图标库：统一 stroke/fill 风格，替代 emoji
// 用法：<Icon name="send" size={16} color="#fff" />
const PATHS: Record<string, string> = {
  // 闪电（claude 标识）
  bolt: 'M13 2L3 14h6l-1 8 10-12h-6l1-8z',
  // 文件夹
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  // 文件
  file: 'M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 0v4h4',
  // 纸飞机（发送）
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  // 加号（新对话）
  plus: 'M12 5v14M5 12h14',
  // 闪电圆点（技能/命令 触发器）
  zap: 'M9 2L4 12h5l-1 10 11-12h-6l1-8z',
  // 星形（技能）
  star: 'M12 2l3 7 7 .5-5.5 4.5 2 7L12 17l-6.5 4 2-7L2 9.5 9 9z',
  // 圆圈（代理）
  circle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 7v5l3 3',
  // 命令行方括号
  command: 'M9 6L4 12l5 6M15 6l5 6-5 6',
  // 删除/关闭（×）
  close: 'M6 6l12 12M18 6L6 18',
  // 刷新
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5',
  // 搜索
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm10 17l-5-5',
  // 设置/齿轮
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4l2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1m11.4-11.4l2.1-2.1',
  // 对话气泡（对话）
  chat: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-5 4V5z',
  // 警告
  warn: 'M12 2L2 20h20L12 2z M12 9v5m0 3v.5',
  // 复制
  copy: 'M8 8h12v12H8zM4 4h12v4M4 4v12h4',
  // 勾（已复制）
  check: 'M5 12l5 5L20 7',
  // 回车/发送箭头
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  // 向下箭头（回到底部）
  arrowDown: 'M12 5v14M5 12l7 7 7-7',
  // 垃圾桶（清空）
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  // 编辑/铅笔
  edit: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  // 太阳（浅色主题）
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  // 月亮（深色主题）
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  // 面板/侧边栏
  panel: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z M9 3v18',
  // 模型/大脑
  model: 'M9 3a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 9v1a3 3 0 0 0 1 2.8V14a3 3 0 0 0 3 3 3 3 0 0 0 3 1 3 3 0 0 0 3-1 3 3 0 0 0 3-3v-1.2A3 3 0 0 0 22 10V9a3 3 0 0 0-2-2.5V6a3 3 0 0 0-3-3 3 3 0 0 0-3 1 3 3 0 0 0-3-1z',
};

export function Icon({
  name, size = 16, color = 'currentColor', style,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: '-2px', ...style }}
    >
      <path d={d} />
    </svg>
  );
}
