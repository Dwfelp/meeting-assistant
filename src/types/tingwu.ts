// 阿里云听悟相关类型定义

// 听悟句子格式
export interface TingwuSentence {
  text: string;
  speakerId: string;
  beginTime: number;
  endTime: number;
  emotion: string;
  words?: Array<{ text: string; beginTime: number; endTime: number }>;
}

// 实时会议结果
export interface RealtimeResult {
  text: string;
  speakerId: string;
  isFinal: boolean;
  emotion?: string;
}

// 离线任务结果
export interface TaskResult {
  taskId: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  sentences?: TingwuSentence[];
  error?: string;
}