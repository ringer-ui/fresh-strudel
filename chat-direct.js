// Browser-direct chat transport for the public build: no server, the visitor's own API key.
// The key lives only in this browser and is sent only to api.anthropic.com. Yields the same events as /api/chat:
//   {type:'text', delta} {type:'code', code, summary} {type:'error', message} {type:'done'}
import { SYSTEM, UPDATE_CODE_TOOL, buildMessages, modelParams } from './chat-prompt.mjs';

const API = 'https://api.anthropic.com/v1/messages';

function describeHttpError(status, body) {
  const detail = body?.error?.message ?? '';
  if (status === 401) return 'Anthropic rejected that API key (401). Check it and paste it again.';
  if (status === 403) return 'That API key is not allowed to use this model (403).';
  if (status === 429) return 'Rate limited by Anthropic. Wait a moment and try again.';
  if (status === 400 && /credit balance/i.test(detail)) return 'Your Anthropic account is out of credit.';
  if (status >= 500) return `Anthropic is having trouble (${status}). Try again shortly.`;
  return `Anthropic API error ${status}${detail ? ': ' + detail : ''}`;
}

export async function* streamChat({ messages: turns, code, context, apiKey, signal, model }) {
  const messages = buildMessages(turns, { code, context });
  if (!messages) { yield { type: 'error', message: 'Nothing to send.' }; return; }
  const { betas, ...params } = modelParams(model);            // params include fallbacks for the models that use it
  let res;
  try {
    res = await fetch(API, {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',   // required by Anthropic for calls straight from a browser
        ...(betas ? { 'anthropic-beta': betas.join(',') } : {}),
      },
      body: JSON.stringify({ ...params, system: SYSTEM, tools: [UPDATE_CODE_TOOL], tool_choice: { type: 'auto' }, stream: true, messages }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    yield { type: 'error', message: 'Could not reach the Anthropic API. Check your connection.' };
    return;
  }
  if (!res.ok) {
    let body = null; try { body = await res.json(); } catch { /* not JSON */ }
    yield { type: 'error', message: describeHttpError(res.status, body) };
    return;
  }

  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', toolJson = '', inTool = false, stop = null, failed = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split('\n').find((l) => l.startsWith('data: '));
      if (!data) continue;
      let ev; try { ev = JSON.parse(data.slice(6)); } catch { continue; }
      if (ev.type === 'content_block_start') inTool = ev.content_block?.type === 'tool_use' && ev.content_block.name === 'update_code';
      else if (ev.type === 'content_block_delta') {
        if (ev.delta?.type === 'text_delta') yield { type: 'text', delta: ev.delta.text };
        else if (ev.delta?.type === 'input_json_delta' && inTool) toolJson += ev.delta.partial_json ?? '';
      } else if (ev.type === 'message_delta') stop = ev.delta?.stop_reason ?? stop;
      else if (ev.type === 'error') failed = ev.error?.message ?? 'Unknown error from the API.';
    }
  }
  if (failed) { yield { type: 'error', message: failed }; return; }
  if (toolJson) {
    let input = null; try { input = JSON.parse(toolJson); } catch { /* truncated */ }
    if (stop === 'max_tokens' || !input) yield { type: 'error', message: 'The reply was cut off before the song was finished, so nothing was changed. Try a smaller request.' };
    else if (typeof input.code === 'string' && input.code.trim()) yield { type: 'code', code: input.code, summary: String(input.summary ?? '') };
  } else if (stop === 'refusal') yield { type: 'error', message: 'Claude declined that request.' };
  yield { type: 'done' };
}
