import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { captureConsoleErrors, clearConsoleErrors, describeElement, recentConsoleErrors, selectorOf, FEEDBACK_IGNORE_ATTR, isFeedbackNode } from "../src/feedback-capture.js";
import { useFeedback } from "../src/feedback.js";
import { HttpResponse, createTestQueryClient, http, setupMswServer } from "../src/testing.js";

vi.mock("html-to-image", () => ({
  toBlob: async (_node: unknown, o: { type?: string }) => new Blob(["x".repeat(1000)], { type: o.type ?? "image/png" }),
}));

const server = setupMswServer();
const me = (extra: object) => http.get("*/auth/me", () => HttpResponse.json({ subject: "s", email: "a@b.c", username: "a", groups: [], is_admin: false, ...extra }));

function wrapper() {
  const qc = createTestQueryClient();
  return ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  window.localStorage.clear();
  clearConsoleErrors();
  URL.createObjectURL = () => "blob:preview";
  URL.revokeObjectURL = () => undefined;
});
afterEach(() => {
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
  document.body.innerHTML = "";
});

describe("console errors", () => {
  it("keeps the last 20, shortens long lines, and catches uncaught errors", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const release = captureConsoleErrors();
    for (let i = 0; i < 25; i++) console.error(`problem ${i}`);
    console.error("x".repeat(900));
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    const got = recentConsoleErrors();
    release();
    quiet.mockRestore();
    expect(got).toHaveLength(20);
    expect(got.at(-1)).toBe("Uncaught boom");
    expect(got.some((l) => l.startsWith("xxx") && l.endsWith("…"))).toBe(true);
    expect(got).not.toContain("problem 0");
  });
});

describe("describing an element", () => {
  it("gives a selector, a role, the visible text and the rectangle", () => {
    document.body.innerHTML = '<main><section><button>One</button></section><section><button id="go" aria-label="Save it">Save</button></section></main>';
    const second = document.querySelectorAll("section")[1]!.querySelector("button")!;
    expect(selectorOf(second)).toBe("button#go");
    const d = describeElement(second);
    expect(d).toMatchObject({ selector: "button#go", role: "button", text: "Save it" });
    expect(Object.keys(d.rect).sort()).toEqual(["height", "width", "x", "y"]);
    expect(selectorOf(document.querySelectorAll("section")[0]!.querySelector("button")!)).toBe("main > section:nth-of-type(1) > button");
  });
  it("knows the feedback panel's own nodes", () => {
    document.body.innerHTML = `<div ${FEEDBACK_IGNORE_ATTR}><span id="in">x</span></div><span id="out">y</span>`;
    expect(isFeedbackNode(document.getElementById("in"))).toBe(true);
    expect(isFeedbackNode(document.getElementById("out"))).toBe(false);
  });
});

describe("useFeedback", () => {
  it("is available to the superadmin and to the app owner, and to nobody else", async () => {
    for (const [extra, want] of [[{ is_admin: true }, true], [{ is_owner: true }, true], [{}, false]] as const) {
      server.use(me(extra));
      const { result, unmount } = renderHook(() => useFeedback(), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.available).toBe(want));
      if (!want) await new Promise((r) => setTimeout(r, 30));
      expect(result.current.available).toBe(want);
      unmount();
    }
  });

  it("is not available when signed out or in a test browser", async () => {
    server.use(http.get("*/auth/me", () => HttpResponse.json({}, { status: 401 })));
    const out = renderHook(() => useFeedback(), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 30));
    expect(out.result.current.available).toBe(false);
    out.unmount();

    server.use(me({ is_admin: true }));
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    const wd = renderHook(() => useFeedback(), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 30));
    expect(wd.result.current.available).toBe(false);
  });

  it("sends the text, the context and the screenshot as multipart, then reports the bead", async () => {
    server.use(me({ is_owner: true }));
    let received = "";
    server.use(
      http.post("*/_playground/feedback", async ({ request }) => {
        received = await request.text();
        return HttpResponse.json({ bead: "ui-77", agent: "ui", status: "idle" });
      }),
    );
    const { result } = renderHook(() => useFeedback(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.sends.join(" ")).toContain("Console errors");
    act(() => result.current.setText("The header overlaps on a phone"));
    act(() => result.current.setIncludeScreenshot(true));
    await waitFor(() => expect(result.current.screenshot).not.toBeNull());
    expect(result.current.sends.join(" ")).toContain("A screenshot");
    await act(async () => result.current.submit());
    await waitFor(() => expect(result.current.status, String(result.current.error)).toBe("sent"));
    expect(result.current.result).toEqual({ bead: "ui-77", agent: "ui", status: "idle" });
    expect(received).toContain('name="text"');
    expect(received).toContain("The header overlaps on a phone");
    expect(received).toContain('name="context"');
    expect(received).toContain('"route":"/"');
    expect(received).toContain('"console_errors"');
    expect(received).toContain('"viewport"');
    expect(received).toContain('name="screenshot"');
    expect(window.localStorage.getItem("teb-ooo:feedback-draft")).toBeNull();
  });

  it("keeps a draft when sending fails, offers it again, and does not send empty text", async () => {
    server.use(me({ is_admin: true }));
    let calls = 0;
    server.use(
      http.post("*/_playground/feedback", () => {
        calls++;
        return HttpResponse.json({ title: "Unavailable", detail: "The agent route is not up." }, { status: 503 });
      }),
    );
    const a = renderHook(() => useFeedback(), { wrapper: wrapper() });
    await waitFor(() => expect(a.result.current.available).toBe(true));
    act(() => a.result.current.open());
    await act(async () => a.result.current.submit());
    expect(calls).toBe(0);
    act(() => a.result.current.setText("please look at this"));
    await act(async () => a.result.current.submit());
    await waitFor(() => expect(a.result.current.status).toBe("failed"));
    expect(a.result.current.error).toBe("The agent route is not up.");
    expect(JSON.parse(window.localStorage.getItem("teb-ooo:feedback-draft") ?? "null")).toMatchObject({ text: "please look at this" });
    a.unmount();

    const b = renderHook(() => useFeedback(), { wrapper: wrapper() });
    await waitFor(() => expect(b.result.current.available).toBe(true));
    act(() => b.result.current.open());
    expect(b.result.current.text).toBe("please look at this");
    expect(b.result.current.restoredDraft).toBe(true);
  });

  it("picks an element by clicking it, and Escape cancels", async () => {
    server.use(me({ is_admin: true }));
    document.body.innerHTML = '<button id="target">Target</button>';
    const { result } = renderHook(() => useFeedback(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.available).toBe(true));
    act(() => result.current.open());
    act(() => result.current.startPicking());
    expect(result.current.picking).toBe(true);
    const target = document.getElementById("target")!;
    act(() => {
      target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(result.current.picking).toBe(false);
    expect(result.current.element?.selector).toBe("button#target");
    act(() => result.current.clearElement());
    expect(result.current.element).toBeNull();
    act(() => result.current.startPicking());
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(result.current.picking).toBe(false);
  });
});
