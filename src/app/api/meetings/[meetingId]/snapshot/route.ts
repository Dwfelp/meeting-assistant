// src/app/api/meetings/[meetingId]/snapshot/route.ts
import { NextRequest, NextResponse } from 'next/server';

const meetingsStore = new Map<string, any>();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  try {
    const { meetingId } = await params;
    let meeting = meetingsStore.get(meetingId);
    
    // 🔥 如果会议不存在，返回空会议（而不是404）
    if (!meeting) {
      console.log('[Snapshot API] 会议不存在，返回空会议:', meetingId);
      meeting = {
        id: meetingId,
        transcript: [],
        participants: [],
        actions: [],
        summary: { topics: [], decisions: [], nextActions: [], risks: [], updatedAt: new Date().toISOString() },
        sentiments: [],
        createdAt: new Date().toISOString(),
        title: '新会议'
      };
    }
    
    return NextResponse.json({ meeting });
  } catch (error) {
    console.error('[Snapshot API] 错误:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}