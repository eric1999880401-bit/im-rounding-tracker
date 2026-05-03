export type PatientStatus = "active" | "discharged" | "archived";

export type PatientSex = "M" | "F" | "Other";

export type TaskPriority = "urgent" | "normal" | "low";

export type TaskCategory =
  | "lab"
  | "imaging"
  | "consult"
  | "discharge"
  | "family"
  | "order"
  | "other";

export type PrintDensity = "normal" | "compact" | "ultra-compact";

export type SortMode = "bed" | "dischargeDate" | "urgentFirst";

export interface PatientTask {
  id: string;
  text: string;
  done: boolean;
  priority: TaskPriority;
  category: TaskCategory;
  dueDate: string;
  createdAt: string;
  completedAt: string;
}

export interface Patient {
  id: string;
  bed: string;
  patientCode: string;
  age: number;
  sex: PatientSex;
  underlyingDiseases: string;
  attending: string;
  teamOrService: string;
  admissionDate: string;
  primaryDiagnosis: string;
  activeProblems: string;
  overnightEvent: string;
  subjectiveOrChiefConcern: string;
  newLabs: string;
  newImaging: string;
  assessment: string;
  plan: string;
  dischargePlan: string;
  dischargeTargetDate: string;
  dischargeBarriers: string;
  specialAttention: string;
  vsOrder: string;
  status: PatientStatus;
  tasks: PatientTask[];
  updatedAt: string;
  createdAt: string;
}
