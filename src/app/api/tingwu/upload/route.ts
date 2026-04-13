// src/app/api/tingwu/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getTingwuConfig } from '@/lib/tingwu/config';
import { writeFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
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

export async function POST(request: NextRequest) {
  console.log('[听悟] 收到上传请求');
  
  const config = getTingwuConfig();
  
  if (!config) {
    return NextResponse.json({ error: '听悟未配置，请检查.env.local' }, { status: 503 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: '未找到文件' }, { status: 400 });
    }

    console.log('[听悟] 收到文件:', file.name, file.size, 'bytes');

    // 1. 保存临时文件
    const buffer = Buffer.from(await file.arrayBuffer());
    const tempFileName = `${randomUUID()}-${file.name}`;
    const tempFilePath = join(tmpdir(), tempFileName);
    await writeFile(tempFilePath, buffer);
    console.log('[听悟] 临时文件保存成功:', tempFilePath);

    // 2. 上传到 OSS
    let OSS: any;
    try {
      const OSSModule = await import('ali-oss');
      OSS = (OSSModule as any).default || OSSModule;
    } catch (error) {
      console.error('[听悟] 无法加载 ali-oss 模块');
      await unlink(tempFilePath).catch(() => {});
      return NextResponse.json({ error: '服务端配置错误，缺少 ali-oss 依赖' }, { status: 500 });
    }

    const ossClient = new OSS({
      region: config.region,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.ossBucket,
      endpoint: config.ossEndpoint,
    });
    
    const ossKey = `tingwu/audio/${tempFileName}`;
    await ossClient.put(ossKey, tempFilePath);
    const fileUrl = `https://${config.ossBucket}.${config.ossEndpoint}/${ossKey}`;
    console.log('[听悟] 文件已上传到 OSS:', fileUrl);

    // 3. 调用听悟 API - 离线任务（启用说话人分离）
    const body = {
      AppKey: config.appKey,
      Input: {
        FileUrl: fileUrl,
        SourceLanguage: "cn"
      },
      Parameters: {
        Transcription: {
          DiarizationEnabled: true,
          Diarization: {
            SpeakerCount: 0
          }
        }
      }
    };

    const bodyStr = JSON.stringify(body);
    const date = new Date().toUTCString();
    const pathname = '/openapi/tingwu/v2/tasks?type=offline';
    
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

    console.log('[听悟] 离线任务请求 URL:', `https://tingwu.${config.region}.aliyuncs.com${pathname}`);
    console.log('[听悟] 离线任务请求体:', bodyStr);

    const response = await fetch(
      `https://tingwu.${config.region}.aliyuncs.com${pathname}`,
      {
        method: 'PUT',
        headers,
        body: bodyStr,
      }
    );

    const data = await response.json();
    console.log('[听悟] 离线任务响应:', JSON.stringify(data, null, 2));

    // 4. 清理临时文件
    await unlink(tempFilePath).catch(() => {});

    if (!response.ok) {
      throw new Error(data.Message || `HTTP ${response.status}`);
    }

    const taskId = data.Data?.TaskId;

    if (!taskId) {
      throw new Error('返回数据缺少 TaskId');
    }

    console.log('[听悟] 任务创建成功, TaskId:', taskId);
    return NextResponse.json({ taskId, success: true });
  } catch (error: any) {
    console.error('[听悟] 上传失败:', error);
    return NextResponse.json(
      { error: error.message || '上传失败', success: false },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: '请使用 POST 方法上传文件' }, { status: 405 });
}