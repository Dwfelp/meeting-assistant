import {
  detectSentiment,
  extractActionItems,
  normalizeActionDueDate,
  normalizeActionOwner,
  updateSummary,
  updateSummaryWithLlmOrFallback,
} from "@/lib/analysis";
import { IngestEventInput, Meeting, TranscriptSegment } from "@/types/meeting";

const meetings = new Map<string, Meeting>();
const llmLastRunAtMsByMeeting = new Map<string, number>();

/** 已有摘要后 LLM 全量刷新最小间隔（避免每条发言都打模型） */
const LLM_SUMMARY_INTERVAL_MS = 90_000;
/** 会议尚无像样摘要时，稍短间隔便于冷启动 */
const LLM_SUMMARY_BOOTSTRAP_INTERVAL_MS = 30_000;

function meetingHasUsableSummary(meeting: Meeting): boolean {
  const s = meeting.summary;
  return Boolean(
    s.summaryText?.trim() ||
      (s.briefPoints?.length ?? 0) > 0 ||
      (s.topics?.length ?? 0) > 0 ||
      (s.decisions?.length ?? 0) > 0 ||
      (s.nextActions?.length ?? 0) > 0 ||
      (s.risks?.length ?? 0) > 0,
  );
}

function createEmptyMeeting(id: string, title: string): Meeting {
  const now = new Date().toISOString();
  return {
    id,
    title,
    createdAt: now,
    participants: [],
    transcript: [],
    actions: [],
    sentiments: [],
    summary: {
      summaryText: '',
      topics: [],
      briefPoints: [],
      decisions: [],
      risks: [],
      nextActions: [],
      updatedAt: now,
    },
  };
}

export function createMeeting(title: string): Meeting {
  const id = `m_${crypto.randomUUID()}`;
  const meeting = createEmptyMeeting(id, title);
  meetings.set(id, meeting);
  return meeting;
}

export function getMeeting(id: string): Meeting | null {
  return meetings.get(id) ?? null;
}

export function listMeetings(): Meeting[] {
  return Array.from(meetings.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function ingestTranscriptEvent(meetingId: string, input: IngestEventInput): Promise<Meeting | null> {
  const meeting = meetings.get(meetingId);
  if (!meeting) return null;

  const now = Date.now();
  const segment: TranscriptSegment = {
    id: `seg_${crypto.randomUUID()}`,
    meetingId,
    speakerId: input.speakerName.trim().toLowerCase().replace(/\s+/g, "-") || "unknown",
    speakerName: input.speakerName,
    text: input.text,
    language: input.language || "auto",
    startMs: now,
    endMs: now + 1200,
    isFinal: input.isFinal ?? true,
    createdAt: new Date().toISOString(),
  };

  meeting.transcript.push(segment);

  // 更新参与者
  if (input.speakerName && !meeting.participants.find((p) => p.name === input.speakerName)) {
    meeting.participants.push({
      id: segment.speakerId,
      name: input.speakerName,
    });
  }

  // 规则匹配提取行动项（作为兜底）
  const ruleBasedActionItems = extractActionItems(segment);
  if (ruleBasedActionItems.length) {
    meeting.actions = [...meeting.actions, ...ruleBasedActionItems];
  }

  // 情感分析
  const sentimentMoment = detectSentiment(segment);
  if (sentimentMoment) {
    meeting.sentiments.push(sentimentMoment);
  }

  const lastRun = llmLastRunAtMsByMeeting.get(meetingId) ?? 0;
  const intervalMs = meetingHasUsableSummary(meeting)
    ? LLM_SUMMARY_INTERVAL_MS
    : LLM_SUMMARY_BOOTSTRAP_INTERVAL_MS;
  const shouldRunLlm = now - lastRun >= intervalMs;
  const transcriptWindow = meeting.transcript;

  if (shouldRunLlm) {
    llmLastRunAtMsByMeeting.set(meetingId, now);
    try {
      const { summary, actionItems } = await updateSummaryWithLlmOrFallback(meeting, transcriptWindow, {
        preferChineseOutput: input.preferChineseSummary === true,
      });
      meeting.summary = summary;

      if (actionItems?.length) {
        const newActions = actionItems.map((item) => ({
          id: crypto.randomUUID(),
          meetingId,
          description: item.description,
          owner: normalizeActionOwner(item.owner, item.description),
          dueDate: normalizeActionDueDate(item.due, item.description),
          sourceSegmentId: segment.id,
          status: "pending_confirmation" as const,
        }));
        meeting.actions = newActions;
      }
    } catch (error) {
      console.error("[MeetingStore] LLM 调用失败，使用规则降级:", error);
      meeting.summary = updateSummary(meeting, segment);
    }
  } else {
    meeting.summary = updateSummary(meeting, segment);
  }
  
  return meeting;
}