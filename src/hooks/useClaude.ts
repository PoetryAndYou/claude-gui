import { useState, useEffect, useCallback, useRef } from 'react';
import type { Conversation, ClaudeItems, Usage, ToolEvent } from '../../electron/preload';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  usage?: Usage | null;   // 仅助手消息：token / 耗时 / 成本
  events?: ToolEvent[];   // 仅助手消息：思考/工具调用过程（Codex 式展示）
  error?: boolean;        // 标记出错的消息
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
  const [error, setError] = useState<string>('');
  const [commands, setCommands] = useState<ClaudeItems>(EMPTY_ITEMS);
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
    api.onStatus((convId, s) => {
      if (s === 'thinking') {
        if (convId === activeIdRef.current) setStatus('thinking');
        const id = `a-${Date.now()}`;
        streamingIds.current[convId] = id;
        setConvs((prev) => {
          const c = prev[convId];
          if (!c) return prev;
          return {
            ...prev,
            [convId]: { messages: [...c.messages, { id, role: 'assistant', content: '' }] },
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
          setStatus(s === 'done' ? 'idle' : 'error');
        }
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
  }, []);

  const messages = activeId ? convs[activeId]?.messages ?? [] : [];

  // 内部占位（保留接口稳定性）
  const fireAsk = useCallback(async () => { await window.claude.ask(''); }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'thinking') return;
      setError('');
      // 若没有激活对话，先创建（首条消息作为标题）
      let curId = activeId;
      if (!curId) {
        curId = await window.claude.conv.create(trimmed);
        const { conversations } = await window.claude.conv.list();
        setConvList(conversations);
        setActiveId(curId);
        setConvs((prev) => ({ ...prev, [curId!]: { messages: [] } }));
      }
      // 立即显示用户消息
      setConvs((prev) => {
        const c = prev[curId!];
        return { ...prev, [curId!]: { messages: [...(c?.messages ?? []), { id: `u-${Date.now()}`, role: 'user', content: trimmed }] } };
      });
      await window.claude.ask(trimmed);
    },
    [status, activeId],
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
      await window.claude.ask(userText);
    },
    [activeId, status, convs],
  );

  /**
   * 编辑用户消息后重发：把该用户消息改为新内容，删掉其后所有消息，重新 ask。
   */
  const editAndResend = useCallback(
    async (userMsgId: string, newContent: string) => {
      if (!activeId || status === 'thinking') return;
      const trimmed = newContent.trim();
      if (!trimmed) return;
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
      await window.claude.ask(trimmed);
    },
    [activeId, status, convs],
  );

  const stop = useCallback(() => window.claude.stop(), []);

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
      setStatus(streamingIds.current[id] ? 'thinking' : 'idle');
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
  };
}
