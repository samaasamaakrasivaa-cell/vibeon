type HomeworkSelection = { manual?: boolean; extraTaskIds: string[]; removedTaskIds?: string[] };

export function assignedHomeworkTasks<T extends { id: string; section: string; hidden: boolean }>(tasks: T[], homework: HomeworkSelection) {
  const removed = new Set(homework.removedTaskIds);
  if (homework.manual !== false) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return homework.extraTaskIds.map((id) => byId.get(id)).filter((task): task is T => !!task && !task.hidden && !removed.has(task.id));
  }

  const extra = new Set(homework.extraTaskIds);
  const ordinary = tasks.filter((task) => task.section === "homework" && !task.hidden && !removed.has(task.id));
  const existing = new Set(ordinary.map((task) => task.id));
  return [...ordinary, ...tasks.filter((task) => extra.has(task.id) && !existing.has(task.id) && !removed.has(task.id))];
}

export function setHomeworkAssignment(
  homework: HomeworkSelection & { taskIds: string[] },
  tasks: { id: string; section: string }[],
  on: boolean,
) {
  const ids = new Set(tasks.map((task) => task.id));
  const removed = homework.removedTaskIds ?? [];
  return {
    taskIds: on ? homework.taskIds : homework.taskIds.filter((id) => !ids.has(id)),
    extraTaskIds: on ? [...new Set([...homework.extraTaskIds, ...ids])] : homework.extraTaskIds.filter((id) => !ids.has(id)),
    removedTaskIds: on ? removed.filter((id) => !ids.has(id)) : homework.manual === false
      ? [...new Set([...removed, ...tasks.filter((task) => task.section === "homework").map((task) => task.id)])]
      : removed,
  };
}
