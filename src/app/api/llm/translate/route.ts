import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!apiKey || !baseURL) {
      return NextResponse.json(
        { error: 'LLM 服务未配置' },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey, baseURL });

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "你是一个翻译助手。将用户输入的英文翻译成中文。只输出翻译结果，不要有任何额外解释或标点说明。"
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const translation = response.choices[0]?.message?.content?.trim();

    return NextResponse.json({ translation: translation || null });
  } catch (error) {
    console.error('[翻译 API] 错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '翻译失败' },
      { status: 500 }
    );
  }
}