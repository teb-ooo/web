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
      {form.submitError ? <p role="alert">{form.submitError}</p> : null /* a conflict or server error with no field to put it on (0.9.7) */}
    </form>
  );
}

// route: beforeLoad: RequireUser   (router context must carry { queryClient })
```

Test helpers live in `@teb-ooo/web/testing`: `renderWithProviders`, `setPlayground`, `setupMswServer`, `sseResponse`, `problemResponse`, and (0.9.6) `paletteRouteProblems(spec, routePatterns)`, which lists `x-palette` tags whose `when.route` matches no route of the app.

`playground` (from `window.__PLAYGROUND__`) exposes `{ appName, env, claudeSessionUrl, platformDomain, locale, timezone }`.

## Live data

`useLive()` keeps every generated-hook query current from the app's `/api/live` event stream ([UI-yvn](https://rb.teb.ooo/UI-yvn), design in the shared docs `live-data.md`), so a screen changes within a second or two when someone else changes the data, with no reload.

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

## Feedback

`useFeedback()` is the state and actions behind the feedback panel (`FeedbackPanel` in `@teb-ooo/ui`, a dialog). It is reached only through Cmd+K: `useFeedbackCommand(feedback)` from `@teb-ooo/ui/cmdk` registers "Send feedback". No header button.

```tsx
import { useFeedback } from "@teb-ooo/web";
import { FeedbackPanel } from "@teb-ooo/ui";
import { useFeedbackCommand } from "@teb-ooo/ui/cmdk";

function Root() {
  const feedback = useFeedback();   // once, inside the router and the query provider
  useFeedbackCommand(feedback);     // "Send feedback" in Cmd+K, only when feedback.available
  return <FeedbackPanel feedback={feedback} />;
}
```

- `available` is true only for the superadmin (`is_admin`) or the app's owner (`is_owner`, from `/auth/me`), and not in a browser that reports `navigator.webdriver` (test browsers; some embedded or automated browsers do too). `force: true` or `?feedback=1` in the address overrides that. A missing `is_owner` counts as false.
- The panel takes free text, an optional picked element (selector, role, visible text, rectangle; click it on the page, Escape cancels), and an optional screenshot with a preview (html-to-image, loaded only when asked: png, else jpeg, at most 5 MB, nothing masked, the panel itself left out). A line lists what is sent besides the text: the route, the last 20 console errors (kept from the moment the hook mounts), the viewport and the user agent.
- `submit()` posts multipart to `/_playground/feedback` (`text`, `context` as JSON, optional `screenshot`) and answers `{ bead, agent, status }`. A failure keeps a local draft (the text and the picked element), offered again the next time the panel opens.

Releasing: bump the version, test, tag `vX.Y.Z`, push, `scripts/publish.sh` (the same routine as `@teb-ooo/ui`; it needs `UI_LIB_NPM_PASSWORD`). Check that packages depending on this one still allow the new version first.

## Platform shell data (0.7.0)

The platform bar and palette in `@teb-ooo/ui` (`Shell`) read their data here, so the list can grow without apps changing code.

- `platformLinks()` returns the links every app's Cmd+K carries under its own group: My profile (id), Go to dashboard (ah), Go to work tracker (bd), Go to design system (ui), each as `{ id, title, keywords, href }`. Add a new platform link to `LINK_SPECS` in `src/platform.ts` and every app has it after upgrading.
- `platformDomain()`, `platformUrl(app, path?)`: the platform domain comes from `window.__PLAYGROUND__.platform_domain` when the server sends it, otherwise from the current host without its first label (`ui-staging.teb.ooo` gives `teb.ooo`); `null` on localhost. `playground.platformDomain` is the raw field.
- `LOGOUT_PATH` (`/auth/logout`): sign out is a full-page GET navigation.
- `useLiveStatus()`: the status of the screen's live stream (`live`, `degraded`, `reconnecting`, `off`) for the bar's dot. `useLive` and `useLiveQueries` report to it by themselves; an app calls nothing.

## Signed-out check without a failed request (0.7.1)

`useUser` / `fetchUser` ask `/auth/me?optional=1`. A server on playground-go 0.7.2 or newer answers 200 `{"anonymous":true,...}` when nobody is signed in, which is treated as signed out (`user: null`), so the browser logs no failed request on a sign-in page. An older server ignores the parameter and answers 401, which still means signed out. `AuthOptions.optional: false` asks plain `/auth/me`.

`useHasLiveStream()` (0.7.2) says whether any screen has a live stream mounted; the platform bar shows its dot only then, so an app with no live data shows no indicator.

`useFeedback` opens straight into picking an element (0.7.3): open, click the element, type, Enter. Escape while picking skips the pick. `pickOnOpen: false` opens to the text instead.

## Agent status (0.7.4, action and turn timer 0.7.5)

`useAgentStatus()` polls the platform's `GET /_playground/agent` on the app's own origin every 15 s while the tab is visible and returns `{agent, status, since, summary}` with `status` one of `working`, `idle`, `offline`, `logged_out`; the platform bar's dot on the agent button follows it. Only the superadmin or the app's owner can read it; for anyone else, in a test browser (unless `force`), or when the route is missing or fails, it returns `null` and the bar draws no dot.

From 0.7.5 `useAgentStatus` also returns `action` (`{label, target, since}` or null), `turnStartedAt` (or ""), `serverTime` and `receivedAt`; `turnElapsedMs(state, Date.now())` gives the turn's age on the server's clock and `formatElapsed(ms)` writes it ("4m 12s"). `fast: true` polls every 3 s (`fastMs`) instead of every 15 s, for a popover that is open. An older platform answer simply has no action and no turn.

## Server-driven lists: useListTable

A list the server pages (an operation with `limit`, `cursor` and `next_cursor`) is searched, filtered and sorted by the server through the operation's parameters, never in the client over the rows of one page ([API-bpe](https://rb.teb.ooo/API-bpe)). `useListTable` owns the state for that and returns props for `DataTable` from `@teb-ooo/ui`:

```tsx
const list = useListTable({
  useList: (params) => $api.useQuery("get", "/api/issues", { params: { query: params } }, { placeholderData: keepPreviousData }),
  filters: { status: undefined as string | undefined },
  sort: { columnId: "updated", direction: "desc" },
  pageSizes: [25, 50, 100],
});
return (
  <>
    <SearchInput value={list.query} onValueChange={list.setQuery} label="Search" />
    <Select label="Status" value={list.filters.status ?? null} onValueChange={(v) => list.setFilter("status", v ?? undefined)} options={statusOptions} />
    <DataTable label="Issues" columns={columns} rowKey={(r) => r.id} {...list.table} empty={list.hasActiveFilters ? <EmptyState title="No issues match" action={<Button onClick={list.clearFilters}>Clear filters</Button>} /> : "No issues yet."} />
  </>
);
```

- **Owns:** the search text (`query`, sent debounced as `q`), the `filters` (each sent as its own parameter, left out when empty), the `sort` (sent as `sort`, `-name` for descending), the page size (`limit`) and the cursor stack: Next uses the response's `next_cursor`, Previous goes back through the cursors already seen. Any change of search, filter, sort or page size returns to the first page.
- **Returns:** `table` (spread it onto `DataTable`: `rows`, `loading`, `error` as a sentence with `onRetry`, `sort`, `onSortChange` and `pagination` with `hasNext`), `query`/`setQuery`, `filters`/`setFilter`/`clearFilters`, `hasActiveFilters`, `params` and `isFetching`.
- **Options:** `select(data) => { rows, nextCursor }` (default `data.items` and `data.next_cursor`), `paramNames` ({ q, limit, cursor, sort }), `formatSort`, `debounceMs` (250), `pageSize` (25).
- The total is unknown for a cursor list, so the pager says "1-25 of 25+" while there is a next page and the real count on the last one.

`useListTable` (0.9.12) is typed by the operation: pass the generated query type as the fourth generic (`useListTable<Row, Data, Filters, QueryOf<"/api/issues">>`) and a misspelt filter name, a wrong value type or a name the hook owns (`q`, `limit`, `cursor`, `sort`) is a type error; filters may be strings, numbers or booleans; `table.loading` is true for a first load and a page change, not for a quiet refetch of the same page.

## Errors and requests outside the generated client

`describeError(error)` (0.9.10) turns any error a query, a mutation or a request holds into one sentence safe to show: an `ApiError` says its `userMessage`, a problem document its `detail` or `title`, a network failure that the server could not be reached, anything else a generic try-again line; a thrown `Error`'s own message is never shown. Use it instead of a local copy.

For a call the generated hooks cannot make (a binary upload or download, a browser-only route) use `platformFetch(url, init)` (cookies, `Accept: application/json`, an `X-Request-Id`) and pass the response to `throwIfNotOk` to get an `ApiError` on failure: `const res = await throwIfNotOk(await platformFetch("/api/x/audio", { method: "POST", body }))`, then read `res.blob()`, `res.arrayBuffer()` or `res.json()`.

## Lint

`npm run lint` runs Oxlint with the template's configuration (`.oxlintrc.json`); `scripts/publish.sh` refuses to publish with lint errors. There is no formatter: formatting is not enforced in this package.
