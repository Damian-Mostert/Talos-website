// app/api/llm/route.ts
// Server-side proxy to Groq. Holds the real API key — never sent to the client.
// llm.js (browser/agent side) posts { messages, jsonMode, numPredict } here instead
// of calling Groq directly.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL         = 'llama-3.1-8b-instant';
const API_KEY       = process.env.GROQ_API_KEY; // server-only — do NOT prefix with NEXT_PUBLIC_
const TIMEOUT       = 20000;

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    console.error('[api/llm] GROQ_API_KEY is not set');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { messages, jsonMode = false, numPredict = 400 } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'missing "messages"' }, { status: 400 });
  }

  const groqBody: Record<string, any> = {
    model:       MODEL,
    messages,
    stream:      false,
    max_tokens:  Math.min(Number(numPredict) || 400, 180),
    temperature: 0.2,
  };
  if (jsonMode) groqBody.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${API_KEY}`,
      },
      signal: controller.signal,
      body:   JSON.stringify(groqBody),
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') || '5';
      return NextResponse.json(
        { error: 'rate limited' },
        { status: 429, headers: { 'retry-after': retryAfter } }
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[api/llm] groq HTTP ${res.status}`, text);
      return NextResponse.json({ error: `upstream HTTP ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    // Pass through the OpenAI-compatible shape unchanged so llm.js's parsing
    // (data.choices[0].message.content) keeps working without modification.
    return NextResponse.json(data);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'upstream timeout' }, { status: 504 });
    }
    console.error('[api/llm] fetch failed', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}