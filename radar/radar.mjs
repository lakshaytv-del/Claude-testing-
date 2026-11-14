// RBI Circular Radar: pipeline logic (no network, no LLM).
// Parse the Notifications RSS, dedupe by RBI Id, check for Id gaps,
// and score items with the rule-based rubric from the build spec.

// ---------- Parsing ----------

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

function tagValue(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(raw);
}

/** Extract the RBI notification Id from a feed link. Handles &amp; and Scripts/scripts. */
export function extractRbiId(link) {
  if (!link) return null;
  const m = decodeEntities(link).match(/[?&]Id=(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** RBI pubDates carry no timezone ("Wed, 11 Nov 2026 17:00:00"): treat as IST. */
export function parsePubDateIST(s) {
  if (!s) return null;
  const m = s.match(/(\d{1,2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months.indexOf(m[2]);
  if (mon < 0) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${m[3]}-${p(mon + 1)}-${p(m[1])}T${m[4]}:${m[5]}:${m[6]}+05:30`;
}

export function htmlToText(html) {
  return decodeEntities(
    (html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();
}

// An addressee is a short line starting "All" that names an entity type,
// e.g. "All Regulated Entities", "All authorised non-bank Payment System Operators".
const ADDRESSEE_ENTITY_RE =
  /Regulated Entities|\bREs\b|NBFCs?|Non-Banking Financial|Banks?\b|Payment System (Operators|Providers)|Authorised (Persons|Dealer)|Prepaid Payment Instrument|Financial Institutions|Credit Information Compan/i;

function findAddressee(text) {
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (/^All\s/.test(l) && l.length <= 200 && ADDRESSEE_ENTITY_RE.test(l)) return l;
  }
  return null;
}

export function extractMeta(text) {
  const ref = text.match(/RBI\/\d{4}-\d{2}\/\d+/)?.[0] ?? null;
  const dept = text.match(/\b(DoR\.[A-Z]+|DPSS|FEMA|DCM|FMRD|DoS|CO\.DPSS|A\.P\. \(DIR Series\))/)?.[1] ?? null;
  return { ref, dept, addressee: findAddressee(text) };
}

/** Parse RSS XML into items. Items with no parseable Id are dropped (logged by caller). */
export function parseFeed(xml) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks
    .map((b) => {
      const link = tagValue(b, 'link');
      const bodyText = htmlToText(tagValue(b, 'description') || '');
      return {
        rbiId: extractRbiId(link),
        title: (tagValue(b, 'title') || '').trim(),
        link: link ? decodeEntities(link) : null,
        pubDate: parsePubDateIST(tagValue(b, 'pubDate')),
        bodyText,
        needsPdf: bodyText.length < 500,
        ...extractMeta(bodyText),
      };
    })
    .filter((i) => i.rbiId !== null);
}

// ---------- Dedupe, watermark, gap check ----------

/** New items are those whose Id is not stored. Never order by pubDate. */
export function selectNew(items, storedIds) {
  const seen = new Set(storedIds);
  const out = [];
  for (const i of items) {
    if (seen.has(i.rbiId)) continue;
    seen.add(i.rbiId);
    out.push(i);
  }
  return out.sort((a, b) => a.rbiId - b.rbiId);
}

/** Ids between the highest stored Id and the lowest feed Id that the feed no longer carries. */
export function findGap(feedIds, maxStoredId) {
  if (maxStoredId == null || feedIds.length === 0) return [];
  const minFeed = Math.min(...feedIds);
  const missing = [];
  for (let id = maxStoredId + 1; id < minFeed; id++) missing.push(id);
  return missing;
}

const normTitle = (t) =>
  (t || '')
    .toLowerCase()
    .replace(/[–—-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Backfill guard: store a fetched circular only if its title matches the listing row. */
export function backfillTitleMatches(listingTitle, fetchedTitle) {
  return normTitle(listingTitle) !== '' && normTitle(listingTitle) === normTitle(fetchedTitle);
}

// ---------- Rubric ----------

export const THRESHOLD = 60;

const NBFC_RE = /\bNBFCs?\b|Non-Banking Financial|All Regulated Entities|All REs\b/i;
const RAIL_RE = /\bNACH\b|\bUPI\b|CKYCR|Credit Information Compan/i;
const PSO_RE = /Payment System Operators?|Payment System Providers|PPI Issuers|Prepaid Payment Instrument Issuers/i;
const BANK_RE = /Banks?\b|Co-operative Banks|Regional Rural|\bUCBs?\b|\bRRBs?\b|Authorised Persons|FEMA|Foreign Exchange|Government Securities|Currency/i;

function classifyScope(s) {
  if (NBFC_RE.test(s)) return 1.0;
  if (PSO_RE.test(s)) return 0.3;
  if (BANK_RE.test(s)) return RAIL_RE.test(s) ? 0.6 : 0.1;
  return null;
}

/** Entity type in a new-style title: "Reserve Bank of India (Small Finance Banks – …) Directions". */
function titleEntity(title) {
  const m = title.match(/\(([^)]*)\)/);
  if (!m) return null;
  const inner = m[1];
  return classifyScope(inner) === null ? null : inner;
}

function applicabilityPara(text) {
  const m = text.match(/Applicability[\s\S]{0,800}/i);
  return m ? m[0] : null;
}

/**
 * Step 1: applicability gate. Order: addressee line, then entity type in the title,
 * then the Applicability paragraph. Returns { multiplier, source, evidence }.
 */
export function applicability(item) {
  if (item.addressee) {
    const m = classifyScope(item.addressee);
    if (m !== null) return { multiplier: m, source: 'addressee', evidence: item.addressee };
  }
  const ent = titleEntity(item.title);
  if (ent) return { multiplier: classifyScope(ent), source: 'title', evidence: ent };
  const para = applicabilityPara(item.bodyText || '');
  if (para) {
    const m = classifyScope(para);
    if (m !== null) return { multiplier: m, source: 'applicability_para', evidence: para.slice(0, 200) };
  }
  return { multiplier: 0.1, source: 'default', evidence: null };
}

// Step 2: topic weights. Matched on the title first; body only if the title gives nothing.
export const TOPICS = [
  ['digital_lending', 60, /Digital Lending|Lending Service Provider|\bLSP\b|\bDLA\b|Key Fact Statement|Default Loss Guarantee|\bFLDG\b/i],
  ['collections_recovery', 60, /Recovery Agent|recovery of (loans|dues)|Outsourcing of (Financial Services|recovery)/i],
  ['fair_practices', 55, /Fair Practices|Responsible Business Conduct|Penal Charges|Grievance|Ombudsman|Interest Rate Reset/i],
  ['kyc_aml', 50, /Know Your Customer|\bKYC\b|V-CIP|CKYC|UAPA|Sanctions List|Anti-Money Laundering/i],
  ['co_lending', 50, /Co-Lending/i],
  ['payments_mandates', 45, /\bNACH\b|e-mandate|UPI AutoPay|Recurring (Payment|Transaction)/i],
  ['credit_reporting', 40, /Credit Information|\bCICs?\b|Credit Reporting/i],
  ['nbfc_prudential', 30, /Scale Based|Prudential|Provisioning|Asset Classification|\bNPA\b|\bIRACP\b|Capital Adequacy/i],
  ['it_outsourcing_data', 30, /Information Technology|Cyber|IT Outsourcing|Data Localisation/i],
];

export function topic(item) {
  for (const src of [item.title, (item.bodyText || '').slice(0, 2000)]) {
    for (const [tag, weight, re] of TOPICS) if (re.test(src)) return { tag, weight };
  }
  return { tag: 'other', weight: 10 };
}

// Step 3: change severity, from the title.
export function severity(item) {
  const t = item.title;
  if (/UAPA|Sanctions List|Repeal|Withdrawal|Reporting Format|List of/i.test(t)) return 0.7;
  if (/Clarification|FAQ|Extension of (Time|timeline)/i.test(t)) return 1.0;
  if (/Amendment/i.test(t)) return 1.3;
  if (/Master Direction|Directions?, \d{4}/i.test(t)) return 1.6;
  return 1.0;
}

// Hard rules: title only (bodies of routine circulars cite the KYC MD), and the gate must bind NBFCs.
const HARD_RULE_RE = /recovery agent|Digital Lending|Fair Practices Code|Responsible Business Conduct|co-lending|Know Your Customer/i;

export function scoreItem(item) {
  const gate = applicability(item);
  const top = topic(item);
  const sev = severity(item);
  const score = Math.min(100, Math.round(gate.multiplier * top.weight * sev));
  const hardRule = HARD_RULE_RE.test(item.title) && gate.multiplier === 1.0;
  return { score, gate, topic: top, severity: sev, hardRule, alert: hardRule || score >= THRESHOLD };
}

/** The model's score is advisory: log a mismatch over 5 points, keep the code score. */
export function reconcileScore(modelScore, codeScore, log = () => {}) {
  const mismatch = Math.abs(modelScore - codeScore) > 5;
  if (mismatch) log({ event: 'score_mismatch', modelScore, codeScore });
  return { score: codeScore, mismatch };
}

/** Cite checker: every para value in a brief must appear in the body text. */
export function checkCites(brief, bodyText) {
  const paras = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object')
      for (const [k, v] of Object.entries(o)) (k === 'para' && typeof v === 'string' ? paras.push(v) : walk(v));
  };
  walk(brief);
  const missing = paras.filter((p) => !bodyText.includes(p));
  return { ok: missing.length === 0, missing };
}
