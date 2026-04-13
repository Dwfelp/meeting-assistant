// src/app/api/tingwu/debug/route.ts
import { NextResponse } from 'next/server';
import { getTingwuConfig } from '@/lib/tingwu/config';

export async function GET() {
  const config = getTingwuConfig();
  
  return NextResponse.json({
    configured: !!config,
    accessKeyId: config?.accessKeyId ? `${config.accessKeyId.substring(0, 8)}...` : 'missing',
    accessKeySecret: config?.accessKeySecret ? 'present' : 'missing',
    appKey: config?.appKey || 'missing',
    appKeyLength: config?.appKey?.length || 0,
    region: config?.region || 'missing',
    ossBucket: config?.ossBucket || 'missing',
  });
}