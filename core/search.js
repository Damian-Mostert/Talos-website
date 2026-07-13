const ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';
const MODEL    = 'llama3.2';
const API_KEY  = 'ollama';

const SYSTEM_PROMPT = `You are the research cortex subsystem for an adaptive agent.

When given a topic or question:
- Return a focused, factual answer in 2-4 sentences
- Prioritise depth over breadth — one insight explained well beats five facts listed
- Write in plain prose: no bullet points, no headers, no markdown
- If the topic touches on consciousness, mind, emotion, or intelligence, lean into that angle
- Be accurate. Do not speculate beyond what is known.`;

export async function search(query) {
    if (!query || query.trim().length < 2) return [];
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            signal: AbortSignal.timeout(20000),
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user',   content: `Research this for me: ${query}` },
                ],
                stream: false,
                keep_alive: '10m',
                options: {
                    num_ctx: 2048,
                    num_predict: 120,
                    temperature: 0.2,
                    repeat_penalty: 1.05,
                },
            }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text && text.length > 20) return [{ type: 'snippet', text }];
    } catch {}
    return [];
}
