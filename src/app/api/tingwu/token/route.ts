// src/app/api/tingwu/token/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  // 返回一个占位 Token，实际 WebSocket 连接时会通过 TaskId 鉴权
  // 这里为了保持前端代码兼容，返回一个模拟值
  return NextResponse.json({
    token: 'placeholder',
    appKey: process.env.TINGWU_APP_KEY || '',
    expireTime: Date.now() + 3600000,
  });
}