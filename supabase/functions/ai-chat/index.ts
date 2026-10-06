import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { ASSISTANTS } from './assistants.ts';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-3.6-flash';

interface Attachment {
  name: string;
  mime: string;
  /** data URL (images) or plain text (text files) */
  data: string;
  kind: 'image' | 'text';
}

interface InMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

interface Body {
  messages: InMessage[];
  assistant?: string;
}

const MAX_MESSAGES = 40;

function toGatewayMessage(m: InMessage) {
  const atts = m.attachments ?? [];
  if (m.role !== 'user' || atts.length === 0) {
    return { role: m.role, content: m.content };
  }
  const parts: unknown[] = [];
  const textFiles = atts.filter((a) => a.kind === 'text');
  const images = atts.filter((a) => a.kind === 'image');
  const text =
    m.content +
    (textFiles.length
      ? '\n\n' +
        textFiles
          .map((f) => `--- file: ${f.name} ---\n${f.data.slice(0, 40000)}`)
          .join('\n\n')
      : '');
  parts.push({ type: 'text', text: text || '(no text)' });
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img.data } });
  }
  return { role: m.role, content: parts };
}

async function callGateway(payload: unknown, apiKey: string, attempt = 0): Promise<Response> {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Lovable-API-Key': apiKey,
      'X-Lovable-AIG-SDK': 'fetch',
    },
    body: JSON.stringify(payload),
  });

  // No artificial cooldown: keep retrying transient upstream rate limits
  // and server errors until the gateway accepts the request. Provider-side
  // limits, credits, and outages still apply.
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30000)
      : Math.min(500 * Math.pow(2, Math.min(attempt, 6)), 30000);

    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, backoff));
    return callGateway(payload, apiKey, attempt + 1);
  }
  return res;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'AI is not configured.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const raw = (await req.json().catch(() => null)) as Partial<Body> | null;
    if (!raw || !Array.isArray(raw.messages) || raw.messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages[] is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Instructions, model and temperature are server-owned; the caller only picks an assistant id.
    const assistantId = typeof raw.assistant === 'string' && ASSISTANTS[raw.assistant] ? raw.assistant : 'general';
    const spec = ASSISTANTS[assistantId];

    // Only user/assistant roles are accepted from the caller; anything else is dropped.
    const clean: InMessage[] = [];
    for (const m of raw.messages.slice(-MAX_MESSAGES)) {
      if (!m || typeof m !== 'object') continue;
      const role = (m as InMessage).role;
      const content = (m as InMessage).content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
      const atts = Array.isArray((m as InMessage).attachments)
        ? (m as InMessage).attachments!.filter(
            (a) => a && (a.kind === 'image' || a.kind === 'text') && typeof a.data === 'string' && typeof a.name === 'string',
          ).slice(0, 10)
        : [];
      clean.push({ role, content: content.slice(0, 100000), attachments: role === 'user' ? atts : [] });
    }
    if (!clean.length) {
      return new Response(JSON.stringify({ error: 'messages[] is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const messages = [
      { role: 'system', content: spec.systemPrompt },
      ...clean.map(toGatewayMessage),
    ];

    const res = await callGateway(
      {
        model: spec.model || DEFAULT_MODEL,
        messages,
        stream: true,
        ...(typeof spec.temperature === 'number' ? { temperature: spec.temperature } : {}),
      },
      apiKey,
    );

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      const message =
        res.status === 429
          ? 'Rate limit reached — please wait a moment and try again.'
          : res.status === 402
            ? 'AI credits exhausted. Add credits to keep chatting.'
            : `AI service error (${res.status}). ${detail.slice(0, 300)}`;
      return new Response(JSON.stringify({ error: message }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Convert the upstream SSE stream into a plain text token stream.
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 1);
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                /* partial chunk — ignore */
              }
            }
          }
        } catch (err) {
          controller.enqueue(encoder.encode(`\n\n_[stream error: ${String(err)}]_`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
