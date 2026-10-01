# @teb-ooo/web

The non-visual frontend glue for playground apps: a typed API client with TanStack Query bindings, `useUser`/`useIsAdmin` and route guards, an SSE hook, schema-derived forms, and locale-aware formatters. It has no components and no styles, so `@teb-ooo/ui` stays purely atomic. Apps never call `fetch` directly; everything goes through these hooks.

Run the tests with `npm ci && npm test` (vitest, jsdom, msw; includes type-level tests), and check types with `npm run typecheck`. `npm run build` produces `dist/` (Vite library mode plus `tsc` declarations); `npm run gen:fixture` regenerates `test/fixtures/schema.d.ts` from `test/fixtures/openapi.json`.

```tsx
import { createApi, useUser, useForm, createBodyValidator, fmtRelative, RequireUser } from "@teb-ooo/web";
import type { paths } from "./api/schema"; // openapi-typescript output
import spec from "./api/openapi.json";

export const api = createApi<paths>();
const validator = createBodyValidator<{ title: string }>(spec, "createItem");

function NewItem() {
  const { user } = useUser();
  const create = api.useMutation("post", "/api/items");
  const form = useForm(validator, {
    defaultValues: { title: "" },
    onSubmit: (body) => create.mutateAsync({ body }), // an ApiError becomes form.errors["body.title"]
  });
  const title = form.field<string>("title");
  return (
    <form onSubmit={form.handleSubmit}>
      <input value={title.value} onChange={(e) => title.onChange(e.target.value)} onBlur={title.onBlur} />
      {title.error}
    </form>
  );
}

// route: beforeLoad: RequireUser   (router context must carry { queryClient })
```

Test helpers live in `@teb-ooo/web/testing`: `renderWithProviders`, `setPlayground`, `setupMswServer`, `sseResponse`, `problemResponse`.

`playground` (from `window.__PLAYGROUND__`) exposes `{ appName, env, claudeSessionUrl, assistant, locale, timezone }`; `assistant` is a boolean, false when absent.

## Live data

`useLive()` keeps every generated-hook query current from the app's `/api/live` event stream (WEB-50, design in the shared docs `live-data.md`), so a screen changes within a second or two when someone else changes the data, with no reload.

```tsx
import { useLive } from "@teb-ooo/web";

function Header() {
  const { status } = useLive(); // once, at the root; status: "live" | "reconnecting" | "degraded" | "off"
  return <LiveIndicator status={status} />; // from @teb-ooo/ui
}
```

- Events say only which resource changed: `event: change`, `data: {"resource":"widgets","version":"..."}`. The queries of that resource are marked stale and refetch through the normal API operation, so authorisation stays the API's. The resource of a query is the first path segment after `/api/` (`widgets` covers `/api/widgets` and `/api/widgets/{id}`); map resources that do not follow the convention with `resources: { beads: ["/api/work/"] }`. An event naming no resource refreshes everything under `paths` (default `["/api/"]`).
- Events within `debounceMs` (default 300) become one refetch. `onEvent(data, meta)` may return `false` to ignore an event.
- The stream is open only while the tab is visible. Every (re)open after the first, a dropped connection or a tab shown again, refreshes everything after a random delay of 0 to `jitterMs` (default 2000), so a deploy does not make every tab refetch at once.
- Status: `live`; `reconnecting` (any non-2xx except 401 is retried with backoff up to 30s); `degraded` (the server sent a `degraded` event: a source it relays is down, so changes may be missed until the next change); `off` (disabled, hidden tab, or a test browser). A 401 sends the browser to sign in.
- It is off when `navigator.webdriver` is true (Playwright, so `networkidle` settles) or the page has `?live=0`. `force: true` or `?live=1` turns it on, for the one dedicated e2e.
- There is no polling unless you ask for it: `pollWhenNotLiveMs: 30000` refreshes the `paths` queries at that interval while the stream is not live.
- Cursor-paged lists built with `useInfiniteQuery` refetch every page loaded so far when invalidated, so a long list costs one request per page it has loaded; keep `pages` bounded (`maxPages`) or prefer a first-page list plus "load more" for screens that stay live for long.
- `useLive` is built on `useLiveQueries({ url, invalidate, invalidateFor?, ... })` and `matchesPaths(["/api/work/"])`, which are exported for streams with their own shape. Neither patches the cache; they only say what is stale.

### Patterns (from bd, the first real use)

- **A snapshot at connect.** A server may send one `change` per project or resource when the stream opens. If the screen has just loaded that data, the refetch is wasted: remember the last `version` you saw per resource in `onEvent` and return `false` for the first sighting (and for an unchanged version), so nothing refetches at connect.
- **Deciding what an event touches.** `invalidate` may be a predicate over the query, and it can read a ref that `onEvent` sets: that is how one screen refreshes everything under `/api/work/` for one kind of event and only a counts query for another. With `useLive()` use `invalidateFor`-style narrowing through `resources`, or fall back to `useLiveQueries` for this.
- **Testing.** An open stream means Playwright's `networkidle` never arrives. `useLive()` stays off under a test browser (`navigator.webdriver`, or `?live=0`) for that reason; if you use `useLiveQueries` directly, cut the stream in the smoke test (`page.route("**/stream", (r) => r.abort("aborted"))`) except in the one test that exercises it.
- `status` is `reconnecting` while the server answers 503 or 429, with backoff.

Releasing: bump the version, test, tag `vX.Y.Z`, push, `scripts/publish.sh` (the same routine as `@teb-ooo/ui`; it needs `UI_LIB_NPM_PASSWORD`). Check that packages depending on this one still allow the new version first.
