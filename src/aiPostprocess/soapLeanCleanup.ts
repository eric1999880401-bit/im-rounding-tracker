// Lean-SOAP cleanups learned from the user's manual corrections: the model
// tends to (a) end lines with decision-deferral filler, and (b) write a second
// A/P bullet that restates a lab value already covered by a concrete bullet in
// the same problem, adding only vague follow-up words.
// Applied to AI-generated SOAP text only — never to user-saved text.
// Keep in sync with the copies in functions/src/sanitize.ts.

const deferralTails = /(?:[,;]\s*)?\b(?:as ordered|per (?:the )?team(?:'s)? decision|per team|as clinically indicated|accordingly)\s*(?=[.;,)]|$)/gi;

export function stripDeferralTails(line: string) {
  const cleaned = line.replace(deferralTails, "");
  if (cleaned === line) return line;
  return cleaned
    .replace(/\s+([.;,)])/g, "$1")
    .replace(/[;,]\s*([.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/[;,\s]+$/g, (tail) => (tail.includes(".") ? "." : ""))
    .trimEnd();
}

const labValuePattern = /\b(hb|hgb|wbc|plt|cr|bun|na|k|mg|ca|p|hs?crp|crp|lactate|inr|pt|aptt|t-?bil|bili|ast|alt|alb|glu(?:cose)?|hba1c|uo|tnt|trop(?:onin)?)\b[^0-9<>a-z]{0,10}([<>]?\d+(?:\.\d+)?)((?:\s*(?:->|→|to)\s*[<>]?\d+(?:\.\d+)?)*)/gi;

// Words a restated-lab bullet may contain besides the lab mention itself and
// still be considered "vague follow-up only". Any word outside this list keeps
// the bullet (fail-safe: when unsure, keep).
const vagueRemainderWords = new Set([
  "f/u", "fu", "follow", "followup", "follow-up", "trend", "trends", "trending", "monitor", "monitoring",
  "check", "recheck", "assess", "reassess", "watch", "track", "evaluate", "adjust", "avoid",
  "and", "or", "w", "w/", "with", "for", "of", "the", "a", "an", "on", "per", "if", "as", "to",
  "signs", "sign", "bleeding", "bleed", "transfusion", "threshold", "thresholds",
  "renal", "kidney", "uo", "urine", "output", "nephrotoxins", "nephrotoxic", "meds", "drugs",
  "team", "decision", "closely", "daily", "next", "draw", "labs", "lab", "values", "level", "levels",
  "clinical", "clinically", "status", "worsens", "worsening", "worsen", "improvement", "response",
  "symptomatic", "symptoms", "curve", "fever",
]);

function labPairs(line: string) {
  const pairs = new Set<string>();
  for (const match of line.matchAll(labValuePattern)) {
    const lab = match[1].toLowerCase().replace("hgb", "hb");
    pairs.add(`${lab}:${match[2].replace(/^[<>]/, "")}`);
    // Trend values ("Hb 7.6 -> 7.3") belong to the same lab.
    for (const trendValue of (match[3] ?? "").matchAll(/[<>]?(\d+(?:\.\d+)?)/g)) {
      pairs.add(`${lab}:${trendValue[1]}`);
    }
  }
  return pairs;
}

function isVagueRestatement(line: string) {
  const remainder = line
    .replace(labValuePattern, " ")
    .replace(/^[\s!*-]+/, "")
    .replace(/\bg\/dl|mg\/dl|meq\/l|mmol\/l|ml\/day|\/min|%\b/gi, " ")
    .replace(/->|→/g, " ");
  const words = remainder
    .toLowerCase()
    .replace(/\b([fwu])\/([usp])\b/g, "$1$2") // keep f/u, w/, u/o style shorthand as one word
    .split(/[\s,;./()]+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  if (words.some((word) => /\d/.test(word))) return false;
  return words.every((word) => vagueRemainderWords.has(word));
}

// Within each A/P "# problem" block, drop bullets whose lab values all appear
// in another kept bullet of the same block and whose remaining words are only
// vague follow-up vocabulary. The concrete bullet (trend, context, plan) wins.
export function dropRestatedLabBullets(soapText: string) {
  const lines = soapText.split("\n");
  const drop = new Set<number>();
  let inAp = false;
  let blockStart = -1;

  const processBlock = (start: number, end: number) => {
    const bulletIndexes: number[] = [];
    for (let i = start; i < end; i += 1) {
      if (/^\s*[-!]/.test(lines[i])) bulletIndexes.push(i);
    }
    if (bulletIndexes.length < 2) return;
    for (const index of bulletIndexes) {
      const pairs = labPairs(lines[index]);
      if (pairs.size === 0 || !isVagueRestatement(lines[index])) continue;
      const covered = bulletIndexes.some(
        (other) =>
          other !== index &&
          !drop.has(other) &&
          [...pairs].every((pair) => labPairs(lines[other]).has(pair)),
      );
      if (covered) drop.add(index);
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^A\/?P\s*:/i.test(trimmed)) {
      inAp = true;
      blockStart = -1;
      return;
    }
    if (inAp && /^(?:S|O|Tasks?|DC|Orders?|藥囑)\s*:/i.test(trimmed)) {
      if (blockStart >= 0) processBlock(blockStart, index);
      inAp = false;
      blockStart = -1;
      return;
    }
    if (!inAp) return;
    if (trimmed.startsWith("#")) {
      if (blockStart >= 0) processBlock(blockStart, index);
      blockStart = index + 1;
    }
  });
  if (inAp && blockStart >= 0) processBlock(blockStart, lines.length);

  if (drop.size === 0) return soapText;
  return lines.filter((_, index) => !drop.has(index)).join("\n");
}

// Collapses duplicated discharge-pending lines in the DC: section — the model
// restates "meds/OPD/cert pending" in several phrasings; keep one line,
// preferring the checklist form with boxes. Mirror of the server copy.
export function collapseDischargePendingLines(soapText: string) {
  const lines = soapText.split("\n");
  let inDc = false;
  let keptPendingIndex = -1;
  const dropIndexes = new Set<number>();
  lines.forEach((line, index) => {
    if (/^DC\s*:/i.test(line.trim())) {
      inDc = true;
      return;
    }
    if (inDc && /^[A-Za-z/藥囑]+\s*:/.test(line.trim()) && !line.trim().startsWith("-") && !line.trim().startsWith("!")) {
      inDc = false;
    }
    if (!inDc) return;
    const clean = line.toLowerCase();
    const tokens = ["med", "opd", "cert"].filter((token) => clean.includes(token));
    if (tokens.length < 2) return;
    if (keptPendingIndex === -1) {
      keptPendingIndex = index;
      return;
    }
    const keptHasBoxes = lines[keptPendingIndex].includes("□");
    const currentHasBoxes = line.includes("□");
    if (currentHasBoxes && !keptHasBoxes) {
      dropIndexes.add(keptPendingIndex);
      keptPendingIndex = index;
    } else {
      dropIndexes.add(index);
    }
  });
  if (dropIndexes.size === 0) return soapText;
  return lines.filter((_, index) => !dropIndexes.has(index)).join("\n");
}

export function leanSoapCleanup(soapText: string) {
  const deduped = collapseDischargePendingLines(dropRestatedLabBullets(soapText));
  return deduped
    .split("\n")
    .map((line) => stripDeferralTails(line))
    .join("\n");
}
