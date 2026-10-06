import { getPlayground } from "./playground.js";

/** Where "Sign out" goes: a full-page navigation (GET) to the app's own logout route. */
export const LOGOUT_PATH = "/auth/logout";

export interface PlatformLink {
  id: string;
  /** Verb-first, as the palette shows it. */
  title: string;
  keywords: readonly string[];
  /** Absolute URL on the platform domain. */
  href: string;
}

/**
 * The platform's domain (`teb.ooo`): `platform_domain` from `window.__PLAYGROUND__` when the server sends it, else the
 * current host without its first label (`ui-staging.teb.ooo` gives `teb.ooo`). `null` on localhost, an IP or a bare domain.
 */
export function platformDomain(hostname: string = typeof window === "undefined" ? "" : window.location.hostname): string | null {
  const given = getPlayground().platformDomain;
  if (given !== "") return given;
  if (hostname === "" || /^[\d.]+$/u.test(hostname) || hostname.includes(":")) return null;
  const labels = hostname.split(".");
  return labels.length < 3 ? null : labels.slice(1).join(".");
}

/** True on a staging address: the server says `env` is staging, or the host's first label ends in `-staging`. */
function onStaging(): boolean {
  if (getPlayground().env === "staging") return true;
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  return (host.split(".")[0] ?? "").endsWith("-staging");
}

/**
 * `https://<app>.<platform domain>/<path>`, or null when the domain is unknown (local development). On a staging address
 * the link stays on staging (`https://<app>-staging.<platform domain>/<path>`), so the dashboard link of `ui-staging` goes
 * to `ah-staging`, not to production.
 */
export function platformUrl(app: string, path = "/"): string | null {
  const domain = platformDomain();
  return domain === null ? null : `https://${app}${onStaging() ? "-staging" : ""}.${domain}${path}`;
}

interface LinkSpec {
  id: string;
  title: string;
  keywords: readonly string[];
  app: string;
  path?: string;
}

/**
 * The platform links every app's palette carries under their own group, in display order. This list grows here
 * (a new platform app, a new page) and every app gets it by upgrading the package.
 */
const LINK_SPECS: readonly LinkSpec[] = [
  { id: "platform:profile", title: "My profile", keywords: ["account", "passkey", "settings", "id"], app: "id", path: "/profile" },
  { id: "platform:dashboard", title: "Go to dashboard", keywords: ["ah", "apps", "home", "agents"], app: "ah" },
  { id: "platform:tracker", title: "Go to work tracker", keywords: ["bd", "beads", "issues", "tasks"], app: "bd" },
  { id: "platform:design-system", title: "Go to design system", keywords: ["ui", "components", "gallery", "tokens"], app: "ui" },
];

/** The platform links that can be resolved here (none on localhost). */
export function platformLinks(): PlatformLink[] {
  const out: PlatformLink[] = [];
  for (const s of LINK_SPECS) {
    const href = platformUrl(s.app, s.path);
    if (href !== null) out.push({ id: s.id, title: s.title, keywords: s.keywords, href });
  }
  return out;
}
