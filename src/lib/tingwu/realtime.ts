import { RealtimeResult } from '@/types/tingwu';

export type RealtimeCallback = (result: RealtimeResult) => void;

export class TingwuRealtimeClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isRecordingFlag = false;
  private onResult: RealtimeCallback;
  private taskId: string | null = null;

  constructor(onResult: RealtimeCallback) {
    this.onResult = onResult;
  }

  // 开始录音
  async start(): Promise<boolean> {
    try {
      // 1. 创建听悟实时任务
      const response = await fetch('/api/tingwu/realtime', { method: 'POST' });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '创建任务失败');
      }
      
      this.taskId = data.taskId;
      const wsUrl = data.wsUrl;
      
      console.log('[听悟] 任务创建成功, TaskId:', this.taskId);
      console.log('[听悟] WebSocket URL:', wsUrl);
      
      // 2. 连接 WebSocket
      this.ws = new WebSocket(wsUrl);
      
      return new Promise((resolve, reject) => {
        if (!this.ws) {
          reject(false);
          return;
        }
        
        this.ws.onopen = async () => {
          console.log('[听悟] WebSocket 连接成功');
          
          // 发送启动消息（必须！）
          const startMessage = {
            header: {
              name: "StartTranscription",
              namespace: "SpeechTranscriber",
              version: "1.0"
            },
            payload: {
              format: "pcm",
              sample_rate: 16000,
              language: "cn"
            }
          };
          this.ws!.send(JSON.stringify(startMessage));
          console.log('[听悟] 已发送启动消息');
          
          // 启动麦克风
          const micSuccess = await this.startMicrophone();
          resolve(micSuccess);
        };
        
        this.ws.onerror = (error) => {
          console.error('[听悟] WebSocket 错误:', error);
          reject(false);
        };
        
        this.ws.onclose = (event) => {
          console.log('[听悟] WebSocket 关闭:', event.code, event.reason);
        };
        
        this.ws.onmessage = (event) => {
          console.log('[听悟] WebSocket 原始消息:', event.data);
          this.handleMessage(event.data);
        };
      });
    } catch (error) {
      console.error('[听悟] 启动失败:', error);
      return false;
    }
  }

  // 停止录音
  async stop(): Promise<void> {
    this.isRecordingFlag = false;
    
    // 发送结束消息
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const stopMessage = {
        header: {
          name: "StopTranscription",
          namespace: "SpeechTranscriber",
          version: "1.0"
        },
        payload: {}
      };
      this.ws.send(JSON.stringify(stopMessage));
      console.log('[听悟] 已发送结束消息');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      this.ws.close();
      this.ws = null;
    }
    
    // 关闭音频处理
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    console.log('[听悟] 录音已停止');
  }

  get isRecording(): boolean {
    return this.isRecordingFlag;
  }

  get currentTaskId(): string | null {
    return this.taskId;
  }

  // 线性插值重采样函数
  private resample(inputData: Float32Array, inputSampleRate: number, targetSampleRate: number): Float32Array {
    if (inputSampleRate === targetSampleRate) {
      return inputData;
    }
    
    const ratio = inputSampleRate / targetSampleRate;
    const outputLength = Math.floor(inputData.length / ratio);
    const outputData = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
      const fraction = srcIndex - srcIndexFloor;
      
      outputData[i] = inputData[srcIndexFloor] * (1 - fraction) + 
                     inputData[srcIndexCeil] * fraction;
    }
    
    return outputData;
  }

  // 启动麦克风
  private async startMicrophone(): Promise<boolean> {
    try {
      // 获取麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
        } 
      });
      
      this.audioContext = new AudioContext();
      const actualSampleRate = this.audioContext.sampleRate;
      const targetSampleRate = 16000;
      
      console.log(`[听悟] 浏览器实际采样率: ${actualSampleRate}Hz, 目标采样率: ${targetSampleRate}Hz`);
      
      if (actualSampleRate !== targetSampleRate) {
        console.log(`[听悟] 需要重采样: ${actualSampleRate}Hz -> ${targetSampleRate}Hz`);
      }
      
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      this.processorNode.onaudioprocess = (event) => {
        if (!this.isRecordingFlag) return;
        
        const inputData = event.inputBuffer.getChannelData(0);
        let pcmData: Int16Array;
        
        if (actualSampleRate !== targetSampleRate) {
          const resampledData = this.resample(inputData, actualSampleRate, targetSampleRate);
          pcmData = new Int16Array(resampledData.length);
          for (let i = 0; i < resampledData.length; i++) {
            let sample = resampledData[i];
            sample = Math.max(-1, Math.min(1, sample));
            pcmData[i] = Math.floor(sample * 32767);
          }
        } else {
          pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            let sample = inputData[i];
            sample = Math.max(-1, Math.min(1, sample));
            pcmData[i] = Math.floor(sample * 32767);
          }
        }
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const buffer = pcmData.buffer.slice(0) as ArrayBuffer;
          this.ws.send(buffer);
        }
      };
      
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      await this.audioContext.resume();
      
      this.isRecordingFlag = true;
      console.log('[听悟] 麦克风已启动，音频处理已开始');
      return true;
      
    } catch (error) {
      console.error('[听悟] 麦克风启动失败:', error);
      return false;
    }
  }

  // 处理 WebSocket 消息
  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);
      const { header, payload } = message;
      
      console.log('[听悟] 收到消息类型:', header?.name);
      
      switch (header?.name) {
        case 'TranscriptionResultChanged':
          console.log('[听悟] 识别中:', payload?.result || payload?.text || '');
          this.onResult({
            text: payload?.result || payload?.text || '',
            speakerId: payload?.speaker_id || payload?.speakerId || 'unknown',
            isFinal: false,
            emotion: payload?.emotion,
          });
          break;
          
        case 'SentenceEnd':
          console.log('[听悟] 最终结果:', payload?.result || payload?.text || '');
          this.onResult({
            text: payload?.result || payload?.text || '',
            speakerId: payload?.speaker_id || payload?.speakerId || 'unknown',
            isFinal: true,
            emotion: payload?.emotion,
          });
          break;
          
        case 'SentenceBegin':
          console.log('[听悟] 句子开始');
          break;
          
        case 'TaskFailed':
          console.error('[听悟] 任务失败:', payload);
          break;
          
        default:
          if (header?.name) {
            console.log('[听悟] 未处理的消息类型:', header.name, payload);
          }
      }
    } catch (error) {
      console.error('[听悟] 消息解析失败:', error, '原始数据:', data);
    }
  }
}