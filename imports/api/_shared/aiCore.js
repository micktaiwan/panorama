import { Meteor } from 'meteor/meteor';
import { getOpenAiApiKey } from '/imports/api/_shared/config';

// Normalize multi-line text to a single line
export const toOneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Shared helpers for AI calls
export const OPENAI_MODEL = 'o4-mini';

const pad2 = (n) => String(n).padStart(2, '0');

export const localIsoWithOffset = (d) => {
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const hh = pad2(Math.floor(abs / 60));
  const mm = pad2(abs % 60);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${sign}${hh}:${mm}`;
};

export const formatAnchors = (now, since) => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const nowLocalIso = localIsoWithOffset(now);
  const sinceLocalIso = localIsoWithOffset(since);
  const startLocal = `${pad2(since.getHours())}:${pad2(since.getMinutes())}`;
  const endLocal = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return { tz, sinceLocalIso, nowLocalIso, startLocal, endLocal };
};

export const buildEntriesBlock = (logs) => (logs || []).map(l => {
  const iso = new Date(l.createdAt).toISOString();
  return `- { id: ${l._id} } [${iso}] ${toOneLine(l.content || '')}`;
}).join('\n');

export const buildProjectsBlock = (catalog) => catalog.map(p => `- { id: ${p.id}, name: ${p.name}${p.description ? `, desc: ${p.description}` : ''} }`).join('\n');

export async function openAiChat({ system, user, expectJson, schema }) {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Meteor.Error('config-missing', 'OpenAI API key missing in settings');
  const { default: fetch } = await import('node-fetch');
  const body = expectJson
    ? { model: OPENAI_MODEL, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ], response_format: { type: 'json_schema', json_schema: { name: 'userlog_summary', strict: false, schema } } }
    : { model: OPENAI_MODEL, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ] };
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[openAiChat] request failed', { status: resp.status, statusText: resp.statusText, body: errText });
    throw new Meteor.Error('openai-failed', errText);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || (expectJson ? '{}' : '');
  if (!expectJson) return String(content || '');
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error('[openAiChat] invalid JSON', { content, error: err && err.message });
    throw new Meteor.Error('openai-invalid-json', 'Invalid JSON content from model');
  }
}
