import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { useListTable } from "../src/use-list-table.js";
import type { ListParams } from "../src/use-list-table.js";

const useRows = (params: ListParams) => useQuery({ queryKey: ["rows", params], queryFn: () => ({ items: [] as { id: string }[] }), placeholderData: keepPreviousData });

describe("useListTable urlState inside a TanStack Router", () => {
  it("restores from and writes to the router's search, keeping the page's other parameters", async () => {
    let table: ReturnType<typeof useListTable<{ id: string }, { items: { id: string }[] }, { status?: string }>> | undefined;
    function Page() {
      // eslint-disable-next-line react/globals -- a test double records the hook's latest result
      table = useListTable<{ id: string }, { items: { id: string }[] }, { status?: string }>({ useList: useRows, debounceMs: 5, urlState: true, filters: { status: undefined } });
      return <p>page</p>;
    }
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path: "/", component: Page, validateSearch: (s: Record<string, unknown>) => s });
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ["/?tab=2&status=closed"] }) });
    await router.load();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByText("page");
    expect(table?.filters).toEqual({ status: "closed" });
    act(() => table?.setFilter("status", "open"));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: 2, status: "open" }));
  });
});
