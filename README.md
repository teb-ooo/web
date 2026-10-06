# @teb-ooo/web

The non-visual frontend glue for playground apps: a typed API client with TanStack Query bindings, the signed-in user and route guards, schema-derived forms, server-driven lists, live updates, formatters and the test helpers. It has no components and no styles, so `@teb-ooo/ui` stays purely atomic. Apps never call `fetch` directly; everything goes through these (see "Requests outside the generated client").

Sections: [A first screen](#a-first-screen) · [API client and errors](#api-client-and-errors) · [Auth and guards](#auth-and-guards) · [Forms](#forms) · [Lists](#lists-uselisttable) · [Live data](#live-data) · [Formatters and the playground](#formatters-and-the-playground) · [Testing](#testing) · [For the shell only](#for-the-shell-only) · [Developing this package](#developing-this-package). The history of releases is in [CHANGELOG.md](CHANGELOG.md).

## A first screen

```tsx
import { createApi, useUser, useForm, createBodyValidator, RequireUser } from "@teb-ooo/web";
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
      {form.submitError ? <p role="alert">{form.submitError}</p> : null}
    </form>
  );
}
// route: beforeLoad: RequireUser   (the router context must carry { queryClient })
```

## API client and errors

- `createApi<paths>(options?)` returns the typed client and the TanStack Query bindings (`api.useQuery("get", "/api/items")`, `api.useMutation(...)`, `api.client`), over `openapi-fetch` and `openapi-react-query`. Every request carries cookies and an `X-Request-Id`; a 401 sends the browser to sign in.
- `createQueryClient()` is a `QueryClient` with the playground defaults: no retry on a 4xx `ApiError`, one quick retry otherwise (`shouldRetry` is that policy), no refetch on window focus, 30 s staleness.
- `ApiError` is the one error shape (`status`, `title`, `detail`, `fieldErrors`, `requestId`); `isApiError(e)` narrows. Its `userMessage` is a sentence for a person (a 4xx's detail, a plain line for a 5xx); `message` keeps the raw text for logs.
- `describeError(error)` turns any error a query, a mutation or a request holds into one sentence safe to show: an `ApiError` says its `userMessage`, a problem document its `detail` or `title`, a network failure that the server could not be reached, anything else a generic try-again line; a thrown `Error`'s own message is never shown. Use it instead of a local copy.
- `loginUrl(next)` and `redirectToLogin()` build and follow the sign-in address (nothing on an `/auth/` page, so no loops).

### Requests outside the generated client
For a call the generated hooks cannot make (a binary upload or download, a browser-only route) use `platformFetch(url, init)` (cookies, `Accept: application/json`, an `X-Request-Id`) and pass the response to `throwIfNotOk` to get an `ApiError` on failure:
`const res = await throwIfNotOk(await platformFetch("/api/x/audio", { method: "POST", body }))`, then read `res.blob()`, `res.arrayBuffer()` or `res.json()`.

## Auth and guards
- `useUser()` returns `{ user, isLoading }` (`null` when signed out); `useIsAdmin()`; `fetchUser()` and `ensureUser()` resolve the cached user for a loader (`null` when signed out, never a redirect); `userQueryOptions` and `ME_QUERY_KEY` are the query behind them (invalidate `ME_QUERY_KEY` after login or logout). They ask `/auth/me?optional=1`, so a sign-in page logs no failed request.
- Route guards: `requireUser()` and `requireAdmin()` return a `beforeLoad` function; `RequireUser` and `RequireAdmin` are the same as components. A signed-in person without the admin role gets a `ForbiddenError` (`isForbiddenError(e)` to draw a "not allowed" page).

## Forms
- `createBodyValidator<Body>(openapiDocument, operationId, { pathParams? })` reads the operation's request body schema, so a form cannot submit what the API would reject; `pathParams: ["name"]` (or `true`) validates path parameters as fields beside the body's, for a form whose field is part of the address; `findBodySchema` and `friendlyMessage` ("expected length >= 1" becomes "Enter a value.") are its parts.
- `useForm(validator, { defaultValues, onSubmit })` (TanStack Form underneath) returns `values`, `errors` (keyed like `ApiError.fieldErrors`, `body.title`), `field(name)` bindings, `fieldError(name)`, `setValue`, `handleSubmit`, `reset`, `isValid`, `isSubmitting` and `submitError`: a sentence for a submit that failed without a field to put it on (a conflict, a server error), cleared on the next submit or edit. An `ApiError` thrown by `onSubmit` becomes field errors; anything else is rethrown.

## Lists: useListTable
A list the server pages (an operation with `limit`, `cursor` and `next_cursor`) is searched, filtered and sorted by the server through the operation's parameters, never in the client over the rows of one page. `useListTable` owns the state and returns props for `DataTable` from `@teb-ooo/ui`:

```tsx
const list = useListTable({
  useList: (params) => $api.useQuery("get", "/api/issues", { params: { query: params } }, { placeholderData: keepPreviousData }),
  filters: { status: undefined as string | undefined },
  sort: { columnId: "updated", direction: "desc" },
  pageSizes: [25, 50, 100],
  urlState: true,
});
return (
  <>
    <SearchInput value={list.query} onValueChange={list.setQuery} label="Search" />
    <Select label="Status" value={list.filters.status ?? null} onValueChange={(v) => list.setFilter("status", v ?? undefined)} options={statusOptions} />
    <DataTable label="Issues" columns={columns} rowKey={(r) => r.id} {...list.table} empty={list.hasActiveFilters ? <EmptyState title="No issues match" action={<Button onClick={list.clearFilters}>Clear filters</Button>} /> : "No issues yet."} />
  </>
);
```

- **Owns:** the search text (`query`, sent debounced as `q`), the `filters` (each its own parameter, left out when empty), the `sort` (`-name` for descending), the page size (`limit`) and the cursor stack: Next uses the response's `next_cursor`, Previous goes back through the cursors already seen. Any change of search, filter, sort or page size returns to the first page; Next is ignored while a page change is still loading.
- **Returns:** `table` (spread onto `DataTable`: `rows`, `loading`, `error` with `onRetry`, `sort`, `onSortChange`, `pagination`), `query`/`setQuery`, `filters`/`setFilter`/`clearFilters`, `hasActiveFilters`, `params`, `isFetching`. `table.loading` is true for a first load and a page change, not for a quiet refetch of the same page. The total is unknown for a cursor list, so the pager says "1-25 of 25+" while there is a next page.
- **Typed by the operation:** pass the generated query type as the fourth generic (`useListTable<Row, Data, Filters, QueryOf<"/api/issues">>`): a misspelt filter, a wrong value type or a name the hook owns (`q`, `limit`, `cursor`, `sort`; `paramNames` renames them) is a type error. Filters may be strings, numbers or booleans.
- **In the address:** `urlState: true` keeps the search, filters (typed like their initial values), sort and page size in the address (`?q=...&status=open&sort=-created&limit=50`), read once on mount from the router's search (or the window's without a router) and written back by replacing the entry; the page always starts at the first. Give a custom `formatSort` a `parseSort`.
- **Options:** `select(data)` (default `data.items` and `data.next_cursor`), `paramNames`, `formatSort`, `parseSort`, `debounceMs` (250), `pageSize` (25), `urlState`.

## Live data
`useLive()` keeps every generated-hook query current from the app's `/api/live` event stream (design in the shared docs `live-data.md`, rule UI-xke), so a screen changes within a second or two when someone else changes the data, with no reload. The shell draws the status dot; an app calls it once, at the root:

```tsx
const { status } = useLive(); // "live" | "reconnecting" | "degraded" | "off"
```

- Events say only which resource changed (`event: change`, `id: <counter>`, `data: {"resource":"widgets"}`; the server may add `project` and `id` (from `live.WithID`), which the hook passes to `onEvent` but does not use to narrow: every query of the resource refetches, a list as well as a detail, because a query's path cannot say which record it holds). The queries of that resource are marked stale and refetch through the normal API operation, so authorisation stays the API's. A query's resource is the first path segment after `/api/` (`resourceOfPath`); map the ones that do not follow it with `resources: { beads: ["/api/work/"] }`. An event naming no resource refreshes everything under `paths` (default `["/api/"]`).
- Events within `debounceMs` (300) become one refetch; `onEvent(data, meta)` may return `false` to ignore one. The stream is open only while the tab is visible. Every reopen after the first refreshes everything after a random delay of 0 to `jitterMs` (2000), so a deploy does not refetch every tab at once.
- Status: `live`; `reconnecting` (any non-2xx except 401 is retried with backoff up to 30 s, reset after a connection that stayed open); `degraded` (the server said a source it relays is down); `off` (disabled, hidden tab, or a test browser). It is off under `navigator.webdriver` or `?live=0`; `force: true` or `?live=1` turns it on, for the one dedicated e2e.
- A polling screen stops while the stream is live: `refetchInterval: live ? false : 15000`. Or let the hook do it: `pollWhenNotLiveMs: 30000` refreshes the `paths` queries at that interval while the stream is not live. Use `useLiveStatus()` rather than writing your own live-status context.
- Cursor-paged lists built with `useInfiniteQuery` refetch every page loaded so far when invalidated: keep `maxPages` bounded, or prefer a first-page list plus "load more" for screens that stay live for long.
- For streams with their own shape: `useLiveQueries({ url, invalidate, invalidateFor?, ... })` and `matchesPaths(["/api/work/"])`; neither patches the cache, they only say what is stale. `useEventStream(url, handlers, options)` is the general SSE hook (GET or POST, reconnect with `backoffDelay`, `Last-Event-ID`), `runEventStream` its transport and `createSseParser` the parser, for code that is not a React component.
- **Patterns.** A snapshot at connect: the server sends no event when a stream opens (the hook does its own full refresh after a reconnect), so there is nothing to skip at connect. What an event touches: `invalidate` may be a predicate over the query that reads a ref `onEvent` sets. Testing: an open stream means Playwright's `networkidle` never arrives; `useLive()` stays off under a test browser, and with `useLiveQueries` directly cut the stream in the smoke test (`page.route("**/stream", (r) => r.abort("aborted"))`).

## Formatters and the playground
- `fmtDate`, `fmtDateTime`, `fmtRelative`, `fmtNumber`, `fmtBytes`: in the playground locale and timezone (`en-US` and UTC without them). `fmtDate` and `fmtDateTime` take `Intl.DateTimeFormat` options; the style defaults apply only when you ask for no field.
- `playground` and `getPlayground()` read `window.__PLAYGROUND__` as `{ appName, env, claudeSessionUrl, platformDomain, locale, timezone }`, each with a safe default.

## Testing
`@teb-ooo/web/testing`: `renderWithProviders`, `setPlayground`, `setupMswServer` (msw), `sseResponse`, `problemResponse`, `createTestQueryClient`, and `paletteRouteProblems(spec, routePatterns)`, which lists `x-palette` tags (decision 0004) whose `when.route` matches no route of the app.

## For the shell only
These feed the platform bar and Cmd+K in `@teb-ooo/ui` (`Shell`); an app does not call them (the platform-shell test fails an app that does).
- **Platform links:** `platformLinks()` (My profile, Go to dashboard, Go to work tracker, Go to design system, as `{ id, title, keywords, href }`; add one to `LINK_SPECS` in `src/platform.ts`), `platformDomain()` and `platformUrl(app, path?)` (the domain from `platform_domain`, else the host without its first label; `null` on localhost; links stay on staging when the page is), `LOGOUT_PATH`.
- **Live status:** `useLiveStatus()` and `useHasLiveStream()` (the bar's dot shows only when a stream is mounted); `useLive` and `useLiveQueries` report to them by themselves.
- **Feedback:** `useFeedback()` is the state behind `FeedbackPanel`: `available` only for the superadmin or the app's owner and not in a test browser (`force: true` or `?feedback=1` overrides); it opens into picking an element (`pickOnOpen`), keeps `anchor` (the picked element's box), `includeElement`, an optional screenshot (html-to-image, loaded only when asked; png, else jpeg, at most 5 MB; the panel itself is left out) and the context it sends (route, the last 20 console errors, viewport, user agent). `submit()` posts multipart to `/_playground/feedback` and answers `{ bead, agent, status }`; a failure keeps a local draft. Its pieces: `describeElement`, `selectorOf`, `recentConsoleErrors`, `MAX_SCREENSHOT_BYTES`.
- **Agent status:** `useAgentStatus()` polls `/_playground/agent` every 15 s (`fast: true`: every 3 s) while the tab is visible and returns `{ agent, status, since, summary, action, turnStartedAt, serverTime, receivedAt }` with `status` one of `working`, `idle`, `offline`, `logged_out`; `null` for anyone but the superadmin or the owner, in a test browser, or when the route is missing. `turnElapsedMs(state, Date.now())` and `formatElapsed(ms)` give the turn's age.

## Developing this package
`npm ci && npm test` (vitest, jsdom, msw; includes type-level tests), `npm run typecheck`, `npm run lint` (Oxlint with the template's configuration; no formatter), `npm run build` (Vite library mode plus `tsc` declarations), `npm run gen:fixture` (regenerates `test/fixtures/schema.d.ts` from `test/fixtures/openapi.json`). Releasing is in [docs/release.md](docs/release.md): `scripts/publish.sh` runs typecheck, lint, tests and the release-age check, and refuses a version `@teb-ooo/ui` would not accept as a peer.
