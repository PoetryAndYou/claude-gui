// 原生命令路由：检测 GUI 可接管的 slash 命令（/clear /model /cost），
// 不让其当字面文本透传给 claude（headless -p 模式下这些命令大多不生效）。
//
// 仅做"判定"——具体动作（开模型选择器、插入汇总消息等）由调用方执行。

// 可被 GUI 接管的内置命令动作
export type NativeAction = 'clear' | 'model' | 'cost';

// 路由结果：intercepted=true 表示 GUI 已接管（调用方应据此跳过 ask 并执行动作）
export interface NativeCommandResult {
  intercepted: boolean;
  action?: NativeAction;     // intercepted 时具体动作
  restText?: string;         // 命令之外的附带文本（如 "/clear 重新开始"→"重新开始"）；多数场景为空
}

// 匹配整条消息仅是一个命令的情况（可带前后空白）：
//   /clear            → action=clear
//   /model sonnet     → action=model（带走参数，忽略，开启选择器）
// 不匹配的情况（原样发送给 claude）：
//   "帮我看下 /clear 对不对"——命令不在首段，是普通文本
const COMMAND_RE = /^\s*\/([A-Za-z][\w-]*)\b\s*(.*)$/s;

const ACTION_NAMES: Record<string, NativeAction> = {
  clear: 'clear',
  model: 'model',
  cost: 'cost',
};

/**
 * 判定一条待发送文本是否命中 GUI 接管的原生命令。
 * @param text 待发送文本
 *returns intercepted=true 时调用方应跳过 ask，按 action 执行 GUI 动作；
 *         intercepted=false 时按普通文本走原有 ask 流程
 */
export function routeNativeCommand(text: string): NativeCommandResult {
  const m = text.match(COMMAND_RE);
  if (!m) return { intercepted: false };
  const action = ACTION_NAMES[m[1]];
  if (!action) return { intercepted: false };
  return { intercepted: true, action, restText: (m[2] || '').trim() };
}

// 判断某个单命令名是否是 GUI 接管的动作（供输入框补全/侧栏标识用）
export function isActionCommand(name: string): name is NativeAction {
  return name in ACTION_NAMES;
}
