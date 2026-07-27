function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsIdentityToken(source: string, identity: string) {
  const value = String(identity ?? "").trim();
  if (!value) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapedRegExp(value)}(?=$|[^a-z0-9])`, "i").test(source);
}

const BED_HEADER_SOURCE = String.raw`(?:(?:bed|room|rm)|床(?:號|号)?)\s*[：:#-]?\s*(?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{1,}\b`;

/**
 * Split a pasted ward list only when another bed/room header begins. Blank
 * paragraphs inside one patient's V/S, labs, or course remain attached to that
 * patient so an audit payload is the complete reviewed source block.
 */
export function splitBulkPatientSourceBlocks(rawText: string) {
  const normalized = String(rawText ?? "")
    .replace(/\r\n?/g, "\n")
    // Ward lists are often pasted on one physical line. Introduce a line
    // boundary before a numeric bed header without splitting ordinary blank
    // paragraphs or phrases such as "bed rest".
    .replace(new RegExp(`[ \\t]+(?=${BED_HEADER_SOURCE})`, "gi"), "\n");
  const headerPattern = new RegExp(`^\\s*${BED_HEADER_SOURCE}`, "i");
  const blocks: string[] = [];
  let current: string[] = [];
  let sawHeader = false;

  normalized.split("\n").forEach((line) => {
    const beginsPatient = headerPattern.test(line);
    if (beginsPatient && sawHeader) {
      const block = current.join("\n").trim();
      if (block.length > 20) blocks.push(block);
      current = [];
    }
    if (beginsPatient) sawHeader = true;
    current.push(line);
  });

  const finalBlock = current.join("\n").trim();
  if (finalBlock.length > 20) blocks.push(finalBlock);
  return blocks.slice(0, 12);
}

/** Never use a model-controlled id as a React/map/audit correlation key. */
export function assignUniqueBulkReviewIds<T extends { id: string }>(drafts: readonly T[]): T[] {
  return drafts.map((draft, index) => ({ ...draft, id: `bulk-review-${index + 1}` }));
}

/**
 * Binds an audit source using source-owned identity, never a model-provided
 * index/excerpt. Requiring every supplied identity prevents a bed-only chunk
 * from being accepted when the model invented a conflicting patient code.
 */
export function uniquelyBoundBulkSourceChunk(
  chunks: readonly string[],
  identity: { bed: string; patientCode: string },
  reviewedIdentities: readonly { bed: string; patientCode: string }[] = [identity],
) {
  const identities = [identity.bed, identity.patientCode].map((value) => value.trim()).filter(Boolean);
  if (identities.length === 0) return "";
  const matches = chunks.filter((chunk) => identities.every((value) => containsIdentityToken(chunk, value)));
  if (matches.length !== 1) return "";
  const matchedSource = matches[0];
  const containsAnotherReviewedPatient = reviewedIdentities.some((other) => {
    if (other === identity) return false;
    const otherTokens = [other.bed, other.patientCode].map((value) => value.trim()).filter(Boolean);
    return otherTokens.some((value) => containsIdentityToken(matchedSource, value));
  });
  return containsAnotherReviewedPatient ? "" : matchedSource.trim();
}
