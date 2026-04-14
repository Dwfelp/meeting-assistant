import { generateSummaryWithLlm } from "@/lib/llm-client";
import { ActionItem, Meeting, MeetingSummary, SentimentLabel, SentimentMoment, TranscriptSegment } from "@/types/meeting";

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 将「一」至「三十一」等常见中文数字转为整数（用于月/日） */
export function chineseNumeralsToInt(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return parseInt(t, 10);

  if (t.length === 1) {
    const d = CN_DIGITS[t];
    return d !== undefined ? d : null;
  }

  if (t === "十") return 10;
  if (t.length === 2 && t[0] === "十") {
    const u = CN_DIGITS[t[1] ?? ""];
    return u !== undefined ? 10 + u : null;
  }
  if (t.length === 2 && t[1] === "十") {
    const h = CN_DIGITS[t[0] ?? ""];
    return h !== undefined ? h * 10 : null;
  }
  if (t.length === 3 && t[1] === "十") {
    const h = CN_DIGITS[t[0] ?? ""];
    const u = CN_DIGITS[t[2] ?? ""];
    if (h !== undefined && u !== undefined) return h * 10 + u;
  }

  return null;
}

/** 匹配「九月十四日」「十二月初五」等并规范为「9月14日」展示 */
function parseChineseMonthDayPhrase(text: string): string | null {
  const re =
    /([一二三四五六七八九十]{1,3})月([一二三四五六七八九十]{1,3})(日|号)(?:\s*(?:或|与|、)\s*([一二三四五六七八九十]{1,3})(日|号)?)?/;
  const m = text.match(re);
  if (!m) return null;

  const mo = chineseNumeralsToInt(m[1]);
  const d1 = chineseNumeralsToInt(m[2]);
  if (mo === null || d1 === null || mo < 1 || mo > 12 || d1 < 1 || d1 > 31) return null;

  if (m[4]) {
    const d2 = chineseNumeralsToInt(m[4]);
    if (d2 !== null && d2 >= 1 && d2 <= 31) {
      return `${mo}月${d1}日或${d2}日`;
    }
  }

  return `${mo}月${d1}日`;
}

const ACTION_PATTERNS = [
  /(我|I)\s*(会|will)\s*(在|by)?\s*(周[一二三四五六日天]|Friday|Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday|\d{4}-\d{2}-\d{2})?.{0,20}(发送|提交|完成|整理|follow up|send|deliver|prepare)/i,
  /(请|please).{0,18}(你|you).{0,18}(完成|处理|跟进|review|update|fix)/i,
  /(action item|todo|待办|后续)/i,
];

