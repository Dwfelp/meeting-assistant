'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, Upload, Loader2, AlertCircle } from 'lucide-react';
import { TingwuRealtimeClient } from '@/lib/tingwu/realtime';

interface VoiceAssistantProps {
  meetingId: string | null;
  onTranscriptReceived: (speakerName: string, text: string) => void;
  onInterimUpdate?: (text: string) => void;
  onCreateMeeting?: () => Promise<string | null>;  // 新增：创建会议的回调
}

// 说话人映射
const speakerNameMap: Record<string, string> = {
  speaker_1: '参会者A',
  speaker_2: '参会者B',
  speaker_3: '参会者C',
  speaker_4: '参会者D',
  unknown: '发言人',
};

export function VoiceAssistant({ meetingId, onTranscriptReceived, onInterimUpdate, onCreateMeeting }: VoiceAssistantProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [localMeetingId, setLocalMeetingId] = useState<string | null>(meetingId);
  
  const realtimeClientRef = useRef<TingwuRealtimeClient | null>(null);

  // 确保有 meetingId，如果没有则创建
  const ensureMeetingId = async (): Promise<string | null> => {
    // 如果已有 meetingId，直接返回
    if (localMeetingId) {
      return localMeetingId;
    }
    
    // 如果有创建会议的回调，调用它
    if (onCreateMeeting) {
      const newId = await onCreateMeeting();
      if (newId) {
        setLocalMeetingId(newId);
        return newId;
      }
    }
    
    // 否则自己创建会议
    try {
      console.log('[VoiceAssistant] 没有会议，自动创建...');
      const response = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新会议' }),
      });
      const data = await response.json();
      if (data.meeting?.id) {
        setLocalMeetingId(data.meeting.id);
        console.log('[VoiceAssistant] 会议创建成功:', data.meeting.id);
        return data.meeting.id;
      }
      return null;
    } catch (error) {
      console.error('[VoiceAssistant] 创建会议失败:', error);
      return null;
    }
  };

  // 初始化听悟客户端
  const initClient = () => {
    if (realtimeClientRef.current) return;
    
    realtimeClientRef.current = new TingwuRealtimeClient((result) => {
      console.log('[VoiceAssistant] 收到识别结果:', result);
      
      if (result.isFinal) {
        const speakerName = speakerNameMap[result.speakerId] || result.speakerId;
        console.log('[VoiceAssistant] 最终结果:', speakerName, result.text);
        onTranscriptReceived(speakerName, result.text);
        
        setInterimText('');
        onInterimUpdate?.('');
      } else {
        console.log('[VoiceAssistant] 中间结果:', result.text);
        setInterimText(result.text);
        onInterimUpdate?.(result.text);
      }
    });
  };

  // 开始录音
  const startRecording = async () => {
    setError(null);
    
    // 确保有 meetingId
    const id = await ensureMeetingId();
    if (!id) {
      setError('创建会议失败，请刷新页面重试');
      return;
    }
    
    initClient();
    
    if (!realtimeClientRef.current) {
      setError('客户端初始化失败');
      return;
    }
    
    const success = await realtimeClientRef.current.start();
    if (success) {
      setIsRecording(true);
    } else {
      setError('启动录音失败，请检查麦克风权限和听悟配置');
    }
  };

  // 停止录音
  const stopRecording = async () => {
    if (realtimeClientRef.current) {
      await realtimeClientRef.current.stop();
    }
    setIsRecording(false);
    setInterimText('');
    onInterimUpdate?.('');
  };

  // 上传音频文件
  const uploadAudio = async (file: File) => {
    // 确保有 meetingId
    const id = await ensureMeetingId();
    if (!id) {
      setError('创建会议失败，请刷新页面重试');
      return;
    }
    
    setIsUploading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/tingwu/upload', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '上传失败');
      }
      
      pollTaskResult(data.taskId);
    } catch (error) {
      setError(error instanceof Error ? error.message : '上传失败');
      setIsUploading(false);
    }
  };
  
  // 轮询转写结果
  const pollTaskResult = async (taskId: string) => {
    let attempts = 0;
    const maxAttempts = 60;
    
    const poll = async () => {
      try {
        const response = await fetch(`/api/tingwu/task/${taskId}`);
        const data = await response.json();
        
        if (data.status === 'SUCCESS') {
          for (const sentence of data.sentences) {
            const speakerName = speakerNameMap[sentence.speakerId] || sentence.speakerId;
            onTranscriptReceived(speakerName, sentence.text);
          }
          setIsUploading(false);
        } else if (data.status === 'FAILED') {
          setError(data.error || '转写失败');
          setIsUploading(false);
        } else {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(poll, 2000);
          } else {
            setError('转写超时');
            setIsUploading(false);
          }
        }
      } catch (error) {
        setError('查询结果失败');
        setIsUploading(false);
      }
    };
    
    poll();
  };
  
  // 选择文件
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadAudio(file);
    }
    event.target.value = '';
  };
  
  // 组件卸载时停止录音
  useEffect(() => {
    return () => {
      if (isRecording && realtimeClientRef.current) {
        realtimeClientRef.current.stop();
      }
    };
  }, [isRecording]);
  
  // 同步外部的 meetingId
  useEffect(() => {
    if (meetingId && !localMeetingId) {
      setLocalMeetingId(meetingId);
    }
  }, [meetingId]);
  
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!isRecording ? (
          <Button
            variant="outline"
            size="sm"
            onClick={startRecording}
            disabled={isUploading}
            className="gap-2"
          >
            <Mic className="size-4" />
            开始录音
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={stopRecording}
            className="gap-2"
          >
            <Square className="size-4" />
            停止录音
          </Button>
        )}
        
        <Button
          variant="outline"
          size="sm"
          disabled={isRecording || isUploading}
          className="gap-2 relative overflow-hidden"
          onClick={() => document.getElementById('audio-upload-input')?.click()}
        >
          <Upload className="size-4" />
          上传音频
        </Button>
        <input
          id="audio-upload-input"
          type="file"
          className="hidden"
          accept="audio/*"
          onChange={handleFileSelect}
          disabled={isRecording || isUploading}
        />
        
        {isUploading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            转写中...
          </div>
        )}
      </div>
      
      {interimText && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-sm text-sky-700">
          <span className="text-xs text-sky-500">识别中：</span>
          {interimText}
        </div>
      )}
      
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-600">
          <AlertCircle className="size-4" />
          {error}
        </div>
      )}
      
      {!isRecording && !interimText && !error && (
        <p className="text-xs text-muted-foreground">
          🎙️ 点击开始录音，实时转写并自动区分说话人
          <br />
          📁 或上传音频文件（MP3/WAV/M4A），系统将自动转写
        </p>
      )}
    </div>
  );
}