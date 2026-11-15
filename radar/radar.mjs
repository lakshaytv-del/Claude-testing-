// RBI Circular Radar: pipeline logic (no network, no LLM).
// Parse the Notifications RSS, dedupe by RBI Id, check for Id gaps,
// and score items with the rule-based rubric from the build spec.

// ---------- Parsing ----------

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018',
  rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', bull: '\u2022',
  rsquor: '\u2019', laquo: '\u00ab', raquo: '\u00bb', middot: '\u00b7', deg: '\u00b0', rupee: '\u20b9',
};

// One pass, so "&amp;rsquo;" becomes "&rsquo;" (literal text), not a quote.
export const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });

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

const MONTH_RE = '(January|February|March|April|May|June|July|August|September|October|November|December)';
const DATE_LINE_RE = new RegExp(`^${MONTH_RE} \\d{1,2}, \\d{4}$`);
const SALUTATION_RE = /^(Madam|Dear Sir|Sir\/Madam)/i;

/**
 * The addressee is the block of lines between the circular's date line and the
 * salutation ("Madam / Dear Sir"). It can span several lines and often starts
 * "The Chairpersons/ CEOs of …". Amendment directions and FEMA notifications
 * have no salutation, so they have no addressee.
 */
export function findAddressee(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 25);
  const d = lines.findIndex((l) => DATE_LINE_RE.test(l));
  if (d < 0) return null;
  const block = [];
  for (const l of lines.slice(d + 1, d + 10)) {
    if (SALUTATION_RE.test(l)) return block.length ? block.join(' ').replace(/\s+/g, ' ') : null;
    block.push(l);
  }
  return null;
}

/** Date printed on the circular itself (can differ from the feed pubDate). */
export function circularDate(text) {
  const m = text.slice(0, 1500).match(new RegExp(`${MONTH_RE} (\\d{1,2}), (\\d{4})`));
  if (!m) return null;
  const mon = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(m[1]) + 1;
  return `${m[3]}-${String(mon).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// RBI ref sits in the header: "RBI/2026-27/303" or "RBI/DPSS/2026-27/476".
// Only the first 300 chars are searched, so refs of older circulars cited in the body are ignored.
const REF_RE = /RBI\/(?:[A-Z]+\/)?\d{4}-\d{2}\/\d+/;

export function extractMeta(text) {
  const head = text.slice(0, 300);
  const ref = head.match(REF_RE)?.[0] ?? null;
  const dept =
    head.match(/^(?:CO\.)?(DoR|DOR|DPSS|FIDD|DCM|FMRD|DoS|FED|DOS)[.\w]*/m)?.[1]?.replace(/^DOR$/, 'DoR') ??
    (/A\.P\. \(DIR Series\)/.test(head) ? 'A.P. (DIR Series)' : /Notification No\. FEMA/.test(head) ? 'FEMA' : null);
  return { ref, dept, addressee: findAddressee(text), circularDate: circularDate(text) };
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

/**
 * Backfill guard. Titles repeat (UAPA updates reuse the same title word for word),
 * so a title match alone cannot confirm the page is the circular the listing row
 * points to. Require the title AND the PDF link to match the listing row.
 */
export function backfillMatches(listingRow, fetched) {
  if (!listingRow?.title || normTitle(listingRow.title) !== normTitle(fetched?.title)) return false;
  if (!listingRow.pdf || !fetched.pdf) return false;
  return listingRow.pdf.toLowerCase() === fetched.pdf.toLowerCase();
}

export const backfillTitleMatches = (a, b) => normTitle(a) !== '' && normTitle(a) === normTitle(b);

const PDF_RE = /https?:\/\/rbidocs\.rbi\.org\.in\/rdocs\/notification\/PDFs\/[A-Za-z0-9]+\.PDF/i;

/** Rows of the Notifications listing page: { rbiId, title, date, pdf }. */
export function parseListing(html) {
  const rows = [];
  let date = null;
  const re = /<td class="tableheader"[^>]*><b>([A-Z][a-z]{2} \d{2}, \d{4})<\/b>|<a class='link2' href=NotificationUser\.aspx\?Id=(\d+)[^>]*>([^<]+)<\/a>([\s\S]*?)<\/tr>/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) { date = m[1]; continue; }
    rows.push({ rbiId: Number(m[2]), title: decodeEntities(m[3]).trim(), date, pdf: m[4].match(PDF_RE)?.[0] ?? null });
  }
  return rows;
}

/** A single notification page (NotificationUser.aspx?Id=…): title, PDF, body text and its meta. */
export function parseNotificationPage(html) {
  const t = html.match(/<td[^>]*class="tableheader"[^>]*>(?:<[^>]+>)*([^<]{10,400})/g) || [];
  const titles = t.map((x) => decodeEntities(x.replace(/<[^>]+>/g, '')).trim()).filter((x) => !/^Date\s*:/.test(x) && !/^[A-Z][a-z]{2} \d{2}, \d{4}$/.test(x));
  const title = titles[0] ?? null;
  const start = title ? html.indexOf('class="tableheader"') : 0;
  const bodyText = htmlToText(html.slice(start)).split('\n').slice(1).join('\n');
  return { title, pdf: html.match(PDF_RE)?.[0] ?? null, bodyText, ...extractMeta(bodyText) };
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

/** The Applicability paragraph, not its entry in a table of contents. */
function applicabilityPara(text) {
  const m = text.match(/Applicability\s*[.:\-]?\s*(These|This|The provisions)[^\n]{0,40}(applicable|apply)[\s\S]{0,800}/i);
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