const POSITIVE_PATTERNS = /(同意|赞同|没问题|很好|great|sounds good|agree)/i;
const NEGATIVE_PATTERNS = /(不同意|不相信|不行|风险|担心|disagree|won't work|concern)/i;
const HESITATION_PATTERNS = /(可能|也许|不确定|maybe|not sure|perhaps)/i;
const TENSION_PATTERNS = /(争论|冲突|紧张|angry|frustrated|tense)/i;

function extractTopics(text: string): string[] {
  const raw = text
    .replace(/[.,!?;:]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((w) => w.length > 3);

  return [...new Set(raw)].slice(0, 3);
}

/** 从单条文本中提取截止时间/日期短语（支持中英文） */
export function inferDueDate(text: string): string | null {
  // === 中文日期 ===
  const cnMd = parseChineseMonthDayPhrase(text);
  if (cnMd) return cnMd;

  const range = text.match(/(\d{1,2}月\d{1,2}日(?:或|、|与)\d{1,2}日)/);
  if (range?.[1]) return range[1];

  const mZh = text.match(/(\d{1,2}月\d{1,2}(?:日|号))/);
  if (mZh?.[1]) return mZh[1];

  // === ISO 格式日期 ===
  const mIso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (mIso?.[1]) return mIso[1];

  // === 英文日期格式 ===
  // Jan 14, January 14, 14 Jan, 1/14, Jan-14
  const enMonthDate = text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\d{1,2}[\/\-]\d{1,2}/i);
  if (enMonthDate?.[0]) return enMonthDate[0];

  // === 具体日期+时刻组合（优先于「明天」等模糊词） ===
  const zhDateTime = text.match(
    /((?:今天|明天|后天|本周[一二三四五六日天]?|这周[一二三四五六日天]?|下周[一二三四五六日天]?)(?:上午|中午|下午|傍晚|晚上|凌晨|早上)?(?:\s*)?(?:[0-2]?\d|[一二三四五六七八九十两]{1,3})点(?:半)?(?:左右|前|后)?)/,
  );
  if (zhDateTime?.[1]) return zhDateTime[1];

  const zhPeriodTime = text.match(/((?:上午|中午|下午|傍晚|晚上|凌晨|早上)(?:\s*)?(?:[0-2]?\d|[一二三四五六七八九十两]{1,3})点(?:半)?(?:左右|前|后)?)/);
  if (zhPeriodTime?.[1]) return zhPeriodTime[1];

  const enDateTime = text.match(
    /\b(?:today|tomorrow|tonight|this\s+(?:morning|afternoon|evening)|next\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  );
  if (enDateTime?.[0]) return enDateTime[0];

  // === 具体时刻 ===
  // 中文：10点、10点前、10点半
  const cnHour = text.match(/([0-2]?[0-9]|二十[0-3]?|一?[0-9])点(?:半)?(?:左右|前|后)?/);
  if (cnHour?.[0]) return cnHour[0];

  // 英文：3pm, 3:00pm, 15:00, 3 o'clock
  const enHour = text.match(/\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM))?|\d{1,2}\s+o'?clock/i);
  if (enHour?.[0] && /am|pm|AM|PM|o'clock|:\d{2}/i.test(enHour[0])) return enHour[0];

  // === 中英文相对日期 ===
  const rel = text.match(
    /(今天下午|今天上午|明天上午|明天下午|今日|明天|后天|本周五|这周五|下周一|下周二|下周三|下周四|下周五|下周六|下周日|周[一二三四五六日天])/,
  );
  if (rel?.[1]) return rel[1];

  // 英文：tomorrow, next Friday, this Friday, today, tonight
  const enRel = text.match(/\b(?:tomorrow|next\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|this\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|today|tonight|yesterday|next\s+week|this\s+week)\b/i);
  if (enRel?.[0]) return enRel[0];

  // === 相对期限 ===
  // 中文：本月内、两周内、3天内
  const scopeDue = text.match(
    /(本月底前|月底前|本月内|本季度内|本年末前|本年底前|年底前|本周末前|本周内|这周内|两周内|三周内|\d{1,2}天内|\d{1,2}周内|\d{1,2}个月内|半年内|一年内|本年内|今年内)/,
  );
  if (scopeDue?.[1]) return scopeDue[1];

  // 英文：by end of day, within 2 weeks, in 3 days, by Friday
  const enScope = text.match(/\b(?:by\s+(?:end\s+of\s+)?(?:today|tomorrow|Friday|next\s+week|EOD|EOM|EOW)|within\s+\d+\s+(?:days?|weeks?|hours?|minutes?)|in\s+\d+\s+(?:days?|weeks?|hours?|minutes?)|before\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (enScope?.[0]) return enScope[0];

  // === 「本周…」不重复匹配 ===
  if (/本周(?![一二三四五六日天])/.test(text)) return "本周";

  // === 快速匹配常见词 ===
  if (/周五|Friday/i.test(text)) return "周五";
  if (/明天|tomorrow/i.test(text)) return "明天";
  if (/今天|today/i.test(text)) return "今天";
  
  // === 时段（中英文） ===
  const timePhrase = text.match(/(中午|下午|傍晚|晚上|早上|早晨|夜里|深夜|morning|afternoon|evening|night)/i);
  if (timePhrase?.[1]) return timePhrase[1];

  // === 最后检查英文月份说法 ===
  if (/\b(this month|by\s+EOM|end\s+of\s+(?:the\s+)?(?:this\s+)?month|month-end|month-end)\b/i.test(text)) return "月底";
  if (/\b(this week|by\s+EOW|end\s+of\s+(?:the\s+)?(?:this\s+)?week)\b/i.test(text)) return "周末";

  return null;
}

const UNKNOWN_OWNER = /^(待确认|未知|TBD|N\/A|null|无|不详|不确定|[-–—?？])$/i;

/** 从行动描述里补全负责人（中英文各类表述） */
export function extractOwnerFromActionText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;

  // 中文：开头名字 + 动词
  const mZh = t.match(/^([\u4e00-\u9fa5]{2,4})(?:将|会|拟|计划|担任|负责)/);
  if (mZh?.[1]) return mZh[1];

  // 中文：「由XXX负责/跟进/处理」
  const mBy = t.match(/由([\u4e00-\u9fa5]{2,4})(?:负责|跟进|处理|处理)/);
  if (mBy?.[1]) return mBy[1];

  // 中文：「XXX需要/应该...」
  const mNeed = t.match(/^([\u4e00-\u9fa5]{2,4})(?:需要|应该|要)\b/);
  if (mNeed?.[1]) return mNeed[1];

  // 英文：开头名字 + will/is going to
  const mWill = t.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:will|is\s+going\s+to|should|needs\s+to)\b/);
  if (mWill?.[1]) {
    const name = mWill[1].trim();
    if (name.length >= 2 && !/^\d+$/.test(name)) return name;
  }

  // 英文：「assigned to John」「by John」
  const mAssigned = t.match(/(?:assigned|given|delegated)\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (mAssigned?.[1]) return mAssigned[1].trim();

  // 英文：开头名字 + need/should
  const mEnNeed = t.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:need|should|have\s+to)\b/i);
  if (mEnNeed?.[1]) {
    const name = mEnNeed[1].trim();
    if (name.length >= 2) return name;
  }

  // 中文：「与XXX协作」「和XXX一起」
  const mWith = t.match(/与([\u4e00-\u9fa5]{2,4})(?:协作|合作|一起)/);
  if (mWith?.[1]) return mWith[1];

  return null;
}

export function normalizeActionOwner(
  owner: string | null | undefined,
  description: string,
): string | null {
  const raw = owner?.trim() ?? "";
  if (raw && !UNKNOWN_OWNER.test(raw)) return raw;
  return extractOwnerFromActionText(description);
}

export function normalizeActionDueDate(
  due: string | null | undefined,
  description: string,
): string | null {
  const raw = due?.trim() ?? "";
  const vague =
    /^(未识别|暂无|null|无|N\/A|无明确时间|暂无时间|时间待定|不明确|待定|TBD|未知)$/i.test(raw);
  if (raw && !vague) return raw;
  return inferDueDate(description);
}

function mergeStringLists(prev: string[], incoming: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...prev, ...incoming]) {
    const t = s?.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** 归一化后比较用：小写、空白、常见英美拼写、标点弱化 */
function normalizeComparable(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\btheatre\b/g, "theater")
    .replace(/[.,!?;:…'"「」、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordTokenSet(s: string): Set<string> {
  const n = normalizeComparable(s);
  return new Set(n.split(/\s+/).filter((w) => w.length > 0));
}

function jaccardWordSimilarity(a: string, b: string): number {
  const A = wordTokenSet(a);
  const B = wordTokenSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) {
    if (B.has(w)) inter++;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 字符 bigram Dice系数，用于短标签（如 Theater / theatre）近似 */
function diceBigramCoefficient(a: string, b: string): number {
  const x = normalizeComparable(a).replace(/\s/g, "");
  const y = normalizeComparable(b).replace(/\s/g, "");
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const bigsA = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const bg = x.slice(i, i + 2);
    bigsA.set(bg, (bigsA.get(bg) || 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const bg = y.slice(i, i + 2);
    const c = bigsA.get(bg) || 0;
    if (c > 0) {
      inter++;
      bigsA.set(bg, c - 1);
    }
  }
  return (2 * inter) / (x.length - 1 + y.length - 1);
}

/** 最长公共子串长度（用于无空格的中文短语等） */
function longestCommonSubstringLen(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let max = 0;
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
        if (dp[j]! > max) max = dp[j]!;
      } else {
        dp[j] = 0;
      }
      prev = temp;
    }
  }
  return max;
}

function longestCommonSubstringRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const lcs = longestCommonSubstringLen(a, b);
  return lcs / Math.min(a.length, b.length);
}

function hanCharCount(s: string): number {
  return [...s].filter((ch) => /\p{Script=Han}/u.test(ch)).length;
}

/** 至少含两个汉字时按中文短语做近义合并 */
function topicPairLooksChinese(a: string, b: string): boolean {
  return hanCharCount(a) >= 2 && hanCharCount(b) >= 2;
}

/** 相邻汉字二元组集合（用于判断两句是否同一议题的复述） */
function hanBigramSet(s: string): Set<string> {
  const chars = [...s.replace(/\s/g, "")].filter((ch) => /\p{Script=Han}/u.test(ch));
  const set = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) {
    set.add(chars[i] + chars[i + 1]);
  }
  return set;
}

/** 两条中文句是否围绕同一事实反复表述（小结/风险合并用） */
function chineseSentencesLikelySameFact(a: string, b: string): boolean {
  const ca = a.replace(/\s/g, "");
  const cb = b.replace(/\s/g, "");
  if (hanCharCount(ca) < 4 || hanCharCount(cb) < 4) return false;
  const minLen = Math.min(ca.length, cb.length);
  const lcsLen = longestCommonSubstringLen(ca, cb);
  const lcsRatio = longestCommonSubstringRatio(ca, cb);
  if (lcsLen >= 5) return true;
  if (lcsLen >= 4 && (lcsRatio >= 0.26 || minLen <= 28)) return true;
  const A = hanBigramSet(ca);
  const B = hanBigramSet(cb);
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter++;
  }
  const dice = A.size + B.size === 0 ? 0 : (2 * inter) / (A.size + B.size);
  if (dice >= 0.28) return true;
  return inter >= 4;
}

/** 短主题：前两字相同且整体较短时视为同一簇（如剧院经历 / 剧院观剧体验） */
function chineseTopicsSameCluster(a: string, b: string): boolean {
  if (!topicPairLooksChinese(a, b)) return false;
  const ca = a.replace(/\s/g, "");
  const cb = b.replace(/\s/g, "");
  if (ca.length < 2 || cb.length < 2) return false;
  if (ca.length > 14 || cb.length > 14) return false;
  if (ca[0] !== cb[0] || ca[1] !== cb[1]) return false;
  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = ca.length <= cb.length ? cb : ca;
  if (longer.startsWith(shorter) && shorter.length >= 2) return true;
  return longestCommonSubstringRatio(ca, cb) >= 0.32;
}

/** 去掉小结/风险等条目里的「第一点」「1.」等前缀（界面已有序号） */
export function stripSummaryListOrdinalPrefix(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/^(?:第[一二三四五六七八九十百千万零]+(?:点|条|项))[：:、．.）)\s]+/u, "")
      .replace(/^(?:第[一二三四五六七八九十百千万零]+)[：:、．.）)\s]+/u, "")
      .replace(/^(?:首先|其次|再次|接着|然后|最后|第一|第二|第三|第四|第五|第六|第七|第八|第九|第十)[，,：:、．.）)\s]+/u, "")
      .replace(/^\d{1,2}(?:[\.、．:：]|[\)）\]])[\s\u3000]*/u, "")
      .replace(/^(?:point|item)\s*\d+\s*[:：.\-–—]\s*/i, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function stringsLikelyDuplicate(a: string, b: string, mode: "topic" | "sentence"): boolean {
  const na = normalizeComparable(a);
  const nb = normalizeComparable(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ca = na.replace(/\s/g, "");
  const cb = nb.replace(/\s/g, "");
  if (ca === cb) return true;

  const short = ca.length <= cb.length ? ca : cb;
  const long = ca.length <= cb.length ? cb : ca;
  const minSub = mode === "topic" ? 4 : 12;
  if (short.length >= minSub && long.includes(short)) return true;

  const minLen = Math.min(ca.length, cb.length);
  const lcsRatio = longestCommonSubstringRatio(ca, cb);
  const lcsLen = longestCommonSubstringLen(ca, cb);

  if (mode === "topic") {
    if (chineseTopicsSameCluster(ca, cb)) return true;
    if (
      topicPairLooksChinese(ca, cb) &&
      ca.length <= 16 &&
      cb.length <= 16 &&
      minLen >= 2 &&
      lcsRatio >= 0.35
    ) {
      return true;
    }
  } else {
    if (chineseSentencesLikelySameFact(ca, cb)) return true;
    if (ca.length <= 120 && cb.length <= 120 && minLen >= 8 && lcsRatio >= 0.42) return true;
    if (minLen >= 18 && lcsLen >= 14 && lcsRatio >= 0.34) return true;
  }

  const jac = jaccardWordSimilarity(a, b);
  const tokensA = [...wordTokenSet(a)];
  const tokensB = [...wordTokenSet(b)];
  if (mode === "topic") {
    if (jac >= 0.5) return true;
    if (
      tokensA[0] &&
      tokensA[0] === tokensB[0] &&
      tokensA[0].length >= 3 &&
      tokensA.length <= 5 &&
      tokensB.length <= 5 &&
      jac >= 0.33
    ) {
      return true;
    }
    if (wordTokenSet(a).size <= 6 && wordTokenSet(b).size <= 6 && diceBigramCoefficient(a, b) >= 0.5) {
      return true;
    }
  } else {
    if (jac >= 0.48) return true;
    if (na.length >= 24 && nb.length >= 24) {
      const head = 28;
      if (na.slice(0, head) === nb.slice(0, head)) return true;
      if (jac >= 0.32 && (na.includes(nb.slice(0, head)) || nb.includes(na.slice(0, head)))) return true;
    }
  }

  return false;
}

function shouldReplaceDuplicateWithNewer(existing: string, incoming: string, mode: "topic" | "sentence"): boolean {
  const en = normalizeComparable(existing).replace(/\s/g, "");
  const tn = normalizeComparable(incoming).replace(/\s/g, "");
  if (!en || !tn) return false;
  if (mode === "sentence" && chineseSentencesLikelySameFact(existing, incoming)) {
    return incoming.trim().length < existing.trim().length;
  }
  if (incoming.length <= existing.length) return false;
  if (tn.includes(en)) return true;
  if (mode === "topic" && topicPairLooksChinese(en, tn) && longestCommonSubstringRatio(en, tn) >= 0.35) return true;
  if (mode === "sentence" && tn.length >= en.length + 6 && longestCommonSubstringRatio(en, tn) >= 0.38) return true;
  return false;
}

/** 保留先出现的一条，去掉与已有项在大小写/措辞上近似的重复；主题保留更长表述，小结/风险同义时保留更短表述 */
export function dedupeSimilarStrings(items: string[], mode: "topic" | "sentence"): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const t = raw?.trim();
    if (!t) continue;
    const dupIdx = out.findIndex((e) => stringsLikelyDuplicate(e, t, mode));
    if (dupIdx >= 0) {
      if (shouldReplaceDuplicateWithNewer(out[dupIdx]!, t, mode)) {
        out[dupIdx] = t;
      }
      continue;
    }
    out.push(t);
  }
  return out;
}

/** 合并 LLM 新结果与已有摘要：空字段不覆盖，列表去重追加 */
export function mergeMeetingSummaries(prev: MeetingSummary, incoming: MeetingSummary): MeetingSummary {
  const incomingText = incoming.summaryText?.trim() ?? "";
  const summaryText = incomingText || prev.summaryText?.trim() || "";

  const topicsMerged = mergeStringLists(prev.topics ?? [], incoming.topics ?? [], 20);
  const briefMerged = mergeStringLists(
    (prev.briefPoints ?? []).map(stripSummaryListOrdinalPrefix),
    (incoming.briefPoints ?? []).map(stripSummaryListOrdinalPrefix),
    14,
  );
  const risksMerged = mergeStringLists(
    (prev.risks ?? []).map(stripSummaryListOrdinalPrefix),
    (incoming.risks ?? []).map(stripSummaryListOrdinalPrefix),
    16,
  );

  return {
    summaryText: summaryText || undefined,
    topics: dedupeSimilarStrings(topicsMerged, "topic").slice(0, 6),
    briefPoints: dedupeSimilarStrings(briefMerged, "sentence").slice(0, 6),
    decisions: mergeStringLists(prev.decisions ?? [], incoming.decisions ?? [], 14),
    risks: dedupeSimilarStrings(risksMerged, "sentence").slice(0, 4),
    nextActions: mergeStringLists(prev.nextActions ?? [], incoming.nextActions ?? [], 22),
    updatedAt: new Date().toISOString(),
  };
}

export function detectSentiment(segment: TranscriptSegment): SentimentMoment | null {
  let label: SentimentLabel | null = null;
  let intensity = 0.5;

  if (TENSION_PATTERNS.test(segment.text)) {
    label = "tension";
    intensity = 0.85;
  } else if (NEGATIVE_PATTERNS.test(segment.text)) {
    label = "disagreement";
    intensity = 0.75;
  } else if (HESITATION_PATTERNS.test(segment.text)) {
    label = "hesitation";
    intensity = 0.6;
  } else if (POSITIVE_PATTERNS.test(segment.text)) {
    label = "agreement";
    intensity = 0.7;
  }

  if (!label) return null;

  return {
    id: crypto.randomUUID(),
    meetingId: segment.meetingId,
    label,
    intensity,
    sourceSegmentId: segment.id,
    evidenceText: segment.text,
    createdAt: new Date().toISOString(),
  };
}

export function extractActionItems(segment: TranscriptSegment): ActionItem[] {
  const matched = ACTION_PATTERNS.some((pattern) => pattern.test(segment.text));
  if (!matched) return [];

  const owner = segment.speakerName || null;
  const dueDate = inferDueDate(segment.text);

  return [
    {
      id: crypto.randomUUID(),
      meetingId: segment.meetingId,
      description: segment.text,
      owner: normalizeActionOwner(owner, segment.text),
      dueDate: normalizeActionDueDate(dueDate, segment.text),
      sourceSegmentId: segment.id,
      status: "pending_confirmation",
    },
  ];
}

export function updateSummary(meeting: Meeting, latestSegment: TranscriptSegment): MeetingSummary {
  const prev = meeting.summary;
  const lowered = latestSegment.text.toLowerCase();

  const topics = [...new Set([...prev.topics, ...extractTopics(latestSegment.text)])].slice(0, 10);
  const decisions = [...prev.decisions];
  const risks = [...prev.risks];
  const nextActions = [...prev.nextActions];

  if (/(决定|decide|结论|final)/i.test(lowered)) {
    decisions.push(latestSegment.text);
  }
  if (/(风险|阻塞|blocker|issue|problem)/i.test(lowered)) {
    risks.push(latestSegment.text);
  }
  if (/(下一步|next step|follow up|待办|action)/i.test(lowered)) {
    nextActions.push(latestSegment.text);
  }

  return {
    summaryText: prev.summaryText,
    topics: dedupeSimilarStrings(topics, "topic").slice(-8),
    briefPoints: prev.briefPoints,
    decisions: dedupeSimilarStrings(decisions, "sentence").slice(-6),
    risks: dedupeSimilarStrings(risks, "sentence").slice(-6),
    nextActions: dedupeSimilarStrings(nextActions, "sentence").slice(-8),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateSummaryWithLlmOrFallback(
  meeting: Meeting,
  transcriptWindow: TranscriptSegment[],
  options?: { preferChineseOutput?: boolean },
): Promise<{ summary: MeetingSummary; actionItems: Array<{ owner: string; due: string | null; description: string }> | null }> {
  const previousSummary = JSON.stringify({
    summaryText: meeting.summary.summaryText ?? "",
    briefPoints: meeting.summary.briefPoints ?? [],
    topics: meeting.summary.topics ?? [],
    decisions: meeting.summary.decisions ?? [],
    nextActions: meeting.summary.nextActions ?? [],
    risks: meeting.summary.risks ?? [],
    preservedActionItems: meeting.actions.map((a) => ({
      description: a.description,
      owner: a.owner,
      due: a.dueDate,
    })),
  });

  const windowLines = transcriptWindow.slice(-80).map((s) => `${s.speakerName}: ${s.text}`);
  let llm = null;
  try {
    llm = await generateSummaryWithLlm({
      transcriptWindow: windowLines,
      previousSummary,
      preferChineseOutput: options?.preferChineseOutput,
    });
  } catch {
    llm = null;
  }
  
  if (!llm) {
    const latest = transcriptWindow[transcriptWindow.length - 1];
    return { summary: updateSummary(meeting, latest), actionItems: null };
  }

  const incoming: MeetingSummary = {
    summaryText: llm.summaryText,
    topics: (llm.topics ?? []).slice(0, 12),
    briefPoints: (llm.briefPoints ?? []).slice(0, 6),
    decisions: (llm.decisions ?? []).slice(0, 12),
    risks: (llm.risks ?? []).slice(0, 12),
    nextActions: (llm.nextActions ?? []).slice(0, 22),
    updatedAt: new Date().toISOString(),
  };

  return {
    summary: mergeMeetingSummaries(meeting.summary, incoming),
    actionItems: llm.actionItems?.slice(0, 12) || null,
  };
}