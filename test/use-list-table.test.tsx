import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useListTable } from "../src/use-list-table.js";
import type { ListParams } from "../src/use-list-table.js";

interface Row {
  id: string;
  name: string;
  status: "open" | "closed";
}
// 60 rows, three pages of 25: the server owns the filtering, sorting and paging.
const ALL: Row[] = Array.from({ length: 60 }, (_, i) => ({ id: `r${i + 1}`, name: `row-${String(i + 1).padStart(2, "0")}`, status: i % 3 === 0 ? "closed" : "open" }));
const calls: ListParams[] = [];

function serve(p: ListParams): { items: Row[]; next_cursor?: string } {
  calls.push(p);
  let rows = ALL;
  if (typeof p.q === "string") rows = rows.filter((r) => r.name.includes(p.q as string));
  if (typeof p.status === "string") rows = rows.filter((r) => r.status === p.status);
  if (typeof p.sort === "string") {
    const desc = p.sort.startsWith("-");
    const key = p.sort.replace(/^-/, "") as keyof Row;
    rows = [...rows].sort((a, b) => (a[key] < b[key] ? -1 : 1) * (desc ? -1 : 1));
  }
  const start = typeof p.cursor === "string" ? Number(p.cursor) : 0;
  const limit = Number(p.limit);
  const page = rows.slice(start, start + limit);
  return start + limit < rows.length ? { items: page, next_cursor: String(start + limit) } : { items: page };
}

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const useRows = (params: ListParams) => useQuery({ queryKey: ["rows", params], queryFn: () => serve(params), placeholderData: keepPreviousData });
const setup = (extra: Partial<Parameters<typeof useListTable<Row, { items: Row[]; next_cursor?: string }, { status?: string }>>[0]> = {}) =>
  renderHook(() => useListTable<Row, { items: Row[]; next_cursor?: string }, { status?: string }>({ useList: useRows, debounceMs: 5, filters: { status: undefined }, ...extra }), { wrapper });

describe("useListTable over a list of more than one page", () => {
  it("loads the first page and pages with the server's cursors, back and forth", async () => {
    calls.length = 0;
    const { result } = setup();
    await waitFor(() => expect(result.current.table.rows.length).toBe(25));
    expect(result.current.table.rows[0]?.name).toBe("row-01");
    expect(result.current.table.pagination).toMatchObject({ page: 0, hasNext: true, total: 25, totalIsLowerBound: true });
    act(() => result.current.table.pagination.onPageChange(1));
    await waitFor(() => expect(result.current.table.rows[0]?.name).toBe("row-26"));
    expect(result.current.params.cursor).toBe("25");
    act(() => result.current.table.pagination.onPageChange(2));
    await waitFor(() => expect(result.current.table.rows.length).toBe(10));
    expect(result.current.table.pagination).toMatchObject({ page: 2, hasNext: false, total: 60, totalIsLowerBound: false });
    act(() => result.current.table.pagination.onPageChange(0));
    await waitFor(() => expect(result.current.table.rows[0]?.name).toBe("row-01"));
  });

  it("the search reaches a row on page 3 through the server, debounced, and returns to page 1", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.table.rows.length).toBe(25));
    act(() => result.current.table.pagination.onPageChange(1));
    await waitFor(() => expect(result.current.table.pagination.page).toBe(1));
    calls.length = 0;
    act(() => result.current.setQuery("row-57"));
    act(() => result.current.setQuery("row-57 "));
    await waitFor(() => expect(result.current.table.rows.map((r) => r.name)).toEqual(["row-57"]));
    expect(result.current.table.pagination.page).toBe(0);
    expect(result.current.hasActiveFilters).toBe(true);
    // typing twice in a row sent one search, with the cursor reset
    const searches = calls.filter((c) => c.q !== undefined);
    expect(searches.length).toBe(1);
    expect(searches[0]).toMatchObject({ q: "row-57", limit: 25 });
    expect(searches[0]?.cursor).toBeUndefined();
  });

  it("a filter and a sort go to the server and reset the cursor", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.table.rows.length).toBe(25));
    act(() => result.current.table.pagination.onPageChange(1));
    await waitFor(() => expect(result.current.table.pagination.page).toBe(1));
    act(() => result.current.setFilter("status", "closed"));
    await waitFor(() => expect(result.current.table.rows.every((r) => r.status === "closed")).toBe(true));
    expect(result.current.table.pagination.page).toBe(0);
    expect(result.current.params.status).toBe("closed");
    act(() => result.current.table.onSortChange({ columnId: "name", direction: "desc" }));
    await waitFor(() => expect(result.current.table.rows[0]?.name).toBe("row-58"));
    expect(result.current.params.sort).toBe("-name");
    act(() => result.current.clearFilters());
    await waitFor(() => expect(result.current.hasActiveFilters).toBe(false));
  });

  it("changing the page size starts again; Next cannot skip a page", async () => {
    const { result } = setup({ pageSizes: [10, 25] });
    await waitFor(() => expect(result.current.table.rows.length).toBe(25));
    act(() => result.current.table.pagination.onPageChange(2)); // no cursor for page 3 yet
    expect(result.current.table.pagination.page).toBe(0);
    act(() => result.current.table.pagination.onPageSizeChange(10));
    await waitFor(() => expect(result.current.table.rows.length).toBe(10));
    expect(result.current.params.limit).toBe(10);
  });
});

describe("useListTable while a page change is loading", () => {
  it("ignores a second Next until the first page has arrived (no page shown under the next one's range)", async () => {
    const slow = async (p: ListParams) => {
      await new Promise((r) => setTimeout(r, 40));
      return serve(p);
    };
    const useSlow = (params: ListParams) => useQuery({ queryKey: ["slow", params], queryFn: () => slow(params), placeholderData: keepPreviousData });
    const { result } = renderHook(() => useListTable<Row, { items: Row[]; next_cursor?: string }, { status?: string }>({ useList: useSlow, debounceMs: 5, filters: { status: undefined } }), { wrapper });
    await waitFor(() => expect(result.current.table.rows.length).toBe(25));
    act(() => result.current.table.pagination.onPageChange(1));
    expect(result.current.table.pagination.hasNext).toBe(false);
    act(() => result.current.table.pagination.onPageChange(2));
    await waitFor(() => expect(result.current.table.rows[0]?.name).toBe("row-26"));
    await new Promise((r) => setTimeout(r, 120));
    expect(result.current.table.pagination.page).toBe(1);
    expect(result.current.params.cursor).toBe("25");
    expect(result.current.table.rows[0]?.name).toBe("row-26");
  });
});

describe("useListTable: collisions and loading", () => {
  it("refuses a filter named like a parameter the hook owns", () => {
    expect(() => renderHook(() => useListTable<Row, { items: Row[]; next_cursor?: string }>({ useList: useRows, filters: { limit: "5" } }), { wrapper })).toThrow(/collides/);
    // renamed, the old name is free
    expect(() => renderHook(() => useListTable<Row, { items: Row[]; next_cursor?: string }>({ useList: useRows, filters: { limit: "5" }, paramNames: { limit: "page_size" } }), { wrapper })).not.toThrow();
  });

  it("is loading for the first load and a page change, not for a quiet refetch of the same page", async () => {
    const slow = (p: ListParams) => new Promise<{ items: Row[]; next_cursor?: string }>((r) => setTimeout(() => r(serve(p)), 30));
    const useSlow = (params: ListParams) => useQuery({ queryKey: ["quiet", params], queryFn: () => slow(params), placeholderData: keepPreviousData });
    const { result } = renderHook(() => useListTable<Row, { items: Row[]; next_cursor?: string }>({ useList: useSlow, debounceMs: 5 }), { wrapper });
    expect(result.current.table.loading).toBe(true);
    await waitFor(() => expect(result.current.table.rows.length).toBe(25));
    expect(result.current.table.loading).toBe(false);
    act(() => result.current.table.onRetry());
    await waitFor(() => expect(result.current.isFetching).toBe(true), { interval: 2 });
    expect(result.current.table.loading).toBe(false);
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    act(() => result.current.table.pagination.onPageChange(1));
    await waitFor(() => expect(result.current.table.loading).toBe(true));
    await waitFor(() => expect(result.current.table.loading).toBe(false));
  });

  it("passes a boolean or number filter through as it is", async () => {
    const { result } = renderHook(() => useListTable<Row, { items: Row[]; next_cursor?: string }>({ useList: useRows, debounceMs: 5, filters: { archived: false, min: 3 } }), { wrapper });
    await waitFor(() => expect(result.current.table.rows.length).toBe(25));
    expect(result.current.params).toMatchObject({ archived: false, min: 3 });
  });
});

