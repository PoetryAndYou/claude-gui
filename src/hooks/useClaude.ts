import { useState, useEffect, useCallback, useRef } from 'react';
import type { Conversation } from '../../electron/preload';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type ChatStatus = 'idle' | 'thinking' | 'error';

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
  const streamingId = useRef<string | null>(null);
  const inited = useRef(false);

  // 初始化：加载已有对话
  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    window.claude.conv.list().then(({ conversations, activeId }) => {
      setConvList(conversations);
      setActiveId(activeId);
      // 历史对话的消息这里没存（claude 端有，靠 --resume 续接），前端默认空
      const map: Record<string, ConvState> = {};
      conversations.forEach((c) => (map[c.id] = { messages: [] }));
      setConvs(map);
    });

    const api = window.claude;
    api.onChunk((text) => {
      if (!streamingId.current || !activeIdRef.current) return;
      setConvs((prev) => {
        const c = prev[activeIdRef.current!];
        if (!c) return prev;
        return {
          ...prev,
          [activeIdRef.current!]: {
            messages: c.messages.map((m) =>
              m.id === streamingId.current ? { ...m, content: m.content + text } : m
            ),
          },
        };
      });
    });
    api.onStatus((s) => {
      if (s === 'thinking') {
        setStatus('thinking');
        const id = `a-${Date.now()}`;
        streamingId.current = id;
        setConvs((prev) => {
          const c = prev[activeIdRef.current!];
          if (!c) return prev;
          return {
            ...prev,
            [activeIdRef.current!]: {
              messages: [...c.messages, { id, role: 'assistant', content: '' }],
            },
          };
        });
      } else if (s === 'done') {
        setStatus('idle');
        streamingId.current = null;
      } else if (s === 'error') {
        setStatus('error');
        streamingId.current = null;
      }
    });
    api.onError((msg) => {
      setError(msg);
      setStatus('error');
      streamingId.current = null;
    });
  }, []);

  // 用 ref 保持 activeId 最新（给回调用）
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

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
    streamingId.current = null;
  }, []);

  const switchConv = useCallback(async (id: string) => {
    const ok = await window.claude.conv.switch(id);
    if (ok) {
      setActiveId(id);
      setStatus('idle');
      setError('');
      streamingId.current = null;
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

  return {
    messages, status, error,
    convList, activeId,
    send, stop, newChat, switchConv, deleteConv, renameConv,
  };
}
