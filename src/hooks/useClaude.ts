import { useState, useEffect, useCallback, useRef } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type ChatStatus = 'idle' | 'thinking' | 'error';

/**
 * 管理 claude 对话状态：消息列表、流式接收、发送/中断/新会话
 */
export function useClaude() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string>('');
  // 当前正在流式接收的 assistant 消息 id
  const streamingId = useRef<string | null>(null);

  useEffect(() => {
    const api = window.claude;
    // 流式增量 → 追加到正在生成的 assistant 消息
    api.onChunk((text) => {
      if (!streamingId.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamingId.current ? { ...m, content: m.content + text } : m
        )
      );
    });
    api.onStatus((s) => {
      if (s === 'thinking') {
        setStatus('thinking');
        // thinking 时先创建一个空的 assistant 消息占位
        const id = `a-${Date.now()}`;
        streamingId.current = id;
        setMessages((prev) => [...prev, { id, role: 'assistant', content: '' }]);
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

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || status === 'thinking') return;
    setError('');
    // 立即显示用户消息
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: trimmed }]);
    await window.claude.ask(trimmed);
  }, [status]);

  const stop = useCallback(() => {
    window.claude.stop();
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    setStatus('idle');
    setError('');
    streamingId.current = null;
    window.claude.newChat();
  }, []);

  return { messages, status, error, send, stop, newChat };
}
