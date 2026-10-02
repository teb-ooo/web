import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "./auth.js";
import { captureConsoleErrors, captureScreenshot, describeElement, isFeedbackNode, recentConsoleErrors, FEEDBACK_IGNORE_ATTR } from "./feedback-capture.js";
import type { PickedElement, Screenshot } from "./feedback-capture.js";

export type { PickedElement } from "./feedback-capture.js";

export interface FeedbackResult {
  /** The bead the feedback became, such as `ui-123`. */
  bead: string;
  /** The agent it was pushed to. */
  agent: string;
  /** `idle`, `working`, `offline` or `logged_out`: whether the agent was reached. */
  status: string;
}

export interface FeedbackContext {
  route: string;
  console_errors: string[];
  viewport: { width: number; height: number; pixel_ratio: number };
  user_agent: string;
}

export type FeedbackStatus = "idle" | "sending" | "sent" | "failed";

export interface FeedbackOptions {
  /** Where the report goes. Default `/_playground/feedback`. */
  endpoint?: string;
  /** Turn it off without unmounting. Default true. */
  enabled?: boolean;
  /**
   * Allow it in a browser that reports `navigator.webdriver` (an automated or embedded browser, such as an in-app
   * pane). Also switched on by `?feedback=1` in the address. The default keeps it out of test browsers.
   */
  force?: boolean;
  /**
   * Open straight into picking an element: the page is highlighted and a click chooses it, then the text. The send is
   * two clicks and a key: open, click the element, type and press Enter. Escape while picking skips the pick and goes
   * to the text. Default true.
   */
  pickOnOpen?: boolean;
  /** Test hooks. */
  fetch?: typeof globalThis.fetch;
}

export interface FeedbackController {
  /** The person may send feedback (the superadmin or the app's owner) and this is not a test browser. */
  available: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  text: string;
  setText: (text: string) => void;
  element: PickedElement | null;
  picking: boolean;
  startPicking: () => void;
  stopPicking: () => void;
  clearElement: () => void;
  includeScreenshot: boolean;
  setIncludeScreenshot: (on: boolean) => void;
  screenshot: { url: string; type: string; size: number } | null;
  screenshotError: string | null;
  capturing: boolean;
  retakeScreenshot: () => void;
  /** What will be sent besides the text, one line each, so the person knows. */
  sends: string[];
  status: FeedbackStatus;
  result: FeedbackResult | null;
  error: string | null;
  /** The text was restored from a draft kept after a failed send. */
  restoredDraft: boolean;
  submit: () => Promise<void>;
}

const DRAFT_KEY = "teb-ooo:feedback-draft";

interface Draft {
  text: string;
  element: PickedElement | null;
}

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return typeof d.text === "string" ? { text: d.text, element: d.element ?? null } : null;
  } catch {
    return null;
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage blocked: the draft is simply not kept
  }
}

function currentContext(): FeedbackContext {
  return {
    route: `${window.location.pathname}${window.location.search}`,
    console_errors: recentConsoleErrors(),
    viewport: { width: window.innerWidth, height: window.innerHeight, pixel_ratio: window.devicePixelRatio || 1 },
    user_agent: navigator.userAgent,
  };
}

async function problemText(res: Response): Promise<string> {
  try {
    const p = (await res.json()) as { detail?: string; title?: string };
    return p.detail ?? p.title ?? `The server answered ${res.status}.`;
  } catch {
    return `The server answered ${res.status}.`;
  }
}

/**
 * The state and actions behind the feedback panel (`FeedbackPanel` in `@teb-ooo/ui`): free text, an optional picked
 * element, an optional screenshot with a preview, and the page context (route, the last 20 console errors, viewport,
 * user agent). It is only `available` to the superadmin or the app's owner and never in a test browser
 * (`navigator.webdriver`). A failed send keeps a local draft. Register the Cmd+K command with `useFeedbackCommand`
 * from `@teb-ooo/ui/cmdk`.
 */
