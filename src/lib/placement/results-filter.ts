export type ResultFilter = "assigned" | "new" | "submitted" | "reviewed";

export function resultFilter(value: string | null | undefined): ResultFilter {
  return value === "new" || value === "submitted" || value === "reviewed" ? value : "assigned";
}

export function resultsHref(filter: ResultFilter) {
  return filter === "assigned" ? "/teacher/placement" : `/teacher/placement?status=${filter}`;
}
