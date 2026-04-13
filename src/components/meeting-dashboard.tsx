"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Meeting } from "@/types/meeting";
import { Activity, CheckCircle2, Languages, Mic, Sparkles, Users } from "lucide-react";
import { VoiceAssistant } from "@/components/voice-assistant";
import { generateSummaryWithLlm } from "@/lib/llm-client";
import { inferDueDate } from "@/lib/analysis";

async function createMeeting(title: string) {
  const res = await fetch("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    throw new Error("创建会议失败");
  }

  const data = (await res.json()) as { meeting: Meeting };
  return data.meeting;
}

// ✅ 新增：翻译函数
async function translateText(text: string, targetLang: string = 'zh'): Promise<string | null> {
  if (!text || text.trim().length === 0) return null;
  
  // 检测是否已经是中文（如果目标是中文且原文已经是中文）
  const chineseRegex = /[\u4e00-\u9fa5]/;
  if (targetLang === 'zh' && chineseRegex.test(text)) {
    return text; // 中文原文直接返回
  }
  
  try {
    const response = await fetch('/api/llm/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang })
    });
    const data = await response.json();
    return data.translation || null;
  } catch (error) {
    console.error('[翻译] 失败:', error);
    return null;
  }
}

async function postSegment(meetingId: string, speakerName: string, text: string, language: string, translatedText?: string) {
  const res = await fetch(`/api/meetings/${meetingId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speakerName, text, language, isFinal: true, translatedText }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "提交发言失败");
  }

  const data = await res.json();
  return data.meeting as Meeting;
}

async function fetchSnapshot(meetingId: string) {
  const res = await fetch(`/api/meetings/${meetingId}/snapshot`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("获取会议快照失败");
  }

  const data = (await res.json()) as { meeting: Meeting };
  return data.meeting;
}

export function MeetingDashboard() {
  const initialTitleRef = useRef("产品周会 - 智能助手演示");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [meetingTitle, setMeetingTitle] = useState(initialTitleRef.current);
  const [speakerName, setSpeakerName] = useState("Alice");
  const [language, setLanguage] = useState("zh");
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [enableTranslation, setEnableTranslation] = useState(true); // ✅ 新增：翻译开关

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const created = await createMeeting(initialTitleRef.current);
        if (!cancelled) {
          setMeeting(created);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "初始化失败");
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const sentimentOverview = useMemo(() => {
    const sentiments = meeting?.sentiments ?? [];
    if (!sentiments.length) {
      return "暂无显著情绪波动";
    }

    const latest = sentiments[sentiments.length - 1];
    return `最近信号：${latest.label}（强度 ${latest.intensity.toFixed(2)}）`;
  }, [meeting?.sentiments]);

  async function handleSubmitSegment() {
    if (!meeting?.id || !text.trim()) return;

    setError(null);
    setIsSubmitting(true);
    try {
      // ✅ 如果需要翻译，先翻译
      let translatedText = '';
      if (enableTranslation && language === 'en') {
        const translation = await translateText(text.trim(), 'zh');
        translatedText = translation || '';
      }
      
      const updatedMeeting = await postSegment(meeting.id, speakerName, text.trim(), language, translatedText);
      setMeeting(updatedMeeting);
      setText("");

      const transcriptTexts = updatedMeeting.transcript.map(
        seg => `${seg.speakerName}: ${seg.text}`
      );
      const hasServerSummary = updatedMeeting.summary?.topics?.length || updatedMeeting.summary?.decisions?.length || updatedMeeting.summary?.nextActions?.length || updatedMeeting.summary?.risks?.length;
      if (!hasServerSummary) {
        await generateAndUpdateSummary(transcriptTexts);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  // 生成并更新摘要的函数
  const generateAndUpdateSummary = async (transcriptTexts: string[]) => {
    if (isGeneratingSummary) return;
    
    if (!transcriptTexts || transcriptTexts.length === 0) {
      console.log('[LLM] 没有转录内容，跳过');
      return;
    }
    
    setIsGeneratingSummary(true);
    
    console.log('[LLM] 开始生成摘要，共', transcriptTexts.length, '条');
    
    try {
      const result = await generateSummaryWithLlm({
        transcriptWindow: transcriptTexts,
        previousSummary: meeting?.summary ? JSON.stringify(meeting.summary) : undefined
      });
      
      if (result) {
        console.log('[LLM] 生成成功:', result);
        
        setMeeting(prev => {
          if (!prev) return prev;
          
          const newActions = (result.nextActions || []).map((action, index) => ({
              id: `action_${Date.now()}_${index}_${Math.random()}`,
              meetingId: prev.id,
              sourceSegmentId: '',
              description: action,
              owner: null,
              dueDate: inferDueDate(action),
              status: 'pending_confirmation' as const,
              confidence: 0.8
            }));
          
          const existingDescriptions = new Set(prev.actions.map(a => a.description));
          const uniqueNewActions = newActions.filter(a => !existingDescriptions.has(a.description));
          const allActions = [...prev.actions, ...uniqueNewActions];
          
          return {
            ...prev,
            summary: {
              summaryText: result.summaryText,
              topics: result.topics || [],
              decisions: result.decisions || [],
              nextActions: result.nextActions || [],
              risks: result.risks || [],
              updatedAt: new Date().toISOString()
            },
            actions: allActions
          };
        });
      }
    } catch (error) {
      console.error('[LLM] 生成失败:', error);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // ✅ 核心修改：处理语音转录回调，自动翻译
  const handleVoiceTranscript = async (speakerName: string, text: string) => {
    console.log('[UI] 收到语音转录:', { speakerName, text });
    
    // 如果没有会议，先创建会议
    let currentMeeting = meeting;
    if (!currentMeeting?.id) {
      console.log('[UI] 会议不存在，正在创建...');
      try {
        currentMeeting = await createMeeting(meetingTitle || '新会议');
        setMeeting(currentMeeting);
      } catch (e) {
        console.error('[UI] 创建会议失败:', e);
        setError('创建会议失败，请刷新页面重试');
        return;
      }
    }
    
    if (!currentMeeting?.id) return;
    
    setInterimText("");
    
    // ✅ 如果需要翻译，调用翻译 API
    let translatedText = '';
    if (enableTranslation) {
      // 检测语言：如果原文包含中文，不需要翻译；否则翻译成中文
      const hasChinese = /[\u4e00-\u9fa5]/.test(text);
      if (!hasChinese) {
        console.log('[UI] 开始翻译:', text.substring(0, 50));
        try {
          const translation = await translateText(text, 'zh');
          translatedText = translation || '';
          console.log('[UI] 翻译结果:', translatedText);
        } catch (e) {
          console.error('[UI] 翻译失败:', e);
        }
      } else {
        translatedText = text; // 中文原文
      }
    }
    
    // 先更新 UI（乐观更新）
    const newSegment = {
      id: `temp_${Date.now()}_${Math.random()}`,
      meetingId: currentMeeting.id,
      speakerName: speakerName,
      speakerId: 'unknown',
      text: text,
      language: language,
      translatedText: translatedText,
      startMs: 0,
      endMs: 0,
      isFinal: true,
      createdAt: new Date().toISOString()
    };
    
    setMeeting(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        transcript: [...prev.transcript, newSegment]
      };
    });
    
    try {
      // 保存到后端（带上译文）
      const updatedMeeting = await postSegment(currentMeeting.id, speakerName, text, language, translatedText);
      console.log('[UI] 后端保存成功', updatedMeeting);
      setMeeting(updatedMeeting);

      const transcriptTexts = updatedMeeting.transcript.map(seg => `${seg.speakerName}: ${seg.text}`);
      const hasServerSummary = updatedMeeting.summary?.topics?.length || updatedMeeting.summary?.decisions?.length || updatedMeeting.summary?.nextActions?.length || updatedMeeting.summary?.risks?.length;

      if (!hasServerSummary) {
        await generateAndUpdateSummary(transcriptTexts);
      }
    } catch (e) {
      console.error('[UI] 保存失败:', e);
      setError(e instanceof Error ? e.message : "语音提交失败");
      // 回滚 UI
      setMeeting(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          transcript: prev.transcript.filter(seg => seg.id !== newSegment.id)
        };
      });
    }
  };

  const handleInterimUpdate = (text: string) => {
    setInterimText(text);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-sky-50 to-cyan-100 p-4 md:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.15),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(6,182,212,0.16),transparent_25%),radial-gradient(circle_at_30%_80%,rgba(16,185,129,0.12),transparent_26%)]" />
      <div className="relative mx-auto grid w-full max-w-7xl gap-4 md:gap-6">
        <Card className="border-sky-200/70 bg-white/85 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
              <Sparkles className="size-5 text-sky-600" />
              智能会议助手
            </CardTitle>
            <CardDescription>实时转录、滚动摘要、行动项提取与情绪分析（MVP）</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} disabled={Boolean(meeting)} />
            <Button 
              onClick={async () => {
                if (meeting) return;
                const created = await createMeeting(meetingTitle);
                setMeeting(created);
              }}
              disabled={Boolean(meeting)}
            >
              创建会议
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card className="bg-white/90 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mic className="size-4 text-sky-600" />
                实时输入
              </CardTitle>
              <CardDescription>语音输入或手动输入</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <VoiceAssistant 
                meetingId={meeting?.id || null} 
                onTranscriptReceived={handleVoiceTranscript}
                onInterimUpdate={handleInterimUpdate}
              />
              
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-background px-2 text-muted-foreground">或手动输入</span>
                </div>
              </div>
              
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={speakerName} onChange={(e) => setSpeakerName(e.target.value)} placeholder="发言人" />
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="语言代码，例如 zh/en" />
              </div>
              
              {/* ✅ 新增：翻译开关 */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enableTranslation"
                  checked={enableTranslation}
                  onChange={(e) => setEnableTranslation(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <label htmlFor="enableTranslation" className="text-sm text-muted-foreground">
                  启用自动翻译（英译中）
                </label>
              </div>
              
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="输入一句发言，例如：我将在周五前发送报告。"
                className="min-h-28"
              />
              <div className="flex items-center gap-3">
                <Button onClick={handleSubmitSegment} disabled={!mounted || !meeting || isSubmitting || !text.trim()}>
                  发送到实时管道
                </Button>
                {error ? <span className="text-sm text-red-600">{error}</span> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/90 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="size-4 text-sky-600" />
                会议状态
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">Meeting ID</span>
                <Badge variant="secondary">{meeting?.id ?? "未创建"}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">参与者</span>
                <span className="font-medium">{meeting?.participants.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">转录段数</span>
                <span className="font-medium">{meeting?.transcript.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">行动项</span>
                <span className="font-medium">{meeting?.actions.length ?? 0}</span>
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-muted-foreground">情绪概览</p>
                <p className="font-medium">{sentimentOverview}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">实时洞察</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="transcript" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="transcript" className="flex items-center gap-1"><Users className="size-4" />转录</TabsTrigger>
                <TabsTrigger value="summary" className="flex items-center gap-1"><Sparkles className="size-4" />摘要</TabsTrigger>
                <TabsTrigger value="actions" className="flex items-center gap-1"><CheckCircle2 className="size-4" />行动项</TabsTrigger>
                <TabsTrigger value="translation" className="flex items-center gap-1"><Languages className="size-4" />翻译视图</TabsTrigger>
              </TabsList>

              <TabsContent value="transcript" className="mt-4">
                <ScrollArea className="h-72 rounded-md border p-3">
                  <div className="space-y-3">
                    {interimText && (
                      <div className="rounded-lg border bg-sky-50/50 p-3">
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="bg-sky-100">正在识别</Badge>
                          <span>实时转录中...</span>
                        </div>
                        <p className="text-sm leading-6 italic text-sky-700">{interimText}</p>
                      </div>
                    )}
                    {(meeting?.transcript ?? []).slice().reverse().map((seg) => (
                      <div key={seg.id} className="rounded-lg border bg-muted/40 p-3">
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{seg.speakerName}</Badge>
                          <span>{seg.language}</span>
                          <span>{new Date(seg.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-sm leading-6">{seg.text}</p>
                        {/* ✅ 如果有译文且与原文不同，显示译文 */}
                        {seg.translatedText && seg.translatedText !== seg.text && (
                          <p className="text-sm leading-6 text-sky-600 mt-1 border-t pt-1">
                            📝 {seg.translatedText}
                          </p>
                        )}
                      </div>
                    ))}
                    {meeting?.transcript.length === 0 && !interimText && (
                      <p className="text-center text-sm text-muted-foreground py-8">
                        暂无内容，点击麦克风开始语音识别
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="summary" className="mt-4 grid gap-4 md:grid-cols-2">
                {/* ✅ 新增：一段话总结显示 */}
                {meeting?.summary.summaryText && (
                  <div className="rounded-lg border p-3 md:col-span-2 bg-sky-50">
                    <h3 className="mb-2 text-sm font-semibold">会议摘要</h3>
                    <p className="text-sm">{meeting.summary.summaryText}</p>
                  </div>
                )}
                <div className="rounded-lg border p-3">
                  <h3 className="mb-2 text-sm font-semibold">关键主题</h3>
                  <div className="flex flex-wrap gap-2">
                    {(meeting?.summary.topics ?? []).map((topic) => (
                      <Badge key={topic} variant="secondary">{topic}</Badge>
                    ))}
                    {meeting?.summary.topics?.length === 0 && !isGeneratingSummary && (
                      <span className="text-sm text-muted-foreground">暂无主题</span>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <h3 className="mb-2 text-sm font-semibold">决策与后续</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(meeting?.summary.decisions ?? []).map((item, idx) => (
                      <li key={`d-${idx}`}>• {item}</li>
                    ))}
                    {(meeting?.summary.nextActions ?? []).map((item, idx) => (
                      <li key={`n-${idx}`}>• {item}</li>
                    ))}
                    {meeting?.summary.decisions?.length === 0 && meeting?.summary.nextActions?.length === 0 && !isGeneratingSummary && (
                      <li className="text-muted-foreground">暂无决策或行动项</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-lg border p-3 md:col-span-2">
                  <h3 className="mb-2 text-sm font-semibold">风险与挑战</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(meeting?.summary.risks ?? []).map((item, idx) => (
                      <li key={`r-${idx}`}>• {item}</li>
                    ))}
                    {meeting?.summary.risks?.length === 0 && !isGeneratingSummary && (
                      <li className="text-muted-foreground">暂无识别到的风险</li>
                    )}
                  </ul>
                </div>
                {isGeneratingSummary && (
                  <div className="col-span-2 text-center text-sm text-muted-foreground py-4">
                    正在生成摘要...
                  </div>
                )}
              </TabsContent>

              <TabsContent value="actions" className="mt-4">
                <div className="rounded-lg border p-3">
                  <div className="space-y-3">
                    {(meeting?.actions ?? []).map((a) => (
                      <div key={a.id} className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-sm font-medium">{a.description}</p>
                        <Separator className="my-2" />
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">Owner: {a.owner ?? "待确认"}</Badge>
                          <Badge variant="outline">Due: {a.dueDate ?? "未识别"}</Badge>
                          <Badge variant="outline">Confidence: {a.confidence.toFixed(2)}</Badge>
                        </div>
                      </div>
                    ))}
                    {(meeting?.actions ?? []).length === 0 && !isGeneratingSummary && (
                      <p className="text-sm text-muted-foreground">暂未识别到行动项。摘要中的行动项会显示在上方"摘要"标签页。</p>
                    )}
                    {isGeneratingSummary && (
                      <p className="text-sm text-muted-foreground">正在生成摘要和行动项...</p>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="translation" className="mt-4">
                <div className="rounded-lg border p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">双语对照视图</h3>
                    <Badge variant="outline" className="text-xs">
                      自动翻译 {meeting?.transcript.filter(seg => seg.translatedText).length || 0} 条
                    </Badge>
                  </div>
                  <div className="space-y-3 max-h-96 overflow-auto">
                    {(meeting?.transcript ?? []).slice().reverse().map((seg) => (
                      <div key={`trans-${seg.id}`} className="rounded-lg border bg-muted/20 p-3">
                        <div className="mb-2">
                          <span className="text-xs font-medium text-muted-foreground">原文</span>
                          <p className="text-sm">
                            <span className="font-medium text-foreground">{seg.speakerName}：</span>
                            <span>{seg.text}</span>
                          </p>
                        </div>
                        {/* ✅ 显示译文 */}
                        <div className="border-t pt-2">
                          <span className="text-xs font-medium text-muted-foreground">译文</span>
                          <p className="text-sm text-sky-600">
                            {seg.translatedText ? (
                              seg.translatedText
                            ) : (
                              <span className="italic text-muted-foreground/60">
                                {seg.language === 'zh' ? '（中文原文）' : '翻译中...'}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                    {meeting?.transcript.length === 0 && (
                      <p className="text-center text-sm text-muted-foreground py-8">
                        暂无内容，发送消息后会显示原文和译文
                      </p>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}