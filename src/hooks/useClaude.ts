import { useState, useEffect, useCallback, useRef } from 'react';
import type { Conversation, ClaudeItems, Usage, ToolEvent, PendingChange } from '../../electron/preload';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  usage?: Usage | null;   // 仅助手消息：token / 耗时 / 成本
  events?: ToolEvent[];   // 仅助手消息：思考/工具调用过程（Codex 式展示）
  error?: boolean;        // 标记出错的消息
  startedAt?: number;     // 助手消息：开始思考的时间戳（前端墙钟计时用）
  pendingChanges?: PendingChange[];  // 第一轮抓到的写操作意图（确认卡片用）
}

export type ChatStatus = 'idle' | 'thinking' | 'error';
export type Theme = 'dark' | 'light';

const EMPTY_ITEMS: ClaudeItems = { commands: [], skills: [], agents: [] };

interface ConvState {
  messages: Message[];
}

/**
 * 管理 claude 对话：多对话切换、消息按对话隔离、流式接收、发送/中断
 * 额外能力：用量展示、重新生成、编辑后重发
 */
export function useClaude() {
  // 每个对话的消息历史，key = 对话 id
  const [convs, setConvs] = useState<Record<string, ConvState>>({});
  const [convList, setConvList] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>('idle');
  // status 的同步 ref：send 判断"是否思考中"用 ref（React state 异步更新，连发时第二条会读到旧值导致没入队）
  const statusRef = useRef<ChatStatus>('idle');
  const setStatusSynced = (s: ChatStatus) => { statusRef.current = s; setStatus(s); };
  const [error, setError] = useState<string>('');
  const [commands, setCommands] = useState<ClaudeItems>(EMPTY_ITEMS);
  // 变更前确认开关（用户在输入框旁勾选）；开启后每次 send 走两轮：先 default 预览再确认执行
  const [confirmEnabled, setConfirmEnabled] = useState(false);
  // 消息队列：思考中再发的消息入队，当前回复 done 后自动出队发送
  const [queue, setQueue] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const inited = useRef(false);

  // 每个对话独立的 streaming 状态（切换不打断）
  const streamingIds = useRef<Record<string, string>>({});
  // 每个 convId 待 flush 的 chunk 缓冲（累积一帧内的所有 delta，一次 setState）
  const chunkBuf = useRef<Record<string, string>>({});
  const flushRaf = useRef<number | null>(null);
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const convListRef = useRef(convList);
  useEffect(() => { convListRef.current = convList; }, [convList]);

  // 用 requestAnimationFrame 节流：把一帧内到达的所有 chunk 合并成一次 setState，
  // 避免每个 delta(2~3字符)都触发一次 markdown 重渲染导致卡顿/整段蹦出
  const scheduleFlush = useCallback(() => {
    if (flushRaf.current != null) return;
    flushRaf.current = requestAnimationFrame(() => {
      flushRaf.current = null;
      setConvs((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [cid, pending] of Object.entries(chunkBuf.current)) {
          if (!pending) continue;
          const c = next[cid];
          if (!c) { continue; }
          const sid = streamingIds.current[cid];
          if (!sid) { delete chunkBuf.current[cid]; continue; }
          changed = true;
          const msg = c.messages.find((m) => m.id === sid);
          if (!msg) { delete chunkBuf.current[cid]; continue; }
          next[cid] = {
            ...c,
            messages: c.messages.map((m) =>
              m.id === sid ? { ...m, content: (m.content || '') + pending } : m
            ),
          };
          delete chunkBuf.current[cid];
        }
        return changed ? next : prev;
      });
    });
  }, []);

  // 初始化：加载已有对话
  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    window.claude.conv.list().then(({ conversations, activeId }) => {
      setConvList(conversations);
      setActiveId(activeId);
      const map: Record<string, ConvState> = {};
      conversations.forEach((c) => (map[c.id] = { messages: [] }));
      setConvs(map);
    });
    // 启动时预加载命令列表，输入框打 / 时能立即补全
    window.claude.getCommands().then((items) => setCommands(items)).catch(() => {});

    const api = window.claude;
    // 每个对话独立的 streaming 消息 id（按 convId 路由，切换对话不打断后台生成）
    api.onChunk((convId, text) => {
      const sid = streamingIds.current[convId];
      if (!sid) return;
      // 累积到缓冲，由 rAF 周期统一 flush（顺滑、不卡顿）
      chunkBuf.current[convId] = (chunkBuf.current[convId] || '') + text;
      scheduleFlush();
    });
    // 完整 text 块：思考时间长时流式 delta 可能不完整，用完整块补全/替换
    api.onFullText((convId, fullText) => {
      const sid = streamingIds.current[convId];
      if (!sid) return;
      setConvs((prev) => {
        const c = prev[convId];
        if (!c) return prev;
        return {
          ...prev,
          [convId]: {
            messages: c.messages.map((m) => {
              if (m.id !== sid || m.role !== 'assistant') return m;
              // 完整 text 比流式累积长，说明流式丢了，用完整 text 替换
              if (fullText.length > (m.content || '').length) {
                return { ...m, content: fullText };
              }
              return m;
            }),
          },
        };
      });
    });
    api.onStatus((convId, s) => {
      if (s === 'thinking') {
        if (convId === activeIdRef.current) setStatusSynced('thinking');
        const id = `a-${Date.now()}`;
        streamingIds.current[convId] = id;
        setConvs((prev) => {
          const c = prev[convId];
          if (!c) return prev;
          return {
            ...prev,
            [convId]: { messages: [...c.messages, { id, role: 'assistant', content: '', startedAt: Date.now() }] },
          };
        });
      } else if (s === 'done' || s === 'error') {
        // 完成时立即 flush 残留的 buffer（cancel rAF 换成同步 flush，避免最后一段丢/延迟）
        if (flushRaf.current != null) {
          cancelAnimationFrame(flushRaf.current);
          flushRaf.current = null;
        }
        const pending = chunkBuf.current[convId];
        delete chunkBuf.current[convId];
        delete streamingIds.current[convId];
        if (pending) {
          setConvs((prev) => {
            const c = prev[convId];
            if (!c) return prev;
            // 此时 streamingIds 已删，用最后一条 assistant 消息兜底
            const last = c.messages[c.messages.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            return {
              ...prev,
              [convId]: { messages: c.messages.map((m) => m.id === last.id ? { ...m, content: (m.content || '') + pending } : m) },
            };
          });
        }
        if (convId === activeIdRef.current) {
          setStatusSynced(s === 'done' ? 'idle' : 'error');
        }
        // 消息队列：当前回复 done 后，立即出队下一条（仅成功时；error 不自动继续）
        // 不延迟：done 时 claude 已结束，立即发下一条；doSend 内部 setStatus('thinking') 保证串行
        if (s === 'done' && queueRef.current.length > 0) {
          const next = queueRef.current[0];
          queueRef.current = queueRef.current.slice(1);
          setQueue(queueRef.current);
          // 目标对话 = 当前 done 的对话（保证队列在哪发的就在哪执行）
          const targetConvId = convId;
          if (next) {
            doSend(next, targetConvId, confirmEnabledRef.current, false);
          }
        }
      } else if (s === 'awaiting-confirm') {
        // 第一轮结束、等待用户确认：不解除 thinking 状态（仍在等待），保留 streaming 消息可继续接收
        // flush 残留 buffer，但不删 streamingIds（确认后第二轮会复用或新建）
        if (flushRaf.current != null) {
          cancelAnimationFrame(flushRaf.current);
          flushRaf.current = null;
        }
        const pending = chunkBuf.current[convId];
        delete chunkBuf.current[convId];
        if (pending) {
          setConvs((prev) => {
            const c = prev[convId];
            if (!c) return prev;
            const sid = streamingIds.current[convId];
            const last = c.messages[c.messages.length - 1];
            const target = sid ? c.messages.find((m) => m.id === sid) : last;
            if (!target || target.role !== 'assistant') return prev;
            return {
              ...prev,
              [convId]: { messages: c.messages.map((m) => m.id === target.id ? { ...m, content: (m.content || '') + pending } : m) },
            };
          });
        }
        // 保持 thinking 状态（用户看到"等待确认"，不显示输入框）
      }
    });
    api.onError((convId, msg) => {
      delete streamingIds.current[convId];
      // 把当前正在生成的助手消息标记为出错（便于重生成）
      const sid = streamingIds.current[convId];
      if (sid) {
        setConvs((prev) => {
          const c = prev[convId];
          if (!c) return prev;
          return {
            ...prev,
            [convId]: { messages: c.messages.map((m) => m.id === sid ? { ...m, error: true } : m) },
          };
        });
      }
      if (convId === activeIdRef.current) {
        setError(msg);
        setStatus('error');
      }
    });
    // 用量挂到当前正在生成的助手消息上
    api.onUsage((convId, usage) => {
      const sid = streamingIds.current[convId];
      if (!sid) return;
      setConvs((prev) => {
        const c = prev[convId];
        if (!c) return prev;
        return {
          ...prev,
          [convId]: {
            messages: c.messages.map((m) => (m.id === sid ? { ...m, usage } : m)),
          },
        };
      });
    });
    // 过程事件：思考 / 工具调用 / 工具结果（按顺序流入当前助手消息的 events）
    api.onEvent((convId, event) => {
      const sid = streamingIds.current[convId];
      if (!sid) return;
      setConvs((prev) => {
        const c = prev[convId];
        if (!c) return prev;
        return {
          ...prev,
          [convId]: {
            messages: c.messages.map((m) => {
              if (m.id !== sid) return m;
              const events = [...(m.events ?? [])];
              if (event.kind === 'thinking') {
                // 思考是增量拼接：若最后一条也是 thinking 就续上，否则新增
                const last = events[events.length - 1];
                if (last && last.kind === 'thinking') {
                  events[events.length - 1] = { ...last, text: (last.text ?? '') + (event.text ?? '') };
                } else {
                  events.push({ ...event });
                }
              } else if (event.kind === 'tool_use') {
                events.push({ ...event });
              } else if (event.kind === 'tool_result') {
                // 找到对应的 tool_use，把结果挂上去
                const idx = event.toolUseId
                  ? events.findIndex((e) => e.kind === 'tool_use' && e.toolUseId === event.toolUseId)
                  : -1;
                if (idx >= 0) {
                  events[idx] = { ...events[idx], content: event.content, isError: event.isError };
                } else {
                  events.push({ ...event });
                }
              }
              return { ...m, events };
            }),
          },
        };
      });
    });
    // 变更确认请求：第一轮抓到写操作，挂到当前助手消息的 pendingChanges 上（前端渲染确认卡片）
    api.onConfirmRequest((convId, changes) => {
      const sid = streamingIds.current[convId];
      if (!sid || !changes || changes.length === 0) return;
      setConvs((prev) => {
        const c = prev[convId];
        if (!c) return prev;
        return {
          ...prev,
          [convId]: {
            messages: c.messages.map((m) => (m.id === sid ? { ...m, pendingChanges: changes } : m)),
          },
        };
      });
    });
  }, []);

  const messages = activeId ? convs[activeId]?.messages ?? [] : [];

  // 内部占位（保留接口稳定性）
  const fireAsk = useCallback(async () => { await window.claude.ask(''); }, []);

  // confirmEnabled 的 ref：onStatus 回调里出队时读最新值（避免闭包过期）
  const confirmEnabledRef = useRef(confirmEnabled);
  useEffect(() => { confirmEnabledRef.current = confirmEnabled; }, [confirmEnabled]);

  // 核心发送（队列出队时复用）：已确认有 curId，不走入队分支
  // skipDisplay: 出队时消息已在入队时显示了，这里只发 ask 不再重复加消息
  const doSend = useCallback(async (text: string, curId: string, useConfirm: boolean, skipDisplay = false) => {
    if (!skipDisplay) {
      setConvs((prev) => {
        const c = prev[curId];
        if (!c) return prev;
        return { ...prev, [curId]: { messages: [...(c?.messages ?? []), { id: `u-${Date.now()}`, role: 'user', content: text }] } };
      });
    }
    // 立即标记 thinking（同步 ref），保证串行（下一轮出队在此条 done 后才进行）
    setStatusSynced('thinking');
    await window.claude.ask(text, useConfirm);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setError('');
      // 思考中（含等待确认）：仅入队，不立即显示（保证消息和回答一一对应，顺序不打乱）
      // 用 statusRef 同步判断，避免连发时读到旧 state 没入队
      if (statusRef.current === 'thinking') {
        queueRef.current = [...queueRef.current, trimmed];
        setQueue(queueRef.current);
        return;
      }
      // 若没有激活对话，先创建（首条消息作为标题），并把首条用户消息一起写入
      let curId = activeId;
      const isFirst = !curId;
      if (!curId) {
        curId = await window.claude.conv.create(trimmed);
        const { conversations } = await window.claude.conv.list();
        setConvList(conversations);
        setActiveId(curId);
      }
      // 立即显示用户消息（首次创建时一并初始化，避免两次 setConvs 状态竞争）
      setConvs((prev) => {
        const c = prev[curId!];
        const baseMsgs = isFirst ? [] : (c?.messages ?? []);
        return { ...prev, [curId!]: { messages: [...baseMsgs, { id: `u-${Date.now()}`, role: 'user', content: trimmed }] } };
      });
      // 立即标记 thinking（同步 ref），防止后续快速连发同时进入 ask（应入队串行执行）
      setStatusSynced('thinking');
      await window.claude.ask(trimmed, confirmEnabled);
    },
    [status, activeId, confirmEnabled],
  );

  /**
   * 重新生成：删除指定助手消息（及之后的所有消息），重发它前一条用户消息。
   * 对应的 claude 会话里那条 assistant 仍存在——但我们用 --resume + 重新问，
   * claude 会基于历史继续。为避免重复，这里采用「截断本地历史后重发」。
   */
  const regenerate = useCallback(
    async (assistantMsgId: string) => {
      if (!activeId || status === 'thinking') return;
      const conv = convs[activeId];
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === assistantMsgId);
      if (idx < 0) return;
      // 找到这条助手消息之前的最近一条用户消息
      let userIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (conv.messages[i].role === 'user') { userIdx = i; break; }
      }
      if (userIdx < 0) return;
      const userText = conv.messages[userIdx].content;
      // 截断：保留到该用户消息（含）之前，删掉它本身及其后所有内容，再重发
      setConvs((prev) => {
        const c = prev[activeId!];
        if (!c) return prev;
        return { ...prev, [activeId!]: { messages: c.messages.slice(0, userIdx) } };
      });
      await window.claude.ask(userText, confirmEnabled);
    },
    [activeId, status, convs, confirmEnabled],
  );

  /**
   * 编辑用户消息后重发：把该用户消息改为新内容，删掉其后所有消息，重新 ask。
   */
  const editAndResend = useCallback(
    async (userMsgId: string, newContent: string) => {
      if (!activeId) return;
      const trimmed = newContent.trim();
      if (!trimmed) return;
      // 编辑重发应强制生效：若上轮还在生成，先停掉再重发（避免两条 claude 并发）
      if (status === 'thinking') {
        window.claude.stop();
      }
      const conv = convs[activeId];
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === userMsgId);
      if (idx < 0) return;
      // 截断到该用户消息（不含），再用新内容重发
      setConvs((prev) => {
        const c = prev[activeId!];
        if (!c) return prev;
        return { ...prev, [activeId!]: { messages: c.messages.slice(0, idx) } };
      });
      setError('');
      setConvs((prev) => {
        const c = prev[activeId!];
        return { ...prev, [activeId!]: { messages: [...(c?.messages ?? []), { id: `u-${Date.now()}`, role: 'user', content: trimmed }] } };
      });
      await window.claude.ask(trimmed, confirmEnabled);
    },
    [activeId, status, convs, confirmEnabled],
  );

  const stop = useCallback(() => {
    window.claude.stop();
    // 清空队列（用户主动中断，不再发送后续排队消息）
    queueRef.current = [];
    setQueue([]);
  }, []);

  // 清空消息队列（清空待发）
  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setQueue(queueRef.current);
  }, []);

  // 删除队列中指定项
  const removeQueueItem = useCallback((index: number) => {
    queueRef.current = queueRef.current.filter((_, i) => i !== index);
    setQueue(queueRef.current);
  }, []);

  // 队列项移到队首（下一条执行它）。队列存在时一定在 thinking，不能立即抢断当前回复
  const runQueueItemNow = useCallback((index: number) => {
    const item = queueRef.current[index];
    if (item == null) return;
    // 移除原位置，插到队首
    const rest = queueRef.current.filter((_, i) => i !== index);
    queueRef.current = [item, ...rest];
    setQueue(queueRef.current);
  }, []);

  // 变更确认：用户点「执行」→ 第二轮 acceptEdits 重跑；点「拒绝」→ 清掉确认卡片
  const confirmApprove = useCallback(async () => {
    await window.claude.confirmApprove();
  }, []);
  const confirmReject = useCallback(async () => {
    await window.claude.confirmReject();
    // 清掉当前助手消息上的确认卡片
    if (!activeId) return;
    setConvs((prev) => {
      const c = prev[activeId];
      if (!c) return prev;
      return {
        ...prev,
        [activeId]: {
          messages: c.messages.map((m) => (m.pendingChanges ? { ...m, pendingChanges: undefined } : m)),
        },
      };
    });
  }, [activeId]);

  const newChat = useCallback(async () => {
    const id = await window.claude.conv.create();
    const { conversations } = await window.claude.conv.list();
    setConvList(conversations);
    setActiveId(id);
    setConvs((prev) => ({ ...prev, [id]: { messages: [] } }));
    setStatus('idle');
    setError('');
  }, []);

  const switchConv = useCallback(async (id: string) => {
    const ok = await window.claude.conv.switch(id);
    if (ok) {
      setActiveId(id);
      // 状态跟随目标对话：若它正在生成则 thinking，否则 idle
      setStatusSynced(streamingIds.current[id] ? 'thinking' : 'idle');
      setError('');
      // 从 claude session 恢复历史消息（仅在还没加载过时）
      if (!convs[id] || convs[id].messages.length === 0) {
        const conv = convListRef.current.find((c) => c.id === id);
        if (conv?.sessionId) {
          const history = await window.claude.loadHistory(conv.sessionId);
          setConvs((prev) => ({ ...prev, [id]: { messages: history } }));
        }
      }
    }
  }, []);

  const deleteConv = useCallback(async (id: string) => {
    const { conversations, activeId: newActive } = await window.claude.conv.delete(id);
    setConvList(conversations);
    setActiveId(newActive);
  }, []);

  const renameConv = useCallback(async (id: string, title: string) => {
    await window.claude.conv.rename(id, title);
    setConvList((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  const loadCommands = useCallback(async () => {
    const items = await window.claude.getCommands();
    setCommands(items);
  }, []);

  return {
    messages, status, error, commands,
    convList, activeId,
    send, stop, newChat, switchConv, deleteConv, renameConv, loadCommands,
    regenerate, editAndResend,
    fireAsk,
    // 变更前确认
    confirmEnabled, setConfirmEnabled,
    confirmApprove, confirmReject,
    // 消息队列
    queue, clearQueue, removeQueueItem, runQueueItemNow,
  };
}
