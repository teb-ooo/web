/** What the feedback tool captures from the page. Pure helpers, no React. */

export const FEEDBACK_IGNORE_ATTR = "data-feedback-ignore";
const MAX_CONSOLE_LINES = 20;
const MAX_LINE_CHARS = 500;

// ---- the last console errors, kept for the report ----

const ring: string[] = [];
let installs = 0;
let restore: (() => void) | undefined;

const encoder = new TextEncoder();

/**
 * A line the server accepts: at most `MAX_LINE_CHARS` (500) characters and, to be safe whichever way it counts, at most 500
 * bytes of UTF-8, including the "…" that marks a cut. (Cutting at 500 and then adding the "…" made 501, which the server
 * refused, and a report of a console error must never be refused because of the error's own length.)
 */
export function clipLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS && encoder.encode(line).length <= MAX_LINE_CHARS) return line;
  let out = "";
  let bytes = encoder.encode("…").length;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > MAX_LINE_CHARS || [...out].length + 2 > MAX_LINE_CHARS) break;
    out += ch;
    bytes += n;
  }
  return `${out}…`;
}

function push(line: string) {
  ring.push(clipLine(line));
  while (ring.length > MAX_CONSOLE_LINES) ring.shift();
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/** Starts keeping the last 20 console errors, uncaught errors and unhandled rejections. Counted: call `release` when done. */
export function captureConsoleErrors(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (installs++ === 0) {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      push(format(args));
      original.apply(console, args as Parameters<typeof console.error>);
    };
    const onError = (e: ErrorEvent) => push(`Uncaught ${e.message}`);
    const onRejection = (e: PromiseRejectionEvent) => push(`Unhandled rejection: ${format([e.reason])}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    restore = () => {
      console.error = original;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }
  return () => {
    if (--installs === 0) {
      restore?.();
      restore = undefined;
    }
  };
}

export function recentConsoleErrors(): string[] {
  return ring.map(clipLine);
}

export function clearConsoleErrors(): void {
  ring.length = 0;
}

// ---- a picked element ----

export interface PickedElement {
  /** A CSS path that finds it again, such as `main > section:nth-of-type(2) > button`. */
  selector: string;
  role: string;
  /** Visible text, shortened. */
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

const implicitRoles: Record<string, string> = {
  a: "link", button: "button", input: "textbox", select: "combobox", textarea: "textbox", h1: "heading", h2: "heading",
  h3: "heading", ul: "list", ol: "list", li: "listitem", table: "table", img: "img", nav: "navigation", main: "main", header: "banner",
  footer: "contentinfo", dialog: "dialog", form: "form", section: "region",
};

/** A short CSS path from the nearest id, or at most five ancestors up. */
export function selectorOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && cur !== document.body && depth < 5; depth++) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
      parts.unshift(`${tag}#${cur.id}`);
      break;
    }
    const parent: Element | null = cur.parentElement;
    const same = parent ? Array.from(parent.children).filter((c) => c.tagName === cur?.tagName) : [];
    parts.unshift(same.length > 1 && parent ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
    cur = parent;
  }
  return parts.join(" > ");
}

export function describeElement(el: Element): PickedElement {
  const r = el.getBoundingClientRect();
  const text = (el.getAttribute("aria-label") ?? (el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    selector: selectorOf(el),
    role: el.getAttribute("role") ?? implicitRoles[el.tagName.toLowerCase()] ?? "generic",
    text: text.length > 120 ? `${text.slice(0, 120)}…` : text,
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
  };
}

/** Is this node part of the feedback panel or its picking overlay (so it is never picked or photographed)? */
export function isFeedbackNode(node: Node | null): boolean {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest(`[${FEEDBACK_IGNORE_ATTR}]`) != null;
}

// ---- a screenshot ----

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export interface Screenshot {
  blob: Blob;
  /** A data URL for the preview (the page's Content-Security-Policy allows data: images, not blob: ones). */
  url: string;
  type: string;
  size: number;
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The screenshot could not be read."));
    reader.readAsDataURL(blob);
  });
}

/**
 * A picture of the page as it is now, without the feedback panel. It is a png when that fits in 5 MB, else a jpeg,
 * else a smaller jpeg. Nothing is masked: the owner sees the preview before it is sent.
 */
export async function captureScreenshot(): Promise<Screenshot> {
  const { toBlob } = await import("html-to-image");
  const filter = (node: HTMLElement) => !isFeedbackNode(node);
  const attempts: { type: "image/png" | "image/jpeg"; quality?: number; pixelRatio: number }[] = [
    { type: "image/png", pixelRatio: 1 },
    { type: "image/jpeg", quality: 0.85, pixelRatio: 1 },
    { type: "image/jpeg", quality: 0.7, pixelRatio: 0.5 },
  ];
  for (const a of attempts) {
    const blob = await toBlob(document.documentElement, { filter, type: a.type, pixelRatio: a.pixelRatio, ...(a.quality ? { quality: a.quality } : {}), cacheBust: true });
    if (blob && blob.size <= MAX_SCREENSHOT_BYTES) return { blob, url: await toDataUrl(blob), type: blob.type || a.type, size: blob.size };
  }
  throw new Error("The screenshot is larger than 5 MB.");
}
