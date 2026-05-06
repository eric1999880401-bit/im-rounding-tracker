import { useState } from "react";
import type { PatientTask, TaskCategory, TaskPriority } from "../types";
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
  const [draft, setDraft] = useState<PatientTask>(emptyTask());
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const visibleTasks = showCompletedTasks ? tasks : tasks.filter((task) => !task.done);

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
    if (!window.confirm(`Delete task: ${task.text}?`)) return;
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
        <h2>Tasks</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showCompletedTasks}
            onChange={(event) => setShowCompletedTasks(event.target.checked)}
          />
          {showCompletedTasks ? "Show completed tasks" : "Hide completed tasks"}
        </label>
      </div>

      <div className="task-input-row">
        <input
          value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder="Add patient-specific task"
        />
        <select
          value={draft.priority}
          onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskPriority })}
        >
          <option value="urgent">Urgent</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <select
          value={draft.category}
          onChange={(event) => setDraft({ ...draft, category: event.target.value as TaskCategory })}
        >
          <option value="lab">Lab</option>
          <option value="imaging">Imaging</option>
          <option value="consult">Consult</option>
          <option value="discharge">Discharge</option>
          <option value="family">Family</option>
          <option value="order">Order</option>
          <option value="other">Other</option>
        </select>
        <input
          type="date"
          value={draft.dueDate}
          onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
        />
        <button type="button" onClick={addTask}>
          Add
        </button>
      </div>

      <div className="task-list">
        {visibleTasks.length === 0 && <p className="muted">{tasks.length === 0 ? "No tasks yet." : "Completed tasks are hidden."}</p>}
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
            <span className={`badge ${task.priority}`}>{task.priority}</span>
            <span className="badge">{task.category}</span>
            <span className="muted">{task.dueDate || "No due date"}</span>
            <button type="button" className="secondary" onClick={() => deleteTask(task)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default TaskList;
