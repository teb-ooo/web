# @teb-ooo/web

The non-visual frontend glue for factory apps: a typed API client with TanStack Query bindings, `useUser`/`useIsAdmin` and route guards, an SSE hook, schema-derived forms, and locale-aware formatters. It has no components and no styles, so `@teb-ooo/ui` stays purely atomic. Apps never call `fetch` directly; everything goes through these hooks.

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

Test helpers live in `@teb-ooo/web/testing`: `renderWithProviders`, `setFactory`, `setupMswServer`, `sseResponse`, `problemResponse`.
