// src/app/api/tingwu/task/[taskId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTingwuConfig } from '@/lib/tingwu/config';
import * as crypto from 'crypto';

export const runtime = 'nodejs';

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
  
  return crypto
    .createHmac('sha1', accessKeySecret)
    .update(stringToSign)
    .digest('base64');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  console.log('[听悟-查询] API 被调用');
  
  const config = getTingwuConfig();
  if (!config) {
    return NextResponse.json({ error: '听悟未配置' }, { status: 503 });
  }

  try {
    const { taskId } = await params;
    console.log('[听悟-查询] 任务ID:', taskId);

    if (!taskId) {
      return NextResponse.json({ error: '缺少任务ID' }, { status: 400 });
    }

    // 查询任务状态
    const pathname = `/openapi/tingwu/v2/tasks/${taskId}`;
    const date = new Date().toUTCString();
    
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Date': date,
      'Host': `tingwu.${config.region}.aliyuncs.com`,
    };

    const signature = generateRoaSignature(
      config.accessKeySecret,
      'GET',
      pathname,
      headers,
      ''
    );
    headers['Authorization'] = `acs ${config.accessKeyId}:${signature}`;

    const url = `https://tingwu.${config.region}.aliyuncs.com${pathname}`;
    console.log('[听悟-查询] 请求URL:', url);

    const response = await fetch(url, { method: 'GET', headers });
    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseError) {
      console.error('[听悟-查询] JSON解析失败');
      return NextResponse.json({ status: 'ERROR', error: '服务器返回格式错误' }, { status: 500 });
    }

    if (!response.ok) {
      throw new Error(data.Message || `HTTP ${response.status}`);
    }

    const taskStatus = data.Data?.TaskStatus;
    const taskResult = data.Data?.Result;

    console.log('[听悟-查询] 任务状态:', taskStatus);

    if (taskStatus === 'COMPLETED') {
      let sentences: Array<{ speakerId: string; text: string }> = [];
      
      if (taskResult?.Transcription) {
        const transcriptionUrl = taskResult.Transcription;
        console.log('[听悟-查询] 下载转写结果:', transcriptionUrl);
        
        try {
          const transcriptionResponse = await fetch(transcriptionUrl);
          const transcriptionText = await transcriptionResponse.text();
          const transcriptionData = JSON.parse(transcriptionText);
          
          console.log('[听悟-查询] 转写数据结构:', Object.keys(transcriptionData));
          
          // 🔥 关键修复：真正的数据在 Transcription 字段里
          let actualData = transcriptionData;
          if (transcriptionData.Transcription) {
            actualData = transcriptionData.Transcription;
            console.log('[听悟-查询] 使用 Transcription 字段，其结构:', Object.keys(actualData));
          }
          
          // 解析 Paragraphs
          if (actualData.Paragraphs && actualData.Paragraphs.length > 0) {
            for (const para of actualData.Paragraphs) {
              const speakerId = para.SpeakerId || 'unknown';
              if (para.Words && para.Words.length > 0) {
                const text = para.Words.map((word: any) => word.Text || '').join('');
                if (text.trim()) {
                  sentences.push({
                    speakerId: speakerId,
                    text: text
                  });
                }
              }
            }
          } else if (actualData.Sentences && actualData.Sentences.length > 0) {
            for (const sentence of actualData.Sentences) {
              sentences.push({
                speakerId: sentence.SpeakerId || 'unknown',
                text: sentence.Text || ''
              });
            }
          }
          
          console.log('[听悟-查询] 解析到句子数:', sentences.length);
          if (sentences.length > 0) {
            console.log('[听悟-查询] 第一句示例:', sentences[0]);
          }
        } catch (downloadError) {
          console.error('[听悟-查询] 下载转写结果失败:', downloadError);
        }
      }
      
      return NextResponse.json({ status: 'SUCCESS', sentences, taskId });
    } 
    
    if (taskStatus === 'FAILED') {
      return NextResponse.json({ status: 'FAILED', error: data.Data?.ErrorMessage || '任务失败' });
    }
    
    return NextResponse.json({ status: 'PROCESSING', taskStatus: taskStatus || 'ONGOING' });
    
  } catch (error: any) {
    console.error('[听悟-查询] 失败:', error);
    return NextResponse.json({ error: error.message, status: 'ERROR' }, { status: 500 });
  }
}