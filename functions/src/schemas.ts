// OpenAI structured-output JSON schemas. Extracted from index.ts (Phase 3 refactor).

export const stringSchema = { type: "string" } as const;
export const booleanSchema = { type: "boolean" } as const;

export const clinicalReasoningSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "currentClinicalState",
    "primaryRisk",
    "whyThisMatters",
    "activeProblemsRanked",
    "resolvedOrLessImportant",
    "missingDataNeeded",
    "noiseToIgnore",
  ],
  properties: {
    currentClinicalState: stringSchema,
    primaryRisk: stringSchema,
    whyThisMatters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fact", "source", "implication"],
        properties: {
          fact: stringSchema,
          source: stringSchema,
          implication: stringSchema,
        },
      },
    },
    activeProblemsRanked: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["problem", "status", "whyImportant", "evidence", "todayPlan", "callThresholds"],
        properties: {
          problem: stringSchema,
          status: { type: "string", enum: ["active", "improving", "resolved", "uncertain"] },
          whyImportant: stringSchema,
          evidence: { type: "array", items: stringSchema },
          todayPlan: { type: "array", items: stringSchema },
          callThresholds: { type: "array", items: stringSchema },
        },
      },
    },
    resolvedOrLessImportant: { type: "array", items: stringSchema },
    missingDataNeeded: { type: "array", items: stringSchema },
    noiseToIgnore: { type: "array", items: stringSchema },
  },
} as const;

export const aiSoapDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "oneLiner",
    "admissionSummary",
    "isbarHandoff",
    "clinicalReasoning",
    "subjective",
    "objective",
    "assessmentPlan",
    "redFlags",
    "tasks",
    "dischargeIssues",
    "thinkingPrompts",
    "uncertainty",
  ],
  properties: {
    oneLiner: stringSchema,
    admissionSummary: stringSchema,
    isbarHandoff: stringSchema,
    clinicalReasoning: clinicalReasoningSchema,
    subjective: {
      type: "object",
      additionalProperties: false,
      required: ["chiefConcern", "symptoms", "overnightEvents", "importantSymptoms", "importantOvernightEvents"],
      properties: {
        chiefConcern: stringSchema,
        symptoms: { type: "array", items: stringSchema },
        overnightEvents: { type: "array", items: stringSchema },
        importantSymptoms: { type: "array", items: stringSchema },
        importantOvernightEvents: { type: "array", items: stringSchema },
      },
    },
    objective: {
      type: "object",
      additionalProperties: false,
      required: ["vitals", "bloodSugars", "physicalExam", "labs", "images"],
      properties: {
        vitals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "name", "value", "interpretation", "isAbnormal", "isImportant"],
            properties: {
              date: stringSchema,
              name: stringSchema,
              value: stringSchema,
              interpretation: stringSchema,
              isAbnormal: booleanSchema,
              isImportant: booleanSchema,
            },
          },
        },
        bloodSugars: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "name", "value", "interpretation", "isAbnormal", "isImportant"],
            properties: {
              date: stringSchema,
              name: stringSchema,
              value: stringSchema,
              interpretation: stringSchema,
              isAbnormal: booleanSchema,
              isImportant: booleanSchema,
            },
          },
        },
        physicalExam: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["system", "finding", "isImportant"],
            properties: {
              system: stringSchema,
              finding: stringSchema,
              isImportant: booleanSchema,
            },
          },
        },
        labs: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "date",
              "group",
              "name",
              "value",
              "unit",
              "previousValue",
              "isAbnormal",
              "isImportant",
              "interpretation",
            ],
            properties: {
              date: stringSchema,
              group: stringSchema,
              name: stringSchema,
              value: stringSchema,
              unit: stringSchema,
              previousValue: stringSchema,
              isAbnormal: booleanSchema,
              isImportant: booleanSchema,
              interpretation: stringSchema,
            },
          },
        },
        images: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "studyType", "finding", "impression", "isImportant"],
            properties: {
              date: stringSchema,
              studyType: stringSchema,
              finding: stringSchema,
              impression: stringSchema,
              isImportant: booleanSchema,
            },
          },
        },
      },
    },
    assessmentPlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["problemTitle", "assessmentSummary", "evidenceOrCourseItems", "planItems", "isImportant"],
        properties: {
          problemTitle: stringSchema,
          assessmentSummary: stringSchema,
          evidenceOrCourseItems: { type: "array", items: stringSchema },
          planItems: { type: "array", items: stringSchema },
          isImportant: booleanSchema,
        },
      },
    },
    redFlags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "reason"],
        properties: {
          text: stringSchema,
          reason: stringSchema,
        },
      },
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "priority", "dueDate", "category"],
        properties: {
          text: stringSchema,
          priority: { type: "string", enum: ["urgent", "normal", "low"] },
          dueDate: stringSchema,
          category: stringSchema,
        },
      },
    },
    dischargeIssues: { type: "array", items: stringSchema },
    thinkingPrompts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "reason"],
        properties: {
          prompt: stringSchema,
          reason: stringSchema,
        },
      },
    },
    uncertainty: { type: "array", items: stringSchema },
  },
} as const;

export const aiDocumentDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["documentType", "title", "conciseSummary", "clinicalReasoning", "sections", "followUpItems", "uncertainty"],
  properties: {
    documentType: {
      type: "string",
      enum: ["admissionNote", "admissionSummary", "dischargeHospitalCourse", "weeklySummary", "isbar"],
    },
    title: stringSchema,
    conciseSummary: stringSchema,
    clinicalReasoning: clinicalReasoningSchema,
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "content"],
        properties: {
          heading: stringSchema,
          content: stringSchema,
        },
      },
    },
    followUpItems: { type: "array", items: stringSchema },
    uncertainty: { type: "array", items: stringSchema },
  },
} as const;

export const roundSoapDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headerLines", "subjectiveLines", "objective", "assessmentPlan", "orders", "tasks", "discharge", "warnings", "highlightHints"],
  properties: {
    headerLines: { type: "array", items: stringSchema },
    subjectiveLines: { type: "array", items: stringSchema },
    objective: {
      type: "object",
      additionalProperties: false,
      required: ["vitalSigns", "physicalExam", "labs", "microbiology", "imaging", "pathology", "other"],
      properties: {
        vitalSigns: { type: "array", items: stringSchema },
        physicalExam: { type: "array", items: stringSchema },
        labs: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["panel", "values", "sourceIds"],
            properties: {
              panel: { type: "string", enum: ["CBC/DC", "Chem/Renal", "Liver/Coag", "Infx/Perfusion", "ABG/VBG", "Cardiac", "Other"] },
              values: stringSchema,
              sourceIds: { type: "array", items: stringSchema },
            },
          },
        },
        microbiology: { type: "array", items: stringSchema },
        imaging: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["study", "date", "finding"],
            properties: { study: stringSchema, date: stringSchema, finding: stringSchema },
          },
        },
        pathology: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "specimen", "result"],
            properties: { date: stringSchema, specimen: stringSchema, result: stringSchema },
          },
        },
        other: { type: "array", items: stringSchema },
      },
    },
    assessmentPlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["problemTitle", "status", "summary", "plan", "sourceEvidence"],
        properties: {
          problemTitle: stringSchema,
          status: { type: "string", enum: ["active", "improving", "worsening", "stable", "uncertain"] },
          summary: stringSchema,
          plan: stringSchema,
          sourceEvidence: { type: "array", items: stringSchema },
        },
      },
    },
    orders: { type: "array", items: stringSchema },
    tasks: { type: "array", items: stringSchema },
    discharge: { type: "array", items: stringSchema },
    warnings: { type: "array", items: stringSchema },
    highlightHints: { type: "array", items: stringSchema },
  },
} as const;

export const patientImportDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "status",
    "matchPatientId",
    "sourceIndex",
    "bed",
    "patientCode",
    "age",
    "sex",
    "attending",
    "teamOrService",
    "primaryDiagnosis",
    "oneLiner",
    "chiefComplaint",
    "todayUpdates",
    "vitalSigns",
    "physicalExam",
    "labText",
    "imageText",
    "admissionSummary",
    "underlyingDiseases",
    "activeProblems",
    "hospitalCourseHighlights",
    "importantRedFlags",
    "tasks",
    "antibioticsProceduresConsults",
    "dischargePlan",
    "disposition",
    "uncertainty",
    "sourceExcerpt",
  ],
  properties: {
    id: stringSchema,
    status: { type: "string", enum: ["new", "updateCandidate"] },
    matchPatientId: stringSchema,
    sourceIndex: { type: "number" },
    bed: stringSchema,
    patientCode: stringSchema,
    age: stringSchema,
    sex: { type: "string", enum: ["M", "F", "Other", ""] },
    attending: stringSchema,
    teamOrService: stringSchema,
    primaryDiagnosis: stringSchema,
    oneLiner: stringSchema,
    chiefComplaint: stringSchema,
    todayUpdates: stringSchema,
    vitalSigns: stringSchema,
    physicalExam: stringSchema,
    labText: stringSchema,
    imageText: stringSchema,
    admissionSummary: stringSchema,
    underlyingDiseases: stringSchema,
    activeProblems: stringSchema,
    hospitalCourseHighlights: stringSchema,
    importantRedFlags: stringSchema,
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "priority", "dueDate", "category"],
        properties: {
          text: stringSchema,
          priority: { type: "string", enum: ["urgent", "normal", "low"] },
          dueDate: stringSchema,
          category: { type: "string", enum: ["lab", "imaging", "consult", "discharge", "family", "order", "other"] },
        },
      },
    },
    antibioticsProceduresConsults: { type: "array", items: stringSchema },
    dischargePlan: stringSchema,
    disposition: stringSchema,
    uncertainty: { type: "array", items: stringSchema },
    sourceExcerpt: stringSchema,
  },
} as const;

export const patientBatchImportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["drafts"],
  properties: {
    drafts: {
      type: "array",
      items: patientImportDraftSchema,
    },
  },
} as const;
