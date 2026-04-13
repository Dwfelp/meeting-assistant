// src/app/api/tingwu/realtime/route.ts
import { NextResponse } from 'next/server';
import { getTingwuConfig } from '@/lib/tingwu/config';
import * as crypto from 'crypto';

function generateRoaSignature(
  accessKeySecret: string,
  method: string,
  pathname: string,
  headers: Record<string, string>,
  body: string
): string {
  const accept = headers['Accept'] || 'application/json';
  const contentMd5 = headers['Content-MD5'] || '';
  const contentType = headers['Content-Type'] || 'application/json';
  const date = headers['Date'] || '';
  
  const stringToSign = `${method}\n${accept}\n${contentMd5}\n${contentType}\n${date}\n${pathname}`;
  
  const signature = crypto
    .createHmac('sha1', accessKeySecret)
    .update(stringToSign)
    .digest('base64');
  
  return signature;
}

export async function POST() {
  const config = getTingwuConfig();
  
  if (!config) {
    return NextResponse.json({ 
      error: '听悟未配置，请检查.env.local' 
    }, { status: 503 });
  }

  try {
    // 🔥 添加说话人分离配置
    const body = {
      AppKey: config.appKey,
      Input: {
        SourceLanguage: "cn",
        Format: "pcm",
        SampleRate: 16000
      },
      Parameters: {
        Transcription: {
          DiarizationEnabled: true,   // 开启说话人分离
          Diarization: {
            SpeakerCount: 2            // 2人对话，0表示自动识别
          }
        }
      }
    };

    const bodyStr = JSON.stringify(body);
    const date = new Date().toUTCString();
    const pathname = '/openapi/tingwu/v2/tasks?type=realtime';
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Date': date,
      'Host': `tingwu.${config.region}.aliyuncs.com`,
    };

    const signature = generateRoaSignature(
      config.accessKeySecret,
      'PUT',
      pathname,
      headers,
      bodyStr
    );

    headers['Authorization'] = `acs ${config.accessKeyId}:${signature}`;

    console.log('[听悟] 请求 URL:', `https://tingwu.${config.region}.aliyuncs.com${pathname}`);
    console.log('[听悟] 请求体:', bodyStr);

    const response = await fetch(
      `https://tingwu.${config.region}.aliyuncs.com${pathname}`,
      {
        method: 'PUT',
        headers,
        body: bodyStr,
      }
    );

    const data = await response.json();
    console.log('[听悟] 响应状态:', response.status);
    console.log('[听悟] 响应体:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      throw new Error(data.Message || `HTTP ${response.status}`);
    }

    const taskId = data.Data?.TaskId;
    const wsUrl = data.Data?.MeetingJoinUrl;

    if (!taskId) {
      throw new Error('返回数据缺少 TaskId');
    }

    return NextResponse.json({ 
      taskId, 
      wsUrl: wsUrl || `wss://tingwu.${config.region}.aliyuncs.com/api/ws/v1?taskId=${taskId}` 
    });
  } catch (error: any) {
    console.error('[听悟] 创建实时任务失败:', error);
    return NextResponse.json(
      { 
        error: '创建实时任务失败', 
        details: error.message || '未知错误',
      },
      { status: 500 }
    );
  }
}