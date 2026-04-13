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
  confidence: number;
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
}
