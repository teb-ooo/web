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

`useLiveQueries` keeps the generated query hooks current from a server stream (SSE), so a screen changes within a second or two when someone else changes the data, with no reload.

```tsx
import { matchesPaths, useLiveQueries } from "@teb-ooo/web";

function Live() {
  const { status } = useLiveQueries({ url: "/api/work/stream", invalidate: ["/api/work/"] }); // or matchesPaths([...]) or any predicate
  return <span>{status}</span>; // "live" | "reconnecting" | "off"
}
```

- Each event marks the matching cached queries stale (the open lists, pages and detail panes refetch); events within `debounceMs` (default 300) become one refetch. `onEvent(data, meta)` may return `false` to ignore an event.
- `matchesPaths(["/api/work/"])` matches the keys the generated hooks build, `[method, path, init]`, by the path template's prefix. `invalidate` also takes a predicate over the query.
- The stream is open only while the tab is visible. Whenever it (re)opens after the first time, a dropped connection or a hidden tab, everything matching is invalidated once, since events may have been missed. Event ids are opaque; `Last-Event-ID` is sent on reconnect as an optimisation only.
- A server that answers 503 or 404 is retried with backoff (up to 30s) and the status stays `reconnecting`; a 401 sends the browser to sign in. `status` is `off` only when `enabled` is false, there is no `url`, or the tab is hidden (`paused`).
- It never patches the cache; it only says what is stale.

Releasing: bump the version, test, tag `vX.Y.Z`, push, `scripts/publish.sh` (the same routine as `@teb-ooo/ui`; it needs `UI_LIB_NPM_PASSWORD`). Check that packages depending on this one still allow the new version first.
