type HomeworkSelection = { manual?: boolean; extraTaskIds: string[]; removedTaskIds?: string[] };

export function assignedHomeworkTasks<T extends { id: string; section: string; hidden: boolean }>(tasks: T[], homework: HomeworkSelection) {
  if (homework.manual !== false) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return homework.extraTaskIds.map((id) => byId.get(id)).filter((task): task is T => !!task && !task.hidden);
  }

  const removed = new Set(homework.removedTaskIds);
  const extra = new Set(homework.extraTaskIds);
  return [
    ...tasks.filter((task) => task.section === "homework" && !task.hidden && !removed.has(task.id)),
    ...tasks.filter((task) => extra.has(task.id)),
  ];
}