export function useFeedback(options: FeedbackOptions = {}): FeedbackController {
  const { endpoint = "/_playground/feedback", enabled = true, pickOnOpen = true } = options;
  const { user } = useUser();
  const person = user !== null && (user.is_admin || user.is_owner === true);
  const forced = options.force === true || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("feedback") === "1");
  const available = enabled && person && (forced || !(typeof navigator !== "undefined" && navigator.webdriver === true));

  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");
  const [element, setElement] = useState<PickedElement | null>(null);
  const [picking, setPicking] = useState(false);
  const [includeScreenshot, setIncludeScreenshotState] = useState(false);
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus] = useState<FeedbackStatus>("idle");
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const shotRef = useRef<Screenshot | null>(null);

  // Keep the last console errors from the moment the hook is mounted.
  useEffect(() => (available ? captureConsoleErrors() : undefined), [available]);

  const dropShot = useCallback(() => {
    shotRef.current = null;
    setShot(null);
  }, []);
  useEffect(() => dropShot, [dropShot]);

  const reset = useCallback(() => {
    setText("");
    setElement(null);
    setIncludeScreenshotState(false);
    dropShot();
    setShotError(null);
    setStatus("idle");
    setResult(null);
    setError(null);
    setRestoredDraft(false);
  }, [dropShot]);

  const open = useCallback(() => {
    if (!available) return;
    if (status === "sent") reset();
    const draft = readDraft();
    if (draft && text === "") {
      setText(draft.text);
      setElement(draft.element);
      setRestoredDraft(true);
    }
    setIsOpen(true);
    if (pickOnOpen) setPicking(true);
  }, [available, status, reset, text, pickOnOpen]);
  const close = useCallback(() => {
    setPicking(false);
    setIsOpen(false);
  }, []);

  // Taking the picture happens with the panel's own nodes filtered out, so it can be taken while the panel is open.
  const capture = useCallback(async () => {
    setCapturing(true);
    setShotError(null);
    try {
      const s = await captureScreenshot();
      shotRef.current = s;
      setShot(s);
    } catch (e) {
      setShotError(e instanceof Error ? e.message : "The screenshot could not be taken.");
      setIncludeScreenshotState(false);
    } finally {
      setCapturing(false);
    }
  }, []);
  const setIncludeScreenshot = useCallback(
    (on: boolean) => {
      setIncludeScreenshotState(on);
      if (on) void capture();
      else dropShot();
    },
    [capture, dropShot],
  );

  // Picking: the page is highlighted under the pointer; a click chooses; Escape cancels.
  useEffect(() => {
    if (!picking) return;
    const overlay = document.createElement("div");
    overlay.setAttribute(FEEDBACK_IGNORE_ATTR, "");
    Object.assign(overlay.style, { position: "fixed", pointerEvents: "none", zIndex: "2147483647", outline: "2px solid var(--color-link, currentColor)", background: "transparent" });
    document.body.appendChild(overlay);
    let hovered: Element | null = null;
    const onMove = (e: MouseEvent) => {
      const t = e.target instanceof Element && !isFeedbackNode(e.target) ? e.target : null;
      hovered = t;
      if (!t) {
        overlay.style.display = "none";
        return;
      }
      const r = t.getBoundingClientRect();
      Object.assign(overlay.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const onClick = (e: MouseEvent) => {
      if (!hovered) return;
      e.preventDefault();
      e.stopPropagation();
      setElement(describeElement(hovered));
      setPicking(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPicking(false);
      }
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
    };
  }, [picking]);

  const sends = useMemo(() => {
    const c = isOpen ? currentContext() : null;
    const lines = c
      ? [`The page: ${c.route}`, `Console errors: the last ${c.console_errors.length} of up to 20`, `Viewport: ${c.viewport.width} × ${c.viewport.height}`, "Your browser: the user agent"]
      : [];
    if (element) lines.push(`The element you picked: ${element.selector}`);
    if (includeScreenshot && shot) lines.push(`A screenshot (${shot.type.replace("image/", "")}, ${Math.round(shot.size / 1024)} KB), as in the preview`);
    return lines;
  }, [isOpen, element, includeScreenshot, shot]);

  const submit = useCallback(async () => {
    if (!available || text.trim() === "" || status === "sending") return;
    setStatus("sending");
    setError(null);
    const body = new FormData();
    body.set("text", text.trim());
    body.set("context", JSON.stringify({ ...currentContext(), element }));
    if (includeScreenshot && shotRef.current) body.set("screenshot", shotRef.current.blob, `screenshot.${shotRef.current.type === "image/png" ? "png" : "jpg"}`);
    try {
      const res = await (options.fetch ?? globalThis.fetch)(endpoint, { method: "POST", body, credentials: "include", headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(await problemText(res));
      setResult((await res.json()) as FeedbackResult);
      setStatus("sent");
      writeDraft(null);
    } catch (e) {
      writeDraft({ text, element });
      setError(e instanceof Error ? e.message : "The feedback could not be sent.");
      setStatus("failed");
    }
  }, [available, text, status, element, includeScreenshot, endpoint, options.fetch]);

  return {
    available,
    isOpen,
    open,
    close,
    text,
    setText,
    element,
    picking,
    startPicking: () => setPicking(true),
    stopPicking: () => setPicking(false),
    clearElement: () => setElement(null),
    includeScreenshot,
    setIncludeScreenshot,
    screenshot: shot ? { url: shot.url, type: shot.type, size: shot.size } : null,
    screenshotError: shotError,
    capturing,
    retakeScreenshot: () => void capture(),
    sends,
    status,
    result,
    error,
    restoredDraft,
    submit,
  };
}
