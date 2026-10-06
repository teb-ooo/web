import { describe, expectTypeOf, it } from "vitest";
import { useListTable } from "../src/use-list-table.js";
import type { ListQuery } from "../src/use-list-table.js";

// What a generated hook's query type looks like.
interface IssuesQuery {
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: string;
  status?: "open" | "closed";
  archived?: boolean;
}
declare function useIssues(params: IssuesQuery): ListQuery<{ items: { id: string }[]; next_cursor?: string }>;

describe("useListTable is typed by the operation's query", () => {
  it("accepts the operation's own filters with their types, and hands useList the typed query", () => {
    const t = useListTable({ useList: useIssues, filters: { status: "open", archived: false } });
    expectTypeOf(t.params).toEqualTypeOf<IssuesQuery>();
  });
  it("rejects a misspelt filter, a wrong value type and a name the hook owns", () => {
    // @ts-expect-error not a parameter of the operation
    useListTable({ useList: useIssues, filters: { statuss: "open" } });
    // @ts-expect-error wrong value type
    useListTable({ useList: useIssues, filters: { status: "done" } });
    // @ts-expect-error `limit` is the hook's
    useListTable({ useList: useIssues, filters: { limit: 5 } });
  });
});
