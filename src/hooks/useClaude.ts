import { useState, useEffect, useCallback, useRef } from 'react';
import type { Conversation, ClaudeItems } from '../../electron/preload';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type ChatStatus = 'idle' | 'thinking' | 'error';

const EMPTY_ITEMS: ClaudeItems = { commands: [], skills: [], agents: [] };

interface ConvState {
  messages: Message[];
}

/**
 * 管理 claude 对话：多对话切换、消息按对话隔离、流式接收、发送/中断
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
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const convListRef = useRef(convList);
  useEffect(() => { convListRef.current = convList; }, [convList]);

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
      setConvs((prev) => {
        const c = prev[convId];
        if (!c) return prev;
        return {
          ...prev,
          [convId]: {
            messages: c.messages.map((m) =>
              m.id === sid ? { ...m, content: m.content + text } : m
            ),
          },
        };
      });
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
        delete streamingIds.current[convId];
        if (convId === activeIdRef.current) {
          setStatus(s === 'done' ? 'idle' : 'error');
        }
      }
    });
    api.onError((convId, msg) => {
      delete streamingIds.current[convId];
      if (convId === activeIdRef.current) {
        setError(msg);
        setStatus('error');
      }
    });
  }, []);

  const messages = activeId ? convs[activeId]?.messages ?? [] : [];

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
  };
}
