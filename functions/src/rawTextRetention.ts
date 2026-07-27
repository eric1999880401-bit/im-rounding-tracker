export const AI_DRAFT_RAW_TEXT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface AiDraftRawTextRetentionFields {
  rawText?: string;
  rawTextExpiresAt?: Date;
}

export function buildAiDraftRawTextRetention(
  rawText: string,
  storeRawText: boolean,
  nowMillis = Date.now(),
): AiDraftRawTextRetentionFields {
  if (!storeRawText) return {};

  return {
    rawText,
    rawTextExpiresAt: new Date(nowMillis + AI_DRAFT_RAW_TEXT_RETENTION_DAYS * DAY_MS),
  };
}
