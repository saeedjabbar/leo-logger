import { DefaultAzureCredential } from '@azure/identity';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { calculateInsights } from './analytics.js';
import type { EventInput } from './events.js';
import type { Baby, BabyEvent } from './types.js';

const credential = new DefaultAzureCredential();

const modelResultSchema = z.object({
  mode: z.enum(['log', 'insight', 'both', 'clarify']),
  reply: z.string().min(1).max(2000),
  clarificationNeeded: z.boolean(),
  events: z.array(z.object({
    type: z.enum(['feed', 'diaper', 'sleep']),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime().nullable(),
    ounces: z.number().min(0).max(64).nullable(),
    source: z.enum(['formula', 'breast_milk', 'combo']).nullable(),
    diaper: z.enum(['pee', 'poop', 'both']).nullable(),
    notes: z.string().max(500).nullable(),
  })).max(6),
});

export type ChatModelResult = z.infer<typeof modelResultSchema>;

function eventForModel(event: BabyEvent) {
  return {
    type: event.type, startAt: event.startAt, endAt: event.endAt,
    ounces: event.feed?.ounces, source: event.feed?.source, diaper: event.diaper, notes: event.notes,
  };
}

function modelContext(events: BabyEvent[], baby: Baby, now: Date) {
  const active = events.filter((event) => event.babyId === baby.id && !event.deletedAt).sort((a, b) => b.startAt.localeCompare(a.startAt));
  const insights = calculateInsights(active, baby.id, new Date(now.getTime() - 180 * 86_400_000), now, baby.timezone);
  return JSON.stringify({
    baby: { name: baby.name, timezone: baby.timezone, feedingIntervalMinutes: baby.feedingIntervalMinutes },
    summaryLast180Days: { totals: insights.totals, feedIntervals: insights.feedIntervals, daily: insights.daily },
    recentEvents: active.slice(0, 150).map(eventForModel),
  });
}

const outputSchema = {
  type: 'object', additionalProperties: false,
  required: ['mode', 'reply', 'clarificationNeeded', 'events'],
  properties: {
    mode: { type: 'string', enum: ['log', 'insight', 'both', 'clarify'] },
    reply: { type: 'string' }, clarificationNeeded: { type: 'boolean' },
    events: { type: 'array', maxItems: 6, items: {
      type: 'object', additionalProperties: false,
      required: ['type', 'startAt', 'endAt', 'ounces', 'source', 'diaper', 'notes'],
      properties: {
        type: { type: 'string', enum: ['feed', 'diaper', 'sleep'] }, startAt: { type: 'string' },
        endAt: { type: ['string', 'null'] }, ounces: { type: ['number', 'null'] },
        source: { type: ['string', 'null'], enum: ['formula', 'breast_milk', 'combo', null] },
        diaper: { type: ['string', 'null'], enum: ['pee', 'poop', 'both', null] }, notes: { type: ['string', 'null'] },
      },
    } },
  },
};

export function azureChatConfigured() {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_DEPLOYMENT);
}

export async function interpretWithAzure(message: string, baby: Baby, events: BabyEvent[], now = new Date()): Promise<ChatModelResult> {
  if (!azureChatConfigured()) throw new Error('Azure OpenAI is not configured');
  const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
  if (!token) throw new Error('Azure managed identity could not get an AI token');
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/$/, '');
  const response = await fetch(`${endpoint}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        { role: 'system', content: `You are Leo Logger, a careful baby activity logger and descriptive data analyst. Current UTC time: ${now.toISOString()}. Baby timezone: ${baby.timezone}. Extract only activities the user clearly says happened. If an activity has no time, use the current time. Resolve relative and 12-hour times in the baby's timezone and output UTC ISO 8601. Formula is the default milk source. Never invent ounces or times. If required details are missing, set clarificationNeeded and create no uncertain event. For questions, answer only from the supplied baby data, be concise, distinguish observations from conclusions, and never give medical diagnosis or advice. A request may both log and ask for insight.` },
        { role: 'system', content: `Authorized baby data:\n${modelContext(events, baby, now)}` },
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'baby_logger_action', strict: true, schema: outputSchema } },
    }),
  });
  if (!response.ok) throw new Error(`Azure OpenAI request failed (${response.status})`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('Azure OpenAI returned no result');
  return modelResultSchema.parse(JSON.parse(content));
}

function fallbackTime(message: string, timezone: string, now: Date) {
  const localNow = DateTime.fromJSDate(now, { zone: timezone });
  const relative = message.match(/(\d+)\s*(?:minute|min)s?\s+ago/i);
  if (relative) return localNow.minus({ minutes: Number(relative[1]) }).toUTC().toISO()!;
  const match = message.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!match) return now.toISOString();
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase().replaceAll('.', '');
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  let candidate = localNow.set({ hour, minute, second: 0, millisecond: 0 });
  if (candidate > localNow.plus({ minutes: 5 })) candidate = candidate.minus({ days: 1 });
  return candidate.toUTC().toISO()!;
}

export function interpretFallback(message: string, baby: Baby, now = new Date()): ChatModelResult {
  const lower = message.toLowerCase();
  const startAt = fallbackTime(message, baby.timezone, now);
  const amount = message.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounce|ounces)\b/i);
  if (/\b(fed|feed|drank|bottle)\b/.test(lower)) {
    if (!amount) return { mode: 'clarify', clarificationNeeded: true, events: [], reply: 'How many ounces did the baby drink?' };
    const ounces = Number(amount[1]);
    const source = lower.includes('breast') ? 'breast_milk' : lower.includes('combo') || lower.includes('mixed') ? 'combo' : 'formula';
    return { mode: 'log', clarificationNeeded: false, reply: `Logged ${ounces} oz of ${source.replace('_', ' ')}.`, events: [{ type: 'feed', startAt, endAt: null, ounces, source, diaper: null, notes: null }] };
  }
  const hasPee = /\b(pee|peed|wet diaper)\b/.test(lower);
  const hasPoop = /\b(poop|pooped|poo|dirty diaper)\b/.test(lower);
  if (hasPee || hasPoop) {
    const diaper = hasPee && hasPoop ? 'both' : hasPoop ? 'poop' : 'pee';
    return { mode: 'log', clarificationNeeded: false, reply: `Logged ${diaper === 'both' ? 'pee and poop' : diaper}.`, events: [{ type: 'diaper', startAt, endAt: null, ounces: null, source: null, diaper, notes: null }] };
  }
  return { mode: 'clarify', clarificationNeeded: true, events: [], reply: azureChatConfigured() ? 'I could not understand that. Try including the activity and time.' : 'AI insights are not configured. You can still say things like “fed him 2 oz at 2:10am” or “he pooped 10 minutes ago.”' };
}

export function toEventInputs(result: ChatModelResult, babyId: string, requestId: string): EventInput[] {
  const inputs: EventInput[] = [];
  result.events.forEach((event, index) => {
    const start = new Date(event.startAt);
    if (!Number.isFinite(start.getTime()) || start.getTime() > Date.now() + 5 * 60_000 || start.getTime() < Date.now() - 366 * 86_400_000) return;
    if (event.type === 'feed' && event.ounces !== null) inputs.push({ babyId, type: 'feed', startAt: event.startAt, feed: { ounces: event.ounces, source: event.source || 'formula' }, notes: event.notes || undefined, clientMutationId: `${requestId}:${index}` });
    else if (event.type === 'diaper' && event.diaper) inputs.push({ babyId, type: 'diaper', startAt: event.startAt, diaper: event.diaper, notes: event.notes || undefined, clientMutationId: `${requestId}:${index}` });
    else if (event.type === 'sleep') inputs.push({ babyId, type: 'sleep', startAt: event.startAt, endAt: event.endAt || undefined, notes: event.notes || undefined, clientMutationId: `${requestId}:${index}` });
  });
  return inputs;
}
