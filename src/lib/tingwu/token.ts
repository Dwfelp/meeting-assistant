// 获取阿里云听悟临时Token

import { getTingwuConfig } from './config';

// 获取临时Token（通过后端API）
export async function getTingwuToken(): Promise<string | null> {
  try {
    const response = await fetch('/api/tingwu/token');
    if (!response.ok) {
      throw new Error(`获取Token失败: ${response.status}`);
    }
    const data = await response.json();
    return data.token;
  } catch (error) {
    console.error('[听悟] 获取Token失败:', error);
    return null;
  }
}

// 构建WebSocket URL
export function buildWebSocketUrl(token: string, appKey: string): string {
  const region = process.env.TINGWU_REGION || 'cn-shanghai';
  // 听悟正式 WebSocket 地址
  return `wss://tingwu.${region}.aliyuncs.com/api/ws/v1?token=${token}&appkey=${appKey}`;
}