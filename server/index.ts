import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createVerify, X509Certificate } from 'node:crypto';
import { z } from 'zod';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { createStore } from './store.js';
import { authMiddleware, issueSession, logout, publicUser, requireAdmin, requireUser } from './auth.js';
import { hashSecret, verifySecret } from './security.js';
import { eventInputSchema, createEvent, reviseEvent, canAccessBaby, canEditEvent, validateEventDetails } from './events.js';
import { calculateInsights } from './analytics.js';
import { importHuckleberry } from './importer.js';
import type { Baby, BabyEvent, Challenge, Passkey, PushSubscriptionRecord, Session, User } from './types.js';
import { pushSubscriptionId, remindersConfigured, startReminderScheduler } from './reminders.js';
import { azureChatConfigured, interpretFallback, interpretWithAzure, toEventInputs } from './chat.js';
import { azureSpeechConfigured, transcribeWav } from './speech.js';

const store = createStore();
const app = express();
const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const rpID = process.env.RP_ID || new URL(origin).hostname;
const attempts = new Map<string, { count: number; resetAt: number }>();
const alexaCertificates = new Map<string, { pem: string; expiresAt: number }>();
const eventStreams = new Map<string, Set<express.Response>>();

function publishBabyUpdate(babyId: string, action: 'created' | 'updated' | 'deleted' | 'imported') {
  const message = `event: events\ndata: ${JSON.stringify({ action, at: new Date().toISOString() })}\n\n`;
  for (const stream of eventStreams.get(babyId) || []) stream.write(message);
}

declare global {
  namespace Express { interface Request { rawBody?: Buffer } }
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({
  limit: '2mb',
  verify: (request, _response, buffer) => {
    const expressRequest = request as express.Request;
    if (expressRequest.originalUrl === '/api/alexa') expressRequest.rawBody = Buffer.from(buffer);
  },
}));
app.use(cookieParser());
app.use(authMiddleware(store));

app.use('/api', (request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.path === '/alexa') return next();
  const requestOrigin = request.get('origin');
  if (requestOrigin && requestOrigin !== origin) return response.status(403).json({ error: 'Invalid request origin' });
  next();
});

function rateLimited(key: string) {
  const now = Date.now();
  const value = attempts.get(key);
  if (!value || value.resetAt < now) { attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 }); return false; }
  value.count += 1;
  return value.count > 8;
}

async function verifyAlexaRequest(request: express.Request) {
  if (process.env.ALEXA_DISABLE_SIGNATURE_VERIFICATION === 'true' && process.env.NODE_ENV !== 'production') return true;
  const reject = (reason: string, details: Record<string, unknown> = {}) => {
    console.warn(JSON.stringify({ level: 'warn', message: 'Alexa request rejected', reason, ...details }));
    return false;
  };
  const signature = request.get('signature');
  const certificateUrl = request.get('signaturecertchainurl');
  if (!signature || !certificateUrl || !request.rawBody) {
    return reject('missing_verification_headers', {
      hasSignature: Boolean(signature),
      hasCertificateUrl: Boolean(certificateUrl),
      hasRawBody: Boolean(request.rawBody),
    });
  }
  let url: URL;
  try { url = new URL(certificateUrl); } catch { return reject('invalid_certificate_url'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 's3.amazonaws.com' || (url.port && url.port !== '443') || !url.pathname.startsWith('/echo.api/')) {
    return reject('untrusted_certificate_url', { certificateHost: url.hostname, certificatePath: url.pathname });
  }
  let cached = alexaCertificates.get(certificateUrl);
  try {
    if (!cached || cached.expiresAt < Date.now()) {
      const result = await fetch(certificateUrl);
      if (!result.ok) return reject('certificate_download_failed', { status: result.status });
      const pem = await result.text();
      const certificate = new X509Certificate(pem);
      if (!certificate.checkHost('echo-api.amazon.com')) return reject('certificate_hostname_mismatch');
      if (new Date(certificate.validFrom) > new Date() || new Date(certificate.validTo) < new Date()) return reject('certificate_expired');
      cached = { pem, expiresAt: Math.min(new Date(certificate.validTo).getTime(), Date.now() + 24 * 60 * 60_000) };
      alexaCertificates.set(certificateUrl, cached);
    }
    const verifier = createVerify('RSA-SHA1');
    verifier.update(request.rawBody); verifier.end();
    if (!verifier.verify(cached.pem, signature, 'base64')) return reject('signature_mismatch');
  } catch (error) {
    return reject('certificate_verification_error', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
  const timestamp = request.body?.request?.timestamp;
  if (!timestamp || !Number.isFinite(new Date(timestamp).getTime())) return reject('invalid_timestamp');
  if (Math.abs(Date.now() - new Date(timestamp).getTime()) > 150_000) return reject('stale_timestamp');
  return true;
}

async function bootstrap() {
  await store.initialize();
  const storedUsers = await store.list<User>('users');
  const users: User[] = [];
  for (const user of storedUsers) {
    if ((user.role as string) === 'master_admin') {
      const migrated: User = { ...user, role: 'admin' };
      await store.put('users', migrated.id, migrated);
      users.push(migrated);
    } else users.push(user);
  }
  let babies = await store.list<Baby>('babies');
  if (!babies.length) {
    const leo: Baby = { id: randomUUID(), name: 'Leo', timezone: 'America/New_York', feedingIntervalMinutes: 120, active: true, createdAt: new Date().toISOString() };
    await store.put('babies', leo.id, leo);
    babies = [leo];
  }
  for (const baby of babies) {
    if (!baby.feedingIntervalMinutes) {
      baby.feedingIntervalMinutes = 120;
      await store.put('babies', baby.id, baby);
    }
  }
  if (!users.length) {
    const password = process.env.BOOTSTRAP_PASSWORD;
    if (!password || password.length < 12) throw new Error('BOOTSTRAP_PASSWORD of at least 12 characters is required on first startup');
    const entries = (process.env.BOOTSTRAP_ADMINS || 'admin@example.com:Admin').split(',');
    for (const entry of entries) {
      const [email, displayName] = entry.split(':');
      const user: User = {
        id: randomUUID(), role: 'admin', email: email.toLowerCase(), displayName: displayName || email,
        passwordHash: await hashSecret(password), allowedBabyIds: babies.map((baby) => baby.id), defaultBabyId: babies[0].id,
        mustChangePassword: true, active: true, createdAt: new Date().toISOString(),
      };
      await store.put('users', user.id, user);
    }
  }
}

app.get('/health', (_request, response) => response.json({ status: 'ok' }));

app.post('/api/auth/password', async (request, response) => {
  const result = z.object({ email: z.email(), password: z.string().min(1) }).safeParse(request.body);
  if (!result.success) return response.status(400).json({ error: 'Enter a valid email and password' });
  const key = `${request.ip}:${result.data.email.toLowerCase()}`;
  if (rateLimited(key)) return response.status(429).json({ error: 'Too many attempts. Try again later.' });
  const user = (await store.list<User>('users')).find((item) => item.email?.toLowerCase() === result.data.email.toLowerCase() && item.active);
  if (!user || !await verifySecret(result.data.password, user.passwordHash)) return response.status(401).json({ error: 'Email or password is incorrect' });
  await issueSession(store, user, request, response);
  response.json({ user: publicUser(user) });
});

app.post('/api/auth/pin', async (request, response) => {
  const result = z.object({ pin: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
  if (!result.success) return response.status(400).json({ error: 'Enter the six-digit PIN' });
  if (rateLimited(`${request.ip}:pin`)) return response.status(429).json({ error: 'Too many attempts. Try again later.' });
  const caregivers = (await store.list<User>('users')).filter((item) => item.role === 'caregiver' && item.active);
  let matched: User | undefined;
  for (const caregiver of caregivers) if (await verifySecret(result.data.pin, caregiver.pinHash)) { matched = caregiver; break; }
  if (!matched) return response.status(401).json({ error: 'That PIN was not recognized' });
  await issueSession(store, matched, request, response);
  response.json({ user: publicUser(matched) });
});

app.post('/api/auth/logout', requireUser, async (request, response) => { await logout(store, request, response); response.json({ ok: true }); });

app.post('/api/auth/password/change', requireAdmin, async (request, response) => {
  const result = z.object({ currentPassword: z.string(), newPassword: z.string().min(12) }).safeParse(request.body);
  if (!result.success || !request.currentUser) return response.status(400).json({ error: 'New password must be at least 12 characters' });
  if (!await verifySecret(result.data.currentPassword, request.currentUser.passwordHash)) return response.status(401).json({ error: 'Current password is incorrect' });
  const updated = { ...request.currentUser, passwordHash: await hashSecret(result.data.newPassword), mustChangePassword: false };
  await store.put('users', updated.id, updated);
  response.json({ user: publicUser(updated) });
});

app.get('/api/me', requireUser, async (request, response) => {
  const [babies, events] = await Promise.all([store.list<Baby>('babies'), store.list<BabyEvent>('events')]);
  const user = request.currentUser!;
  const allowed = babies.filter((baby) => baby.active && canAccessBaby(user, baby.id));
  const activeSleep = events.find((event) => allowed.some((baby) => baby.id === event.babyId) && event.type === 'sleep' && !event.endAt && !event.deletedAt);
  response.json({ user: publicUser(user), babies: allowed, activeSleep });
});

app.patch('/api/me/preferences', requireUser, async (request, response) => {
  const parsed = z.object({ uprightTimerEnabled: z.boolean() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Invalid caregiver preference' });
  const user = { ...request.currentUser!, ...parsed.data };
  await store.put('users', user.id, user);
  response.json({ user: publicUser(user) });
});

app.get('/api/reminders/config', requireUser, (_request, response) => {
  response.json({ configured: remindersConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

app.post('/api/reminders/subscribe', requireUser, async (request, response) => {
  const parsed = z.object({
    endpoint: z.url(), expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(20), auth: z.string().min(8) }),
  }).safeParse(request.body);
  if (!parsed.success || !remindersConfigured()) return response.status(400).json({ error: remindersConfigured() ? 'Invalid notification subscription' : 'Notifications are not configured' });
  const id = pushSubscriptionId(parsed.data.endpoint);
  const subscription: PushSubscriptionRecord = { id, userId: request.currentUser!.id, ...parsed.data, createdAt: new Date().toISOString() };
  await store.put('pushSubscriptions', id, subscription);
  response.status(201).json({ subscribed: true });
});

app.delete('/api/reminders/subscribe', requireUser, async (request, response) => {
  const parsed = z.object({ endpoint: z.url() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Invalid notification subscription' });
  const id = pushSubscriptionId(parsed.data.endpoint);
  const subscription = await store.get<PushSubscriptionRecord>('pushSubscriptions', id);
  if (subscription?.userId === request.currentUser!.id || request.currentUser!.role === 'admin') await store.remove('pushSubscriptions', id);
  response.json({ subscribed: false });
});

app.post('/api/auth/passkeys/register/options', requireAdmin, async (request, response) => {
  const user = request.currentUser!;
  const keys = (await store.list<Passkey>('passkeys')).filter((key) => key.userId === user.id);
  const options = await generateRegistrationOptions({
    rpName: 'Leo Logger', rpID, userName: user.email!, userDisplayName: user.displayName,
    attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: keys.map((key) => ({ id: key.id, transports: key.transports as AuthenticatorTransportFuture[] })),
  });
  const challenge: Challenge = { id: randomUUID(), userId: user.id, challenge: options.challenge, kind: 'registration', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  await store.put('challenges', challenge.id, challenge);
  response.json({ challengeId: challenge.id, options });
});

app.post('/api/auth/passkeys/register/verify', requireAdmin, async (request, response) => {
  const parsed = z.object({ challengeId: z.string().uuid(), response: z.any() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Invalid passkey response' });
  const challenge = await store.get<Challenge>('challenges', parsed.data.challengeId);
  if (!challenge || challenge.userId !== request.currentUser!.id || challenge.kind !== 'registration' || new Date(challenge.expiresAt) < new Date()) return response.status(400).json({ error: 'Passkey setup expired' });
  const verification = await verifyRegistrationResponse({ response: parsed.data.response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID });
  if (!verification.verified || !verification.registrationInfo) return response.status(400).json({ error: 'Passkey could not be verified' });
  const info = verification.registrationInfo;
  const passkey: Passkey = { id: info.credential.id, userId: challenge.userId, publicKey: Buffer.from(info.credential.publicKey).toString('base64url'), counter: info.credential.counter, transports: info.credential.transports, deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp, createdAt: new Date().toISOString() };
  await store.put('passkeys', passkey.id, passkey);
  await store.remove('challenges', challenge.id);
  response.json({ verified: true });
});

app.post('/api/auth/passkeys/login/options', async (request, response) => {
  const parsed = z.object({ email: z.email() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Enter your email' });
  const user = (await store.list<User>('users')).find((item) => item.email?.toLowerCase() === parsed.data.email.toLowerCase() && item.active);
  if (!user) return response.status(404).json({ error: 'No passkey is registered for that email' });
  const keys = (await store.list<Passkey>('passkeys')).filter((key) => key.userId === user.id);
  if (!keys.length) return response.status(404).json({ error: 'No passkey is registered for that email' });
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: keys.map((key) => ({ id: key.id, transports: key.transports as AuthenticatorTransportFuture[] })) });
  const challenge: Challenge = { id: randomUUID(), userId: user.id, challenge: options.challenge, kind: 'authentication', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  await store.put('challenges', challenge.id, challenge);
  response.json({ challengeId: challenge.id, options });
});

app.post('/api/auth/passkeys/login/verify', async (request, response) => {
  const parsed = z.object({ challengeId: z.string().uuid(), response: z.any() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Invalid passkey response' });
  const challenge = await store.get<Challenge>('challenges', parsed.data.challengeId);
  const passkey = await store.get<Passkey>('passkeys', parsed.data.response?.id);
  if (!challenge || !passkey || passkey.userId !== challenge.userId || challenge.kind !== 'authentication' || new Date(challenge.expiresAt) < new Date()) return response.status(400).json({ error: 'Passkey login expired' });
  const verification = await verifyAuthenticationResponse({
    response: parsed.data.response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
    credential: { id: passkey.id, publicKey: Buffer.from(passkey.publicKey, 'base64url'), counter: passkey.counter, transports: passkey.transports as AuthenticatorTransportFuture[] },
  });
  if (!verification.verified) return response.status(401).json({ error: 'Passkey could not be verified' });
  await store.put('passkeys', passkey.id, { ...passkey, counter: verification.authenticationInfo.newCounter });
  const user = await store.get<User>('users', challenge.userId);
  if (!user?.active) return response.status(401).json({ error: 'Account is unavailable' });
  await issueSession(store, user, request, response);
  await store.remove('challenges', challenge.id);
  response.json({ user: publicUser(user) });
});

app.get('/api/events', requireUser, async (request, response) => {
  const user = request.currentUser!;
  const babyId = String(request.query.babyId || user.defaultBabyId || '');
  if (!canAccessBaby(user, babyId)) return response.status(403).json({ error: 'Access denied' });
  const limit = Math.min(Number(request.query.limit || 100), 1000);
  const events = (await store.list<BabyEvent>('events')).filter((event) => event.babyId === babyId && !event.deletedAt).sort((a, b) => b.startAt.localeCompare(a.startAt)).slice(0, limit);
  const users = await store.list<User>('users');
  response.json({ events, people: Object.fromEntries(users.map((person) => [person.id, person.displayName])) });
});

app.get('/api/events/stream', requireUser, (request, response) => {
  const user = request.currentUser!;
  const babyId = String(request.query.babyId || user.defaultBabyId || '');
  if (!canAccessBaby(user, babyId)) return response.status(403).json({ error: 'Access denied' });
  response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  response.flushHeaders();
  response.write('retry: 3000\n\nevent: ready\ndata: {}\n\n');
  const streams = eventStreams.get(babyId) || new Set<express.Response>();
  streams.add(response); eventStreams.set(babyId, streams);
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 25_000);
  request.on('close', () => {
    clearInterval(heartbeat); streams.delete(response);
    if (!streams.size) eventStreams.delete(babyId);
  });
});

app.post('/api/chat', requireUser, async (request, response) => {
  const parsed = z.object({ babyId: z.string().uuid(), message: z.string().trim().min(2).max(1000), inputMode: z.enum(['chat', 'voice']).default('chat') }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Enter a message for an allowed baby' });
  const user = request.currentUser!;
  if (!canAccessBaby(user, parsed.data.babyId)) return response.status(403).json({ error: 'Access denied' });
  const baby = await store.get<Baby>('babies', parsed.data.babyId);
  if (!baby?.active) return response.status(404).json({ error: 'Baby not found' });
  const events = await store.list<BabyEvent>('events');
  let result;
  let provider: 'azure-openai' | 'built-in' = 'azure-openai';
  try { result = await interpretWithAzure(parsed.data.message, baby, events); }
  catch (error) {
    provider = 'built-in';
    console.error(JSON.stringify({ level: 'warn', message: `AI interpretation unavailable: ${(error as Error).message}` }));
    result = interpretFallback(parsed.data.message, baby);
  }
  const requestId = randomUUID();
  const created: BabyEvent[] = [];
  if (!result.clarificationNeeded) for (const input of toEventInputs(result, baby.id, requestId)) {
    created.push(await createEvent(store, input, user, parsed.data.inputMode));
  }
  if (created.length) publishBabyUpdate(baby.id, 'created');
  response.json({ reply: result.reply, events: created, clarificationNeeded: result.clarificationNeeded, provider, aiConfigured: azureChatConfigured() });
});

app.get('/api/insights/ai', requireUser, async (request, response) => {
  const user = request.currentUser!;
  const babyId = String(request.query.babyId || user.defaultBabyId || '');
  const requestedDays = Number(request.query.days || 7);
  const days = Number.isInteger(requestedDays) ? Math.min(180, Math.max(1, requestedDays)) : 7;
  if (!canAccessBaby(user, babyId)) return response.status(403).json({ error: 'Access denied' });
  const baby = await store.get<Baby>('babies', babyId);
  if (!baby?.active) return response.status(404).json({ error: 'Baby not found' });
  const events = await store.list<BabyEvent>('events');
  let insight: string;
  let provider: 'azure-openai' | 'built-in' = 'azure-openai';
  try {
    const result = await interpretWithAzure(`Give the caregivers a warm, factual summary of the last ${days} days in at most 3 short sentences. Mention useful feeding, diaper, or sleep patterns only when supported by the data. Do not log an activity and do not give medical advice.`, baby, events);
    insight = result.reply;
  } catch (error) {
    provider = 'built-in';
    console.error(JSON.stringify({ level: 'warn', message: `AI caregiver insight unavailable: ${(error as Error).message}` }));
    const now = new Date();
    const stats = calculateInsights(events, baby.id, new Date(now.getTime() - days * 86_400_000), now, baby.timezone);
    insight = `Over the last ${days} days: ${stats.totals.feeds} feeds totaling ${stats.totals.ounces} oz, ${stats.totals.wet} wet diapers, ${stats.totals.dirty} dirty diapers, and ${stats.totals.sleepHours} hours of logged sleep.`;
  }
  response.setHeader('Cache-Control', 'private, no-store');
  response.json({ insight, provider, days, generatedAt: new Date().toISOString() });
});

app.post('/api/transcribe', requireUser, express.raw({ type: 'audio/wav', limit: '4mb' }), async (request, response) => {
  if (!azureSpeechConfigured()) return response.status(503).json({ error: 'Voice transcription is not configured' });
  try {
    const transcript = await transcribeWav(request.body as Buffer);
    response.json({ transcript });
  } catch (error) { response.status(400).json({ error: (error as Error).message }); }
});

app.post('/api/events', requireUser, async (request, response) => {
  const parsed = eventInputSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid event' });
  try {
    const event = await createEvent(store, parsed.data, request.currentUser!);
    publishBabyUpdate(event.babyId, 'created');
    response.status(201).json({ event });
  }
  catch (error) { response.status(400).json({ error: (error as Error).message }); }
});

app.patch('/api/events/:id', requireUser, async (request, response) => {
  const event = await store.get<BabyEvent>('events', String(request.params.id));
  if (!event || event.deletedAt) return response.status(404).json({ error: 'Event not found' });
  const parsed = eventInputSchema.pick({ startAt: true, endAt: true, feed: true, diaper: true, notes: true }).partial().safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid event' });
  const isCaregiverWake = request.currentUser!.role === 'caregiver' && event.type === 'sleep' && !event.endAt &&
    Object.keys(parsed.data).every((key) => key === 'endAt') && parsed.data.endAt && canAccessBaby(request.currentUser!, event.babyId);
  if (!canEditEvent(request.currentUser!, event) && !isCaregiverWake) return response.status(403).json({ error: 'You can only edit entries you logged' });
  const updated = { ...event, ...parsed.data, feed: parsed.data.feed || event.feed, updatedAt: new Date().toISOString() };
  try { validateEventDetails(updated); } catch (error) { return response.status(400).json({ error: (error as Error).message }); }
  await reviseEvent(store, event, request.currentUser!, 'update');
  await store.put('events', event.id, updated);
  publishBabyUpdate(event.babyId, 'updated');
  response.json({ event: updated });
});

app.delete('/api/events/:id', requireUser, async (request, response) => {
  const event = await store.get<BabyEvent>('events', String(request.params.id));
  if (!event || event.deletedAt) return response.status(404).json({ error: 'Event not found' });
  const user = request.currentUser!;
  const canUndo = event.createdBy === user.id && Date.now() - new Date(event.createdAt).getTime() <= 2 * 60_000;
  if (!canEditEvent(user, event)) return response.status(403).json({ error: 'You can only delete entries you logged' });
  await reviseEvent(store, event, user, canUndo ? 'undo' : 'delete');
  await store.put('events', event.id, { ...event, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  publishBabyUpdate(event.babyId, 'deleted');
  response.json({ ok: true });
});

app.get('/api/insights', requireAdmin, async (request, response) => {
  const babyId = String(request.query.babyId || request.currentUser!.defaultBabyId);
  const to = request.query.to ? new Date(String(request.query.to)) : new Date();
  const from = request.query.from ? new Date(String(request.query.from)) : new Date(to.getTime() - 30 * 86_400_000);
  const baby = await store.get<Baby>('babies', babyId);
  response.json(calculateInsights(await store.list<BabyEvent>('events'), babyId, from, to, baby?.timezone));
});

app.get('/api/admin/users', requireAdmin, async (_request, response) => response.json({ users: (await store.list<User>('users')).map(publicUser) }));

app.post('/api/admin/users', requireAdmin, async (request, response) => {
  const parsed = z.object({ displayName: z.string().min(1).max(80), pin: z.string().regex(/^\d{6}$/), allowedBabyIds: z.array(z.string().uuid()).min(1), defaultBabyId: z.string().uuid() }).safeParse(request.body);
  if (!parsed.success || !parsed.data.allowedBabyIds.includes(parsed.data.defaultBabyId)) return response.status(400).json({ error: 'Enter a name, unique six-digit PIN, and valid default baby' });
  for (const user of await store.list<User>('users')) if (user.pinHash && await verifySecret(parsed.data.pin, user.pinHash)) return response.status(409).json({ error: 'That PIN is already in use' });
  const user: User = { id: randomUUID(), role: 'caregiver', displayName: parsed.data.displayName, pinHash: await hashSecret(parsed.data.pin), allowedBabyIds: parsed.data.allowedBabyIds, defaultBabyId: parsed.data.defaultBabyId, active: true, createdAt: new Date().toISOString() };
  await store.put('users', user.id, user);
  response.status(201).json({ user: publicUser(user) });
});

app.patch('/api/admin/users/:id', requireAdmin, async (request, response) => {
  const user = await store.get<User>('users', String(request.params.id));
  if (!user) return response.status(404).json({ error: 'User not found' });
  const parsed = z.object({ displayName: z.string().min(1).max(80).optional(), active: z.boolean().optional(), allowedBabyIds: z.array(z.string().uuid()).optional(), defaultBabyId: z.string().uuid().optional(), pin: z.string().regex(/^\d{6}$/).optional() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Invalid user update' });
  const nextAllowed = parsed.data.allowedBabyIds || user.allowedBabyIds;
  const nextDefault = parsed.data.defaultBabyId || user.defaultBabyId;
  if (nextDefault && !nextAllowed.includes(nextDefault)) return response.status(400).json({ error: 'The default baby must be in the allowed list' });
  if (parsed.data.pin) for (const other of await store.list<User>('users')) {
    if (other.id !== user.id && other.pinHash && await verifySecret(parsed.data.pin, other.pinHash)) return response.status(409).json({ error: 'That PIN is already in use' });
  }
  if (user.role === 'admin' && parsed.data.active === false && (await store.list<User>('users')).filter((item) => item.role === 'admin' && item.active).length <= 1) return response.status(400).json({ error: 'The final admin cannot be disabled' });
  const updated: User = { ...user, ...parsed.data, pinHash: parsed.data.pin ? await hashSecret(parsed.data.pin) : user.pinHash };
  delete (updated as User & { pin?: string }).pin;
  await store.put('users', updated.id, updated);
  if (parsed.data.active === false) for (const session of await store.list<Session>('sessions')) if (session.userId === user.id) await store.remove('sessions', session.id);
  response.json({ user: publicUser(updated) });
});

app.get('/api/admin/babies', requireAdmin, async (_request, response) => response.json({ babies: await store.list<Baby>('babies') }));
app.post('/api/admin/babies', requireAdmin, async (request, response) => {
  const parsed = z.object({ name: z.string().min(1).max(80), birthDate: z.string().optional(), timezone: z.string().default('America/New_York'), feedingIntervalMinutes: z.number().int().min(15).max(720).default(120) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Enter a baby name' });
  try { new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone }); } catch { return response.status(400).json({ error: 'Invalid timezone' }); }
  const baby: Baby = { id: randomUUID(), ...parsed.data, active: true, createdAt: new Date().toISOString() };
  await store.put('babies', baby.id, baby);
  response.status(201).json({ baby });
});

app.patch('/api/admin/babies/:id', requireAdmin, async (request, response) => {
  const baby = await store.get<Baby>('babies', String(request.params.id));
  if (!baby) return response.status(404).json({ error: 'Baby not found' });
  const parsed = z.object({ name: z.string().min(1).max(80).optional(), birthDate: z.string().optional(), timezone: z.string().optional(), feedingIntervalMinutes: z.number().int().min(15).max(720).optional(), active: z.boolean().optional() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Feeding interval must be between 15 minutes and 12 hours' });
  if (parsed.data.timezone) try { new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone }); } catch { return response.status(400).json({ error: 'Invalid timezone' }); }
  const updated = { ...baby, ...parsed.data };
  await store.put('babies', baby.id, updated);
  response.json({ baby: updated });
});

app.post('/api/admin/import', requireAdmin, async (request, response) => {
  const parsed = z.object({ filename: z.string().min(1).max(200), content: z.string().min(1).max(2_000_000), babyId: z.string().uuid() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: 'Choose a valid CSV file and baby' });
  try {
    const result = await importHuckleberry(store, parsed.data.content, parsed.data.filename, parsed.data.babyId, request.currentUser!);
    if (result.imported) publishBabyUpdate(parsed.data.babyId, 'imported');
    response.json(result);
  }
  catch (error) { response.status(400).json({ error: `CSV import failed: ${(error as Error).message}` }); }
});

app.get('/api/admin/export.csv', requireAdmin, async (request, response) => {
  const babyId = String(request.query.babyId || request.currentUser!.defaultBabyId);
  const events = (await store.list<BabyEvent>('events')).filter((event) => event.babyId === babyId && !event.deletedAt);
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['Type', 'Start', 'End', 'Ounces', 'Feed Source', 'Diaper', 'Notes', 'Logged By', 'Channel'], ...events.map((event) => [event.type, event.startAt, event.endAt || '', event.feed?.ounces ?? '', event.feed?.source || '', event.diaper || '', event.notes || '', event.createdBy, event.channel])];
  response.type('text/csv').attachment('leo-logger-export.csv').send(rows.map((row) => row.map(escape).join(',')).join('\n'));
});

app.post('/api/alexa', async (request, response) => {
  const alexaRequestId = request.body?.request?.requestId;
  response.on('finish', () => {
    console.info(JSON.stringify({
      level: 'info',
      message: 'Alexa request handled',
      requestId: alexaRequestId,
      requestType: request.body?.request?.type,
      intent: request.body?.request?.intent?.name,
      status: response.statusCode,
    }));
  });
  if (!await verifyAlexaRequest(request)) return response.status(401).json({ error: 'Invalid Alexa request signature' });
  const skillId = request.body?.session?.application?.applicationId || request.body?.context?.System?.application?.applicationId;
  if (!process.env.ALEXA_SKILL_ID || skillId !== process.env.ALEXA_SKILL_ID) return response.status(403).json({ error: 'Unknown Alexa skill' });
  const requestType = request.body?.request?.type;
  const intent = request.body?.request?.intent;
  const users = await store.list<User>('users');
  const alexaUser = users.find((user) => user.email === process.env.ALEXA_USER_EMAIL);
  if (!alexaUser?.defaultBabyId) return response.status(503).json({ error: 'Alexa user is not configured' });
  const now = new Date().toISOString();
  let input: z.infer<typeof eventInputSchema> | undefined;
  let speech = 'I did not understand that.';
  let shouldEndSession = true;
  if (requestType === 'LaunchRequest' || intent?.name === 'AMAZON.HelpIntent') {
    speech = 'Leo Logger is ready. Say log a pee, log a poop, log two ounces, start sleep, or baby woke up.';
    shouldEndSession = false;
  } else if (intent?.name === 'AMAZON.CancelIntent' || intent?.name === 'AMAZON.StopIntent') {
    speech = 'Goodbye.';
  } else if (intent?.name === 'LogDiaperIntent') {
    const raw = String(intent.slots?.kind?.value || 'pee').toLowerCase();
    const diaper = raw.includes('both') || raw.includes('pee and poop') ? 'both' : raw.includes('poop') ? 'poop' : 'pee';
    input = { babyId: alexaUser.defaultBabyId, type: 'diaper', startAt: now, diaper, clientMutationId: alexaRequestId };
    speech = `${diaper === 'both' ? 'Pee and poop' : diaper} logged now.`;
  } else if (intent?.name === 'LogFeedIntent') {
    const ounces = Number(intent.slots?.ounces?.value);
    const rawSource = String(intent.slots?.source?.value || 'formula').toLowerCase();
    const source = rawSource.includes('breast') ? 'breast_milk' : rawSource.includes('combo') ? 'combo' : 'formula';
    if (Number.isFinite(ounces) && ounces > 0) {
      input = { babyId: alexaUser.defaultBabyId, type: 'feed', startAt: now, feed: { ounces, source }, clientMutationId: alexaRequestId };
      speech = `${ounces} ounces of ${source.replace('_', ' ')} logged now.`;
    } else speech = 'Please say the number of ounces.';
  } else if (intent?.name === 'StartSleepIntent') {
    input = { babyId: alexaUser.defaultBabyId, type: 'sleep', startAt: now, clientMutationId: alexaRequestId };
    speech = 'Sleep started now.';
  } else if (intent?.name === 'StopSleepIntent') {
    const active = (await store.list<BabyEvent>('events')).find((event) => event.babyId === alexaUser.defaultBabyId && event.type === 'sleep' && !event.endAt && !event.deletedAt);
    if (active) { await reviseEvent(store, active, alexaUser, 'update'); await store.put('events', active.id, { ...active, endAt: now, updatedAt: now }); publishBabyUpdate(active.babyId, 'updated'); speech = 'Wake time logged now.'; }
    else speech = 'There is no active sleep to stop.';
  }
  if (input) { const event = await createEvent(store, input, alexaUser, 'alexa'); publishBabyUpdate(event.babyId, 'created'); }
  response.json({ version: '1.0', response: { outputSpeech: { type: 'PlainText', text: speech }, shouldEndSession } });
});

const staticPath = resolve('dist/client');
if (existsSync(staticPath)) {
  app.use(express.static(staticPath, { maxAge: '1y', index: false }));
  app.get('*splat', (_request, response) => response.sendFile(resolve(staticPath, 'index.html')));
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  void _next;
  console.error(JSON.stringify({ level: 'error', message: error instanceof Error ? error.message : 'Unknown error' }));
  response.status(500).json({ error: 'Something went wrong' });
});

bootstrap().then(() => {
  startReminderScheduler(store);
  app.listen(port, () => console.log(JSON.stringify({ level: 'info', message: `Leo Logger listening on ${port}` })));
}).catch((error) => { console.error(error); process.exit(1); });

export { app, store };
