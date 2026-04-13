import { generateSummaryWithLlm } from "@/lib/llm-client";
import { ActionItem, Meeting, MeetingSummary, SentimentLabel, SentimentMoment, TranscriptSegment } from "@/types/meeting";

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

export function inferDueDate(text: string): string | null {
  const m = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (m?.[1]) return `${m[1]}T17:00:00.000Z`;

  if (/周五|Friday/i.test(text)) {
    return "Friday";
  }

  if (/明天|tomorrow/i.test(text)) {
    return "tomorrow";
  }

  return null;
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
      owner,
      dueDate,
      sourceSegmentId: segment.id,
      confidence: dueDate ? 0.9 : 0.75,
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
    topics: topics.slice(-8),
    decisions: decisions.slice(-6),
    risks: risks.slice(-6),
    nextActions: nextActions.slice(-8),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateSummaryWithLlmOrFallback(
  meeting: Meeting,
  transcriptWindow: TranscriptSegment[],
): Promise<{ summary: MeetingSummary; actionItems: Array<{ owner: string; due: string | null; description: string }> | null }> {
  const previousSummary = [
    `topics: ${(meeting.summary.topics ?? []).join(", ") || "none"}`,
    `decisions: ${(meeting.summary.decisions ?? []).join(" | ") || "none"}`,
    `nextActions: ${(meeting.summary.nextActions ?? []).join(" | ") || "none"}`,
    `risks: ${(meeting.summary.risks ?? []).join(" | ") || "none"}`,
  ].join("\n");

  const windowLines = transcriptWindow.slice(-80).map((s) => `${s.speakerName}: ${s.text}`);
  let llm = null;
  try {
    llm = await generateSummaryWithLlm({ transcriptWindow: windowLines, previousSummary });
  } catch {
    llm = null;
  }
  
  if (!llm) {
    const latest = transcriptWindow[transcriptWindow.length - 1];
    return { summary: updateSummary(meeting, latest), actionItems: null };
  }

  return {
    summary: {
      summaryText: llm.summaryText,  // ✅ 新增
      topics: llm.topics.slice(0, 10),
      decisions: llm.decisions.slice(0, 10),
      risks: llm.risks.slice(0, 10),
      nextActions: llm.nextActions.slice(0, 15),
      updatedAt: new Date().toISOString(),
    },
    actionItems: llm.actionItems?.slice(0, 12) || null,  // ✅ 新增：使用 LLM 返回的 actionItems
  };
}