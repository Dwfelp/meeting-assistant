import { detectSentiment, extractActionItems, updateSummaryWithLlmOrFallback } from "@/lib/analysis";
import { IngestEventInput, Meeting, TranscriptSegment } from "@/types/meeting";

const meetings = new Map<string, Meeting>();
const llmLastRunAtMsByMeeting = new Map<string, number>();

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
    meeting.actions.push(...ruleBasedActionItems);
  }

  // 情感分析
  const sentimentMoment = detectSentiment(segment);
  if (sentimentMoment) {
    meeting.sentiments.push(sentimentMoment);
  }

  const lastRun = llmLastRunAtMsByMeeting.get(meetingId) ?? 0;
  const shouldRunLlm = now - lastRun >= 3500;
  const transcriptWindow = meeting.transcript;

  if (shouldRunLlm) {
    llmLastRunAtMsByMeeting.set(meetingId, now);
    try {
      const { summary, actionItems } = await updateSummaryWithLlmOrFallback(meeting, transcriptWindow);
      meeting.summary = summary;

      // 使用 LLM 返回的 actionItems（包含 owner）
      if (actionItems?.length) {
        const existingDescriptions = new Set(meeting.actions.map(a => a.description));
        const newActions = actionItems
          .filter(item => item.description && !existingDescriptions.has(item.description))
          .map((item) => ({
            id: crypto.randomUUID(),
            meetingId,
            description: item.description,
            owner: item.owner || null,
            dueDate: item.due,
            sourceSegmentId: segment.id,
            confidence: 0.85,
            status: "pending_confirmation" as const,
          }));
        
        if (newActions.length) {
          meeting.actions.push(...newActions);
        }
      }
    } catch (error) {
      console.error('[MeetingStore] LLM 调用失败，使用降级方案:', error);
      const { summary } = await updateSummaryWithLlmOrFallback(meeting, transcriptWindow);
      meeting.summary = summary;
    }
  } else {
    // 未达到调用频率，也尝试更新（但不调用 LLM，只做规则更新）
    const { summary } = await updateSummaryWithLlmOrFallback(meeting, transcriptWindow);
    meeting.summary = summary;
  }
  
  return meeting;
}