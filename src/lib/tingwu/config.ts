// src/lib/tingwu/config.ts
export interface TingwuConfig {
  accessKeyId: string;
  accessKeySecret: string;
  appKey: string;
  region: string;
  ossBucket: string;
  ossEndpoint: string;
}

export function getTingwuConfig(): TingwuConfig | null {
  const accessKeyId = process.env.TINGWU_ACCESS_KEY_ID;
  const accessKeySecret = process.env.TINGWU_ACCESS_KEY_SECRET;
  const appKey = process.env.TINGWU_APP_KEY;
  const region = process.env.TINGWU_REGION || 'cn-shanghai';
  const ossBucket = process.env.OSS_BUCKET || '';
  const ossEndpoint = process.env.OSS_ENDPOINT || `oss-${region}.aliyuncs.com`;

  // 详细日志
  console.log('[听悟配置检查]', {
    hasAccessKeyId: !!accessKeyId,
    hasAccessKeySecret: !!accessKeySecret,
    hasAppKey: !!appKey,
    region,
    hasOssBucket: !!ossBucket,
    ossEndpoint,
  });

  if (!accessKeyId || !accessKeySecret || !appKey) {
    console.error('[听悟] 配置缺失:', {
      accessKeyId: !!accessKeyId,
      accessKeySecret: !!accessKeySecret,
      appKey: !!appKey,
    });
    return null;
  }

  // 如果没有 OSS Bucket，只影响文件上传，不影响实时转写
  if (!ossBucket) {
    console.warn('[听悟] OSS Bucket 未配置，文件上传功能将不可用');
  }

  return { 
    accessKeyId, 
    accessKeySecret, 
    appKey, 
    region, 
    ossBucket, 
    ossEndpoint 
  };
}

export function isTingwuConfigured(): boolean {
  const config = getTingwuConfig();
  return config !== null;
}