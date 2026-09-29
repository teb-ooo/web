import { describe, expect, it } from "vitest";
import { createSseParser, type SseMessage } from "../src/sse.js";

function parse(chunks: string[]) {
  const out: SseMessage[] = [];
  const retries: number[] = [];
  const p = createSseParser({ onMessage: (m) => out.push(m), onRetry: (n) => retries.push(n) });
  for (const c of chunks) p.push(c);
  p.end();
  return { out, retries };
}

describe("createSseParser", () => {
  const stream = 'event: text\ndata: {"text":"hi"}\n\nevent: done\ndata: {}\nid: 7\n\n';

  it("parses whole events", () => {
    expect(parse([stream]).out).toEqual([
      { event: "text", data: '{"text":"hi"}' },
      { event: "done", data: "{}", id: "7" },
    ]);
  });

  it("gives identical results for every possible split point", () => {
    const whole = parse([stream]).out;
    for (let i = 0; i <= stream.length; i++) {
      expect(parse([stream.slice(0, i), stream.slice(i)]).out).toEqual(whole);
    }
    // and one char at a time
    expect(parse([...stream]).out).toEqual(whole);
  });

  it("handles CRLF and CR, including CRLF split across chunks", () => {
    const s = "event: a\r\ndata: 1\r\n\r\ndata: 2\r\r";
    const whole = parse([s]).out;
    expect(whole).toEqual([
      { event: "a", data: "1" },
      { event: "message", data: "2" },
    ]);
    for (let i = 0; i <= s.length; i++) expect(parse([s.slice(0, i), s.slice(i)]).out).toEqual(whole);
  });

  it("joins multi-line data, skips comments and unknown fields, strips one leading space", () => {
    expect(parse([": ping\ndata: a\ndata:  b\nfoo: bar\n\n"]).out).toEqual([{ event: "message", data: "a\n b" }]);
  });

  it("carries the last id forward and reports retry", () => {
    const r = parse(["id: 1\ndata: a\n\ndata: b\n\nretry: 1500\n\nretry: x\n\n"]);
    expect(r.out.map((m) => m.id)).toEqual(["1", "1"]);
    expect(r.retries).toEqual([1500]);
  });

  it("drops an incomplete trailing event and events without data", () => {
    expect(parse(["event: x\n\ndata: partial"]).out).toEqual([]);
  });

  it("strips a leading BOM", () => {
    expect(parse(["﻿data: x\n\n"]).out).toEqual([{ event: "message", data: "x" }]);
  });
});
