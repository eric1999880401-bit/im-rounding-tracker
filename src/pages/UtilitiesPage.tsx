import { useState } from "react";
import type { MiscTask, PhonebookContact, StudyTopic, TaskPriority } from "../types";
import { createId, nowIso } from "../utils";
import { useT } from "../i18n";

interface UtilitiesPageProps {
  phonebook: PhonebookContact[];
  miscTasks: MiscTask[];
  studyTopics: StudyTopic[];
  onSaveContact: (contact: PhonebookContact) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onSaveMiscTask: (task: MiscTask) => Promise<void>;
  onDeleteMiscTask: (id: string) => Promise<void>;
  onSaveStudyTopic: (topic: StudyTopic) => Promise<void>;
  onDeleteStudyTopic: (id: string) => Promise<void>;
}

function UtilitiesPage({
  phonebook,
  miscTasks,
  studyTopics,
  onSaveContact,
  onDeleteContact,
  onSaveMiscTask,
  onDeleteMiscTask,
  onSaveStudyTopic,
  onDeleteStudyTopic,
}: UtilitiesPageProps) {
  const t = useT();
  const [contactDraft, setContactDraft] = useState<PhonebookContact>({
    id: createId("contact"),
    name: "",
    roleOrUnit: "",
    phone: "",
    note: "",
    isImportant: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  const [taskDraft, setTaskDraft] = useState<MiscTask>({
    id: createId("misc"),
    text: "",
    done: false,
    priority: "normal",
    dueDate: "",
    note: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  const [topicDraft, setTopicDraft] = useState<StudyTopic>({
    id: createId("topic"),
    topic: "",
    note: "",
    done: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  async function addContact() {
    if (!contactDraft.name.trim() && !contactDraft.phone.trim()) return;
    await onSaveContact({ ...contactDraft, updatedAt: nowIso() });
    setContactDraft({ ...contactDraft, id: createId("contact"), name: "", roleOrUnit: "", phone: "", note: "", isImportant: false });
  }

  async function addTask() {
    if (!taskDraft.text.trim()) return;
    await onSaveMiscTask({ ...taskDraft, updatedAt: nowIso() });
    setTaskDraft({ ...taskDraft, id: createId("misc"), text: "", note: "", dueDate: "", done: false });
  }

  async function addTopic() {
    if (!topicDraft.topic.trim()) return;
    await onSaveStudyTopic({ ...topicDraft, updatedAt: nowIso() });
    setTopicDraft({ ...topicDraft, id: createId("topic"), topic: "", note: "", done: false });
  }

  async function editContact(contact: PhonebookContact) {
    const name = window.prompt("Name", contact.name);
    if (name === null) return;
    const roleOrUnit = window.prompt("Role / Unit", contact.roleOrUnit);
    if (roleOrUnit === null) return;
    const phone = window.prompt("Phone", contact.phone);
    if (phone === null) return;
    const note = window.prompt("Note", contact.note);
    if (note === null) return;
    await onSaveContact({ ...contact, name, roleOrUnit, phone, note, updatedAt: nowIso() });
  }

  async function editMiscTask(task: MiscTask) {
    const text = window.prompt("Task", task.text);
    if (text === null) return;
    const note = window.prompt("Note", task.note);
    if (note === null) return;
    await onSaveMiscTask({ ...task, text, note, updatedAt: nowIso() });
  }

  async function editStudyTopic(topic: StudyTopic) {
    const nextTopic = window.prompt("Topic", topic.topic);
    if (nextTopic === null) return;
    const note = window.prompt("Note", topic.note);
    if (note === null) return;
    await onSaveStudyTopic({ ...topic, topic: nextTopic, note, updatedAt: nowIso() });
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>{t("nav.utilities")}</h2>
      </header>
      <section className="panel utility-section">
        <h3>{t("utilities.phonebook")}</h3>
        <div className="utility-input-row">
          <input placeholder={t("utilities.name")} value={contactDraft.name} onChange={(event) => setContactDraft({ ...contactDraft, name: event.target.value })} />
          <input placeholder={t("utilities.role")} value={contactDraft.roleOrUnit} onChange={(event) => setContactDraft({ ...contactDraft, roleOrUnit: event.target.value })} />
          <input placeholder={t("utilities.phone")} value={contactDraft.phone} onChange={(event) => setContactDraft({ ...contactDraft, phone: event.target.value })} />
          <input placeholder={t("utilities.note")} value={contactDraft.note} onChange={(event) => setContactDraft({ ...contactDraft, note: event.target.value })} />
          <label className="checkbox-label"><input type="checkbox" checked={contactDraft.isImportant} onChange={(event) => setContactDraft({ ...contactDraft, isImportant: event.target.checked })} />Important</label>
          <button type="button" onClick={addContact}>{t("utilities.addContact")}</button>
        </div>
        {phonebook.map((contact) => (
          <div className="utility-row" key={contact.id}>
            <strong>{contact.name || "-"}</strong>
            <span>{contact.roleOrUnit}</span>
            <span>{contact.phone}</span>
            <span>{contact.note}</span>
            {contact.isImportant && <span className="badge urgent">Important</span>}
            <button type="button" className="secondary" onClick={() => editContact(contact)}>{t("action.edit")}</button>
            <button type="button" className="secondary" onClick={() => onDeleteContact(contact.id)}>{t("action.delete")}</button>
          </div>
        ))}
      </section>

      <section className="panel utility-section">
        <h3>{t("utilities.miscTasks")}</h3>
        <div className="utility-input-row">
          <input placeholder="Task" value={taskDraft.text} onChange={(event) => setTaskDraft({ ...taskDraft, text: event.target.value })} />
          <select value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value as TaskPriority })}>
            <option value="urgent">Urgent</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <input type="date" value={taskDraft.dueDate} onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })} />
          <input placeholder="Note" value={taskDraft.note} onChange={(event) => setTaskDraft({ ...taskDraft, note: event.target.value })} />
          <button type="button" onClick={addTask}>{t("utilities.addMiscTask")}</button>
        </div>
        {miscTasks.map((task) => (
          <div className="utility-row" key={task.id}>
            <input type="checkbox" checked={task.done} onChange={() => onSaveMiscTask({ ...task, done: !task.done, updatedAt: nowIso() })} />
            <span className={task.done ? "task-done" : ""}>{task.text}</span>
            <span className={`badge ${task.priority}`}>{task.priority}</span>
            <span>{task.dueDate}</span>
            <span>{task.note}</span>
            <button type="button" className="secondary" onClick={() => editMiscTask(task)}>{t("action.edit")}</button>
            <button type="button" className="secondary" onClick={() => onDeleteMiscTask(task.id)}>{t("action.delete")}</button>
          </div>
        ))}
      </section>

      <section className="panel utility-section">
        <h3>{t("utilities.studyTopics")}</h3>
        <div className="utility-input-row">
          <input placeholder="Topic" value={topicDraft.topic} onChange={(event) => setTopicDraft({ ...topicDraft, topic: event.target.value })} />
          <input placeholder="Note" value={topicDraft.note} onChange={(event) => setTopicDraft({ ...topicDraft, note: event.target.value })} />
          <button type="button" onClick={addTopic}>{t("utilities.addStudyTopic")}</button>
        </div>
        {studyTopics.map((topic) => (
          <div className="utility-row" key={topic.id}>
            <input type="checkbox" checked={topic.done} onChange={() => onSaveStudyTopic({ ...topic, done: !topic.done, updatedAt: nowIso() })} />
            <span className={topic.done ? "task-done" : ""}>{topic.topic}</span>
            <span>{topic.note}</span>
            <button type="button" className="secondary" onClick={() => editStudyTopic(topic)}>{t("action.edit")}</button>
            <button type="button" className="secondary" onClick={() => onDeleteStudyTopic(topic.id)}>{t("action.delete")}</button>
          </div>
        ))}
      </section>
    </div>
  );
}

export default UtilitiesPage;
