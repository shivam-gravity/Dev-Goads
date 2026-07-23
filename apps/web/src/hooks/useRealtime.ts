import { useEffect, useRef, useCallback, useState } from "react";

type RealtimeStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

interface RealtimeMessage {
  type: string;
  channel?: string;
  payload?: unknown;
  timestamp?: number;
}

type MessageHandler = (channel: string, payload: unknown) => void;

const WS_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

/**
 * React hook that establishes a WebSocket connection to the API server's /ws endpoint.
 * Automatically reconnects on disconnect with exponential backoff.
 * Subscriptions are restored on reconnect.
 *
 * Usage:
 *   const { subscribe, status } = useRealtime(workspaceId, businessId);
 *   useEffect(() => subscribe("campaign.progress:jobId", (channel, payload) => { ... }), []);
 */
export function useRealtime(workspaceId: string | undefined, businessId?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");

  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    if (businessId) params.set("businessId", businessId);
    return `${protocol}//${host}/ws?${params.toString()}`;
  }, [workspaceId, businessId]);

  const sendJson = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  const connect = useCallback(() => {
    if (!workspaceId) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      setStatus("connected");
      reconnectAttemptRef.current = 0;

      // Restore subscriptions after reconnect
      for (const channel of subscriptionsRef.current) {
        ws.send(JSON.stringify({ type: "subscribe", channel }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: RealtimeMessage = JSON.parse(event.data);
        if (msg.type === "event" && msg.channel) {
          const handlers = handlersRef.current.get(msg.channel);
          if (handlers) {
            for (const handler of handlers) {
              handler(msg.channel, msg.payload);
            }
          }
          // Also fire wildcard handlers (e.g. subscribed to "campaign.progress" gets "campaign.progress:abc")
          for (const [pattern, patternHandlers] of handlersRef.current) {
            if (pattern !== msg.channel && msg.channel.startsWith(pattern + ":")) {
              for (const handler of patternHandlers) {
                handler(msg.channel, msg.payload);
              }
            }
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setStatus("reconnecting");
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [workspaceId, businessId, getWsUrl]);

  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current;
    const delay = WS_RECONNECT_DELAYS[Math.min(attempt, WS_RECONNECT_DELAYS.length - 1)];
    reconnectAttemptRef.current = attempt + 1;

    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, [connect]);

  /**
   * Subscribe to a channel. Returns an unsubscribe function.
   * The channel can be exact ("campaign.progress:abc") or a prefix ("campaign.progress").
   */
  const subscribe = useCallback((channel: string, handler: MessageHandler): (() => void) => {
    // Track subscription for reconnect restoration
    subscriptionsRef.current.add(channel);
    sendJson({ type: "subscribe", channel });

    // Register handler
    if (!handlersRef.current.has(channel)) {
      handlersRef.current.set(channel, new Set());
    }
    handlersRef.current.get(channel)!.add(handler);

    return () => {
      const handlers = handlersRef.current.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          handlersRef.current.delete(channel);
          subscriptionsRef.current.delete(channel);
          sendJson({ type: "unsubscribe", channel });
        }
      }
    };
  }, [sendJson]);

  return { subscribe, status, sendJson };
}

/**
 * Hook for subscribing to a specific channel with automatic cleanup.
 * Convenience wrapper around useRealtime's subscribe.
 */
export function useRealtimeChannel(
  subscribe: (channel: string, handler: MessageHandler) => () => void,
  channel: string | null,
  handler: MessageHandler,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!channel) return;
    return subscribe(channel, (ch, payload) => handlerRef.current(ch, payload));
  }, [subscribe, channel]);
}

/**
 * Hook that streams chat responses via SSE (Server-Sent Events).
 * Returns streaming state and the send function.
 */
export function useStreamingChat(businessId: string | undefined) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const sendStreaming = useCallback(async (
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    onChunk?: (chunk: string, fullText: string) => void,
    onDone?: (fullText: string) => void,
  ) => {
    if (!businessId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setStreamedText("");
    let accumulated = "";

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, messages }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.chunk) {
              accumulated += data.chunk;
              setStreamedText(accumulated);
              onChunk?.(data.chunk, accumulated);
            }
            if (data.done) {
              const finalText = data.fullText ?? accumulated;
              setStreamedText(finalText);
              onDone?.(finalText);
              setIsStreaming(false);
              return finalText;
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setIsStreaming(false);
        throw err;
      }
    } finally {
      setIsStreaming(false);
    }
    return accumulated;
  }, [businessId]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { sendStreaming, isStreaming, streamedText, abort };
}
