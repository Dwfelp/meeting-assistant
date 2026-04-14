export type SentimentLabel = "positive" | "neutral" | "negative" | "tension" | "hesitation" | "agreement" | "disagreement";

export interface Participant {
  id: string;
  name: string;
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  speakerId: string;
  speakerName: string;
  text: string;
  language: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
  createdAt: string;
  translatedText?: string;
}

export interface ActionItem {
  id: string;
  meetingId: string;
  description: string;
  owner: string | null;
  dueDate: string | null;
  sourceSegmentId: string;
  status: "pending_confirmation" | "confirmed" | "done";
}

export interface SentimentMoment {
  id: string;
  meetingId: string;
  label: SentimentLabel;
  intensity: number;
  sourceSegmentId: string;
  evidenceText: string;
  createdAt: string;
}

export interface MeetingSummary {
  summaryText?: string;
  topics: string[];
  /** 结构化小结（每条 1～2 句），与行动项 tab 区分，不写待办清单体 */
  briefPoints?: string[];
  decisions: string[];
  risks: string[];
  nextActions: string[];
  updatedAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  createdAt: string;
  participants: Participant[];
  transcript: TranscriptSegment[];
  actions: ActionItem[];
  sentiments: SentimentMoment[];
  summary: MeetingSummary;
}

export interface IngestEventInput {
  speakerName: string;
  text: string;
  language?: string;
  isFinal?: boolean;
  translatedText?: string;
  /** 与 UI「启用自动翻译」一致：为 true 时摘要/行动项输出中文 */
  preferChineseSummary?: boolean;
}
