// src/app/api/meetings/[meetingId]/events/route.ts
import { NextRequest, NextResponse } from 'next/server';

// 全局存储（实际项目应使用数据库）
const meetingsStore = new Map<string, any>();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  try {
    const { meetingId } = await params;
    const body = await request.json();
    const { speakerName, text, language, isFinal, translatedText } = body;  // ✅ 添加 translatedText
    
    console.log('[Events API] 收到请求:', { 
      meetingId, 
      speakerName, 
      text: text?.substring(0, 50),
      hasTranslation: !!translatedText  // ✅ 日志
    });
    
    // 如果会议不存在，自动创建
    let meeting = meetingsStore.get(meetingId);
    if (!meeting) {
      console.log('[Events API] 会议不存在，自动创建:', meetingId);
      meeting = {
        id: meetingId,
        transcript: [],
        participants: [],
        actions: [],
        summary: { topics: [], briefPoints: [], decisions: [], nextActions: [], risks: [], updatedAt: new Date().toISOString() },
        sentiments: [],
        createdAt: new Date().toISOString(),
        title: '新会议'
      };
      meetingsStore.set(meetingId, meeting);
    }
    
    // 添加转录记录（包含译文）
    const newSegment = {
      id: Date.now().toString(),
      meetingId,
      speakerName,
      speakerId: speakerName,
      text,
      language,
      translatedText: translatedText || '',  // ✅ 存储译文
      startMs: 0,
      endMs: 0,
      isFinal: true,
      createdAt: new Date().toISOString()
    };
    
    meeting.transcript.push(newSegment);
    
    // 更新参与者列表
    if (!meeting.participants.includes(speakerName)) {
      meeting.participants.push(speakerName);
    }
    
    console.log('[Events API] 已添加转录，当前总数:', meeting.transcript.length);
    
    return NextResponse.json({ meeting, success: true });
  } catch (error) {
    console.error('[Events API] 错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}