// 阿里云听悟离线文件转写

export interface FileUploadResult {
  taskId: string;
  success: boolean;
  error?: string;
}

export interface TaskResult {
  taskId: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  sentences?: Array<{
    text: string;
    speakerId: string;
    beginTime: number;
    endTime: number;
    emotion?: string;
  }>;
  error?: string;
}

// 上传音频文件并提交转写任务
export async function submitFileTranscription(file: File): Promise<FileUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch('/api/tingwu/upload', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { taskId: '', success: false, error };
    }
    
    const data = await response.json();
    return { taskId: data.taskId, success: true };
  } catch (error) {
    return { taskId: '', success: false, error: String(error) };
  }
}

// 轮询获取转写结果
export async function pollTaskResult(
  taskId: string,
  onProgress?: (sentences: any[]) => void
): Promise<TaskResult> {
  const maxAttempts = 60; // 最多轮询60次
  const interval = 2000; // 每2秒轮询一次
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`/api/tingwu/task/${taskId}`);
      const data = await response.json();
      
      if (data.status === 'SUCCESS') {
        return {
          taskId,
          status: 'SUCCESS',
          sentences: data.sentences || [],
        };
      } else if (data.status === 'FAILED') {
        return {
          taskId,
          status: 'FAILED',
          error: data.error || '转写失败',
        };
      }
      
      // 运行中，回调进度
      if (onProgress && data.sentences) {
        onProgress(data.sentences);
      }
      
      // 等待后继续轮询
      await new Promise(resolve => setTimeout(resolve, interval));
    } catch (error) {
      console.error(`[听悟] 轮询任务 ${taskId} 失败:`, error);
    }
  }
  
  return {
    taskId,
    status: 'FAILED',
    error: '转写超时',
  };
}