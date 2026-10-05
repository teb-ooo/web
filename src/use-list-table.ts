import { useCallback, useEffect, useMemo, useState } from "react";
import { isApiError } from "./api-error.js";

/** The sort a table reports: the column id and a direction. Same shape as `@teb-ooo/ui`'s `Sort`. */
export interface ListSort {
  columnId: string;
  direction: "asc" | "desc";
}

/** Filter values: a string per filter; an empty string or undefined means the filter is off. */
export type ListFilters = Record<string, string | undefined>;

/** What the list operation is asked: its query parameters, built from the table's state. */
export type ListParams = Record<string, string | number | undefined>;

/** What `useList` must return: the parts of a TanStack Query result the table needs (the generated hooks return this). */
export interface ListQuery<D> {
  data: D | undefined;
  isPending: boolean;
  isFetching: boolean;
  /** True while `data` is the previous page's, held by `placeholderData: keepPreviousData`. The generated hooks return it. */
  isPlaceholderData?: boolean;
  error: unknown;
  refetch: () => unknown;
}

export interface ListTableOptions<T, D, F extends ListFilters> {
  /**
   * The generated list hook, called with the params this hook builds. Keep the previous page on screen while the next loads
   * with `placeholderData: keepPreviousData`:
   * `(params) => $api.useQuery("get", "/api/issues", { params: { query: params } }, { placeholderData: keepPreviousData })`.
   */
  useList: (params: ListParams) => ListQuery<D>;
  /** Reads the rows and the next cursor from a response. Default: `data.items` and `data.next_cursor`. */
  select?: (data: D) => { rows: T[]; nextCursor?: string | null | undefined };
  /** Initial filter values. */
  filters?: F;
  /** Initial sort; null for the server's own order. */
  sort?: ListSort | null;
  /** Rows per page: sent as `limit`. @default 25 */
  pageSize?: number;
  /** Page sizes offered by the table's rows-per-page select. */
  pageSizes?: number[];
  /** Wait this long after the last keystroke before the search is sent. @default 250 */
  debounceMs?: number;
  /** Query parameter names, when the operation does not use these. */
  paramNames?: { q?: string; limit?: string; cursor?: string; sort?: string };
  /** How a sort is written in the `sort` parameter. Default: the column id, with a leading `-` for descending. */
  formatSort?: (sort: ListSort) => string;
}

export interface ListTableResult<T, F extends ListFilters> {
  /** The search box's text, as typed. */
  query: string;
  setQuery: (q: string) => void;
  filters: F;
  setFilter: <K extends keyof F>(key: K, value: F[K]) => void;
  /** Turns every filter and the search off. */
  clearFilters: () => void;
  /** True when the search or any filter is on (to name them in an empty state and offer "Clear filters"). */
  hasActiveFilters: boolean;
  sort: ListSort | null;
  /** The params last sent to the list operation. */
  params: ListParams;
  isFetching: boolean;
  /** Spread onto `DataTable`: `<DataTable label="Issues" columns={...} rowKey={...} {...table} />`. */
  table: {
    rows: T[];
    loading: boolean;
    error?: string;
    onRetry: () => void;
    sort: ListSort | null;
    onSortChange: (sort: ListSort | null) => void;
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalIsLowerBound: boolean;
      hasNext: boolean;
      onPageChange: (page: number) => void;
      onPageSizeChange: (pageSize: number) => void;
      pageSizes?: number[];
    };
  };
}

interface Paging {
  signature: string;
  /** cursors[n] is the cursor that fetches page n; page 0 has none. */
  cursors: (string | undefined)[];
  page: number;
}

const defaultSelect = <T, D>(data: D): { rows: T[]; nextCursor?: string | null | undefined } => {
  const d = data as { items?: T[]; next_cursor?: string | null };
  return { rows: d.items ?? [], nextCursor: d.next_cursor };
};

const defaultFormatSort = (s: ListSort): string => (s.direction === "desc" ? "-" : "") + s.columnId;

/**
 * Drives a `DataTable` from a server-paginated list operation, so searching, filtering and sorting happen on the server
 * and never in the client over the rows of one page. It owns the search text (debounced), the filters, the sort, the page
 * size and the cursor stack (Next uses the response's next cursor, Previous goes back through the cursors already seen),
 * resets to the first page whenever any of them changes, and returns props to spread onto `DataTable`.
 */
export function useListTable<T, D, F extends ListFilters = ListFilters>(options: ListTableOptions<T, D, F>): ListTableResult<T, F> {
  const { useList, select = defaultSelect as (d: D) => { rows: T[]; nextCursor?: string | null | undefined }, pageSizes, debounceMs = 250, paramNames, formatSort = defaultFormatSort } = options;
  const names = { q: "q", limit: "limit", cursor: "cursor", sort: "sort", ...paramNames };

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<F>((options.filters ?? {}) as F);
  const [sort, setSort] = useState<ListSort | null>(options.sort ?? null);
  const [pageSize, setPageSize] = useState(options.pageSize ?? 25);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), debounceMs);
    return () => window.clearTimeout(t);
  }, [query, debounceMs]);

  const signature = JSON.stringify([debounced, filters, sort, pageSize]);
  const [paging, setPaging] = useState<Paging>({ signature, cursors: [undefined], page: 0 });
  // Any change of search, filters, sort or page size starts again from the first page.
  const current = paging.signature === signature ? paging : { signature, cursors: [undefined], page: 0 };
  if (paging.signature !== signature) setPaging(current);

  const params = useMemo<ListParams>(() => {
    const p: ListParams = { [names.limit]: pageSize };
    if (debounced !== "") p[names.q] = debounced;
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "") p[k] = v;
    if (sort) p[names.sort] = formatSort(sort);
    const cursor = current.cursors[current.page];
    if (cursor !== undefined) p[names.cursor] = cursor;
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, filters, sort, pageSize, current.page, current.cursors, names.limit, names.q, names.sort, names.cursor]);

  const result = useList(params);
  const { rows, nextCursor } = result.data !== undefined ? select(result.data) : { rows: [] as T[], nextCursor: undefined };
  const moreAfterThis = nextCursor !== undefined && nextCursor !== null && nextCursor !== "";
  // While the rows on screen are the previous page's (a page change is loading), their next cursor is not the current page's:
  // going forward then would push the same cursor twice and show one page under the next one's range.
  const hasNext = moreAfterThis && result.isPlaceholderData !== true;

  const onPageChange = useCallback(
    (page: number) => {
      setPaging((p) => {
        const base = p.signature === signature ? p : { signature, cursors: [undefined], page: 0 };
        if (page < 0 || page === base.page) return base;
        if (page < base.page) return { ...base, page };
        // forward: only to the next page, whose cursor the response gave
        if (!hasNext || page !== base.page + 1) return base;
        return { ...base, cursors: [...base.cursors.slice(0, base.page + 1), nextCursor as string], page };
      });
    },
    [signature, hasNext, nextCursor],
  );

  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => setFilters((f) => ({ ...f, [key]: value })), []);
  const clearFilters = useCallback(() => {
    setQuery("");
    setDebounced("");
    setFilters((f) => Object.fromEntries(Object.keys(f).map((k) => [k, undefined])) as F);
  }, []);

  const offset = current.page * pageSize;
  const hasActiveFilters = debounced !== "" || Object.values(filters).some((v) => v !== undefined && v !== "");
  const error = result.error ? (isApiError(result.error) ? result.error.userMessage : "The list could not be loaded.") : undefined;

  return {
    query,
    setQuery,
    filters,
    setFilter,
    clearFilters,
    hasActiveFilters,
    sort,
    params,
    isFetching: result.isFetching,
    table: {
      rows,
      loading: result.isPending || result.isFetching,
      ...(error !== undefined ? { error } : {}),
      onRetry: () => void result.refetch(),
      sort,
      onSortChange: setSort,
      pagination: {
        page: current.page,
        pageSize,
        total: offset + rows.length,
        totalIsLowerBound: moreAfterThis,
        hasNext,
        onPageChange,
        onPageSizeChange: setPageSize,
        ...(pageSizes ? { pageSizes } : {}),
      },
    },
  };
}
