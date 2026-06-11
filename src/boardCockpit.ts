import type { Patient } from "./types";
import { hasUpcomingDischarge, todayKey } from "./utils";

function dateIsTodayOrTomorrow(date: string) {
  if (!date) return false;
  const today = todayKey();
  const tomorrowDate = new Date(`${today}T00:00:00`);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  return date === today || date === tomorrow;
}

function hasExplicitNearDischargeText(value: string) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;

  const englishNearDischarge =
    /\b(?:dc|discharge)\b[^.;\n]*(?:today|tomorrow|tmr|soon|ready|planned|expected|prepare|prep)\b/i.test(text) ||
    /\b(?:today|tomorrow|tmr|soon)\b[^.;\n]*(?:dc|discharge)\b/i.test(text);
  const chineseDischarge = /(?:\u51fa\u9662|\u8f49\u9662|\u8f6c\u9662|\u8fd4\u5bb6|\u56de\u5bb6)/.test(text);
  const chineseNear = /(?:\u4eca\u5929|\u4eca\u65e5|\u660e\u5929|\u660e\u65e5|\u8fd1\u671f|\u6e96\u5099|\u51c6\u5907|\u9810\u8a08|\u9884\u8ba1|\u8a08\u756b|\u8ba1\u5212|\u5b89\u6392)/.test(text);
  return englishNearDischarge || (chineseDischarge && chineseNear);
}

function hasDischargeTaskWording(value: string) {
  return (
    /\b(?:dc|discharge|opd|certificate|meds)\b/i.test(value) ||
    /(?:\u51fa\u9662|\u8f49\u9662|\u8f6c\u9662|\u5e36\u85e5|\u5e26\u836f|\u9580\u8a3a|\u95e8\u8bca|\u8a3a\u65b7\u66f8|\u8bca\u65ad\u4e66)/.test(value)
  );
}

export function isBoardNewAdmission(patient: Patient) {
  return patient.status === "active" && patient.isNewAdmission;
}

export function boardDischargeTasks(patient: Patient) {
  return patient.tasks.filter((task) => {
    if (task.done) return false;
    const text = `${task.category} ${task.text}`;
    const isDischargeTask = task.category === "discharge" || hasDischargeTaskWording(text);
    if (!isDischargeTask) return false;
    return task.priority === "urgent" || dateIsTodayOrTomorrow(task.dueDate) || hasExplicitNearDischargeText(task.text);
  });
}

export function hasBoardDischargeSoonSignal(patient: Patient) {
  if (patient.status !== "active") return false;
  if (hasUpcomingDischarge(patient)) return true;
  if (patient.dischargeTargetDate && dateIsTodayOrTomorrow(patient.dischargeTargetDate)) return true;
  if (boardDischargeTasks(patient).length > 0) return true;
  return hasExplicitNearDischargeText([patient.dischargePlan, patient.dischargeBarriers].join(" "));
}
