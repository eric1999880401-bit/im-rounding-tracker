import { useState } from "react";
import type { PatientTask, TaskCategory, TaskPriority } from "../types";
import { useT } from "../i18n";
import { emptyTask, nowIso } from "../utils";

interface TaskListProps {
  tasks: PatientTask[];
  onChange: (tasks: PatientTask[]) => void;
  onCommit?: () => void;
  onFieldBlur?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function TaskList({
  tasks,
  onChange,
  onCommit,
  onFieldBlur,
  onCompositionStart,
  onCompositionEnd,
}: TaskListProps) {
  const t = useT();
  const [draft, setDraft] = useState<PatientTask>(emptyTask());
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const visibleTasks = showCompletedTasks ? tasks : tasks.filter((task) => !task.done);
  const priorityLabel = (priority: TaskPriority) => t(`task.priority.${priority}`);
  const categoryLabel = (category: TaskCategory) => t(`task.category.${category}`);

  function addTask() {
    if (!draft.text.trim()) return;
    onChange([...tasks, { ...draft, text: draft.text.trim(), createdAt: nowIso() }]);
    setDraft(emptyTask());
    window.setTimeout(() => onCommit?.(), 0);
  }

  function updateTask(taskId: string, nextTask: PatientTask, commit = false) {
    onChange(tasks.map((task) => (task.id === taskId ? nextTask : task)));
    if (commit) {
      window.setTimeout(() => onCommit?.(), 0);
    }
  }

  function toggleDone(task: PatientTask) {
    updateTask(task.id, {
      ...task,
      done: !task.done,
      completedAt: task.done ? "" : nowIso(),
    }, true);
  }

  function deleteTask(task: PatientTask) {
    if (!window.confirm(`${t("task.deleteConfirm")}: ${task.text}?`)) return;
    onChange(tasks.filter((item) => item.id !== task.id));
    window.setTimeout(() => onCommit?.(), 0);
  }

  function commitOnBlur() {
    onFieldBlur?.();
  }

  function handleCompositionEnd() {
    onCompositionEnd?.();
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{t("field.tasks")}</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showCompletedTasks}
            onChange={(event) => setShowCompletedTasks(event.target.checked)}
          />
          {showCompletedTasks ? t("action.showCompleted") : t("action.hideCompleted")}
        </label>
      </div>

      <div className="task-input-row">
        <input
          value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={t("task.addPlaceholder")}
        />
        <select
          value={draft.priority}
          onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskPriority })}
        >
          <option value="urgent">{t("task.priority.urgent")}</option>
          <option value="normal">{t("task.priority.normal")}</option>
          <option value="low">{t("task.priority.low")}</option>
        </select>
        <select
          value={draft.category}
          onChange={(event) => setDraft({ ...draft, category: event.target.value as TaskCategory })}
        >
          <option value="lab">{t("task.category.lab")}</option>
          <option value="imaging">{t("task.category.imaging")}</option>
          <option value="consult">{t("task.category.consult")}</option>
          <option value="discharge">{t("task.category.discharge")}</option>
          <option value="family">{t("task.category.family")}</option>
          <option value="order">{t("task.category.order")}</option>
          <option value="other">{t("task.category.other")}</option>
        </select>
        <input
          type="date"
          value={draft.dueDate}
          onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
        />
        <button type="button" onClick={addTask}>
          {t("action.add")}
        </button>
      </div>

      <div className="task-list">
        {visibleTasks.length === 0 && (
          <p className="muted">{tasks.length === 0 ? t("task.empty") : t("task.completedHidden")}</p>
        )}
        {visibleTasks.map((task) => (
          <div className="task-row" key={task.id}>
            <input type="checkbox" checked={task.done} onChange={() => toggleDone(task)} />
            <input
              className={`${task.done ? "task-done" : ""} ${task.text.trim().startsWith("!") ? "important-input" : ""}`}
              value={task.text}
              onChange={(event) => updateTask(task.id, { ...task, text: event.target.value })}
              onBlur={commitOnBlur}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={handleCompositionEnd}
            />
            <span className={`badge ${task.priority}`}>{priorityLabel(task.priority)}</span>
            <span className="badge">{categoryLabel(task.category)}</span>
            <span className="muted">{task.dueDate || t("task.noDueDate")}</span>
            <button type="button" className="secondary" onClick={() => deleteTask(task)}>
              {t("action.delete")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default TaskList;
