/** One dispatched server-sent event. */
export interface SseMessage {
  /** Event name; "message" when the stream sent none. */
  event: string;
  data: string;
  id?: string;
}

export interface SseParser {
  /** Feed decoded text; chunk boundaries may fall anywhere, including inside a CRLF pair. */
  push(text: string): void;
  /** Call when the stream ends. Incomplete trailing events are discarded, per the SSE spec. */
  end(): void;
}

/** Incremental parser for the text/event-stream format (WHATWG HTML, section 9.2). */
export function createSseParser(handlers: {
  onMessage: (m: SseMessage) => void;
  /** Server asked for a reconnect delay via `retry:`. */
  onRetry?: (ms: number) => void;
}): SseParser {
  let line = "";
  let sawCr = false;
  let first = true;
  let event = "";
  let data: string[] = [];
  let lastId: string | undefined;
  let pendingId: string | undefined;

  const dispatch = () => {
    if (data.length > 0) {
      lastId = pendingId ?? lastId;
      const m: SseMessage = { event: event === "" ? "message" : event, data: data.join("\n") };
      if (lastId !== undefined) m.id = lastId;
      handlers.onMessage(m);
    }
    event = "";
    data = [];
    pendingId = undefined;
  };

  const processLine = (l: string) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        data.push(value);
        break;
      case "id":
        if (!value.includes("\0")) pendingId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) handlers.onRetry?.(Number(value));
        break;
      default:
        break;
    }
  };

  return {
    push(text) {
      if (first) {
        first = false;
        if (text.startsWith("﻿")) text = text.slice(1);
      }
      for (const ch of text) {
        if (sawCr) {
          sawCr = false;
          if (ch === "\n") continue;
        }
        if (ch === "\r") {
          sawCr = true;
          processLine(line);
          line = "";
        } else if (ch === "\n") {
          processLine(line);
          line = "";
        } else {
          line += ch;
        }
      }
    },
    end() {
      line = "";
      data = [];
      event = "";
    },
  };
}
