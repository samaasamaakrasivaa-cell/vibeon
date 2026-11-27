export type ResultFilter = "assigned" | "new" | "submitted" | "reviewed";

export function resultFilter(value: string | null | undefined): ResultFilter {
  return value === "new" || value === "submitted" || value === "reviewed" ? value : "assigned";
}

function filterQuery(filter: ResultFilter) {
  return filter === "assigned" ? "" : `?status=${filter}`;
}

export function resultsHref(filter: ResultFilter) {
  return `/teacher/placement${filterQuery(filter)}`;
}

export function attemptHref(id: string, filter: ResultFilter = "assigned", section?: "report") {
  return `/teacher/placement/${id}${section === "report" ? "/report" : ""}${filterQuery(filter)}`;
}
