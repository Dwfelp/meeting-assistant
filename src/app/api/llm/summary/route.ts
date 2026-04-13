import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  try {
    const { transcriptWindow, previousSummary } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!apiKey || !baseURL) {
      console.error('[LLM API] 配置缺失');
      return NextResponse.json(
        { error: 'LLM 服务未配置，请检查环境变量' },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey, baseURL });

    // 格式化转录内容
    const formattedTranscript = transcriptWindow
      .map((line: string, i: number) => `${i + 1}. ${line}`)
      .join('\n');

    // 检测语言
    const hasChinese = /[\u4e00-\u9fa5]/.test(formattedTranscript);
    const isEnglish = /[a-zA-Z]/.test(formattedTranscript) && formattedTranscript.length > 50;
    
    console.log('[LLM API] 检测到语言:', hasChinese ? '中文' : isEnglish ? '英文' : '未知');

    // 格式化历史摘要
    let previousSummaryText = '无';
    if (previousSummary && previousSummary !== 'none') {
      try {
        const parsed = JSON.parse(previousSummary);
        if (parsed.topics?.length || parsed.decisions?.length) {
          previousSummaryText = `- 主题: ${parsed.topics?.join(', ') || '无'}\n- 决策: ${parsed.decisions?.join(', ') || '无'}\n- 行动: ${parsed.nextActions?.join(', ') || '无'}\n- 风险: ${parsed.risks?.join(', ') || '无'}\n- 摘要: ${parsed.summaryText || '无'}`;
        }
      } catch {
        previousSummaryText = previousSummary;
      }
    }

    // 根据语言选择不同的 Prompt
    let prompt: string;
    
    if (hasChinese) {
      // 中文会议 Prompt - 新增 summaryText 和 actionItems
      prompt = `你是一个专业的会议摘要助手。你的任务是根据会议对话记录，提取关键信息并以严格JSON格式返回。

## 输出格式要求
{
  "summaryText": "一句话概括本次会议的核心内容和结论",
  "topics": ["主题1", "主题2", ...],
  "decisions": ["决策1", "决策2", ...],
  "nextActions": ["行动1", "行动2", ...],
  "risks": ["风险1", "风险2", ...],
  "actionItems": [
    {"owner": "张三", "due": "周五前", "description": "完成项目报告"},
    {"owner": "李四", "due": "明天", "description": "审核代码"}
  ]
}

## 数量限制
- summaryText: 1-2句话，不超过50字
- topics: 最多5个核心主题
- decisions: 最多3个团队达成的一致结论
- nextActions: 最多4个明确的后续步骤
- risks: 最多3个提到的障碍或风险
- actionItems: 最多5个具体的行动项

## 提取规则
1. **摘要(summaryText)**：用1-2句话概括会议最核心的内容、结论或下一步方向
2. **主题(topics)**：提取对话中反复出现或占据主要篇幅的话题，使用2-6个字的短语
3. **决策(decisions)**：必须是团队达成的共识，包含"决定"、"同意"、"确认"、"定下来"等关键词
4. **行动(nextActions)**：必须有明确的责任人或时间节点，包含"会"、"将"、"需要"、"周五前"等关键词
5. **风险(risks)**：包括时间压力、资源不足、技术难点、依赖阻塞、外部因素等
6. **行动项(actionItems)**：提取具体的待办事项，owner从对话中提取人名（如"张三"、"Alice"），due为截止时间（如"今天下午"、"周五前"、"明天"或null），description为行动描述
7. **空数组处理**：如果某个类别完全没有相关内容，返回空数组 []
8. **简洁性原则**：每个条目控制在15个字以内，只提取明确陈述的内容
9. **不推断原则**：不要基于上下文推断未明确表达的内容

## 之前的摘要（供参考，避免重复）
${previousSummaryText}

## 会议对话记录
${formattedTranscript}

## 重要提醒
- 只输出纯JSON，不要有任何解释性文字
- JSON必须是有效的、可解析的格式
- 使用双引号，不要使用单引号

请直接输出JSON：`;
    } else {
      // 英文/通用内容 Prompt - 新增 summaryText 和 actionItems
      prompt = `You are a meeting summary assistant. Analyze the following conversation and extract key information in JSON format.

## Output Format
{
  "summaryText": "One sentence summarizing the main point of this meeting",
  "topics": ["topic1", "topic2", ...],
  "decisions": ["decision1", "decision2", ...],
  "nextActions": ["action1", "action2", ...],
  "risks": ["risk1", "risk2", ...],
  "actionItems": [
    {"owner": "John", "due": "by Friday", "description": "Finish the report"},
    {"owner": "Jane", "due": null, "description": "Review the code"}
  ]
}

## Rules
- summaryText: One concise sentence summarizing the meeting (max 50 words)
- topics: Extract main themes or recurring subjects (max 5)
- decisions: Extract any conclusions or agreements reached (max 3)
- nextActions: Extract any planned actions or next steps (max 4)
- risks: Extract any obstacles, challenges, or concerns mentioned (max 3)
- actionItems: Extract specific to-dos with owner (person name) and due date if mentioned (max 5)
- Return empty array [] if a category has no content
- Keep each item concise (under 20 words)

## Previous Summary (for reference)
${previousSummaryText}

## Content to Analyze
${formattedTranscript}

## Important
- Output ONLY valid JSON, no explanation
- Use double quotes, not single quotes

Output JSON directly:`;
    }

    console.log('[LLM API] 开始调用 LLM...');

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: hasChinese 
            ? '你是一个专业的会议摘要助手。你只输出JSON格式的会议摘要，不输出任何其他内容。'
            : 'You are a meeting summary assistant. Output only valid JSON, no other text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 2000,  // 增加 token 以容纳新字段
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      console.error('[LLM API] 返回内容为空');
      return NextResponse.json({ 
        success: true, 
        summaryText: '',
        topics: [], 
        decisions: [], 
        nextActions: [], 
        risks: [],
        actionItems: []
      });
    }

    console.log('[LLM API] 原始响应:', text.substring(0, 500));

    // 解析 JSON
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.warn('[LLM API] JSON 解析失败，尝试提取嵌入JSON...');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (nestedError) {
          console.error('[LLM API] 嵌套JSON解析失败，返回空结果');
          return NextResponse.json({ 
            success: true, 
            summaryText: '',
            topics: [], 
            decisions: [], 
            nextActions: [], 
            risks: [],
            actionItems: []
          });
        }
      } else {
        console.error('[LLM API] JSON 解析失败，返回空结果');
        return NextResponse.json({ 
          success: true, 
          summaryText: '',
          topics: [], 
          decisions: [], 
          nextActions: [], 
          risks: [],
          actionItems: []
        });
      }
    }

    // 提取并验证各字段
    const result = {
      summaryText: typeof parsed.summaryText === 'string' ? parsed.summaryText.slice(0, 200) : '',
      topics: (parsed.topics || []).slice(0, 5).filter((t: string) => t && t.trim()),
      decisions: (parsed.decisions || []).slice(0, 3).filter((d: string) => d && d.trim()),
      nextActions: (parsed.nextActions || []).slice(0, 4).filter((a: string) => a && a.trim()),
      risks: (parsed.risks || []).slice(0, 3).filter((r: string) => r && r.trim()),
      actionItems: (parsed.actionItems || [])
        .slice(0, 5)
        .filter((item: any) => item && item.description && item.description.trim())
        .map((item: any) => ({
          owner: typeof item.owner === 'string' ? item.owner.trim() : '',
          due: item.due === null || typeof item.due === 'string' ? item.due : null,
          description: item.description.trim()
        }))
    };

    console.log(`[LLM API] 生成成功: 摘要=${result.summaryText ? '有' : '无'}, 主题=${result.topics.length}, 决策=${result.decisions.length}, 行动=${result.nextActions.length}, 风险=${result.risks.length}, 行动项=${result.actionItems.length}`);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[LLM API] 错误:', error);
    return NextResponse.json({ 
      success: true, 
      summaryText: '',
      topics: [], 
      decisions: [], 
      nextActions: [], 
      risks: [],
      actionItems: []
    });
  }
}