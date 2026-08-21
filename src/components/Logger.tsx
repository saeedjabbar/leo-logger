import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Baby as BabyIcon, BedDouble, Bell, BellOff, Droplets, MessageCircle, Mic, Milk, Pencil, Settings, Sparkles } from 'lucide-react';
import { api } from '../api';
import { flushEvents, queueEvent } from '../offline';
import type { Baby, BabyEvent, User } from '../types';
import FeedSheet from './FeedSheet';

const ChatLogger = lazy(() => import('./ChatLogger'));
const EventEditSheet = lazy(() => import('./EventEditSheet'));

function eventLabel(event: BabyEvent) {
  if (event.type === 'feed') return `${event.feed?.ounces ?? '?'} oz ${event.feed?.source.replace('_', ' ')}`;
  if (event.type === 'diaper') return event.diaper === 'both' ? 'Pee + poop' : event.diaper;
  if (event.type === 'sleep') return event.endAt ? 'Woke up' : 'Sleep started';
  return 'Imported pump';
}

function ago(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60); return `${hours}h ${minutes % 60}m ago`;
}

function durationLabel(milliseconds: number) {
  const minutes = Math.max(0, Math.round(Math.abs(milliseconds) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'}${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function RecentActivityRow({ event, person, editable, onEdit, divider }: { event: BabyEvent; person: string; editable: boolean; onEdit: () => void; divider: boolean }) {
  const content = <><div className="text-left"><p className="font-black capitalize">{eventLabel(event)}</p><p className="text-sm text-stone-500">{person} · {event.channel}</p></div><span className={`flex shrink-0 items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold ${editable ? 'bg-stone-100 text-[#345343]' : 'text-stone-500'}`}><time className="whitespace-nowrap">{ago(event.startAt)}</time>{editable ? <Pencil size={16} aria-hidden="true" /> : null}</span></>;
  const className = `flex min-h-18 w-full items-center justify-between gap-3 p-4 ${divider ? 'border-t border-stone-100' : ''}`;
  return editable ? <button type="button" onClick={onEdit} className={`${className} hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#4f7b68]`} aria-label={`Edit ${eventLabel(event)}, logged ${ago(event.startAt)}`}>{content}</button> : <div className={className}>{content}</div>;
}

export default function Logger({ user, babies, initialSleep, onAdmin, onLogout }: { user: User; babies: Baby[]; initialSleep?: BabyEvent; onAdmin: () => void; onLogout: () => void }) {
  const [babyId, setBabyId] = useState(user.defaultBabyId || babies[0]?.id);
  const [events, setEvents] = useState<BabyEvent[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [activeSleep, setActiveSleep] = useState(initialSleep?.babyId === babyId ? initialSleep : undefined);
  const [feedOpen, setFeedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [editing, setEditing] = useState<BabyEvent>();
  const [familyInsight, setFamilyInsight] = useState('');
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState('');
  const baby = babies.find((item) => item.id === babyId);
  const recent = useMemo(() => events.slice(0, 8), [events]);
  const latestFeed = useMemo(() => events.find((event) => event.type === 'feed'), [events]);
  const nextFeedAt = latestFeed ? new Date(latestFeed.startAt).getTime() + (baby?.feedingIntervalMinutes || 120) * 60_000 : undefined;

  const refresh = useCallback(async () => {
    if (!babyId) return;
    const result = await api.get<{ events: BabyEvent[]; people: Record<string, string> }>(`/api/events?babyId=${babyId}&limit=30`);
    setEvents(result.events); setPeople(result.people);
    setActiveSleep(result.events.find((event) => event.type === 'sleep' && !event.endAt));
  }, [babyId]);

  useEffect(() => { refresh().catch(() => setNotice('Could not refresh. You can still log offline.')); }, [refresh]);
  useEffect(() => {
    if (!babyId) return;
    const sync = () => refresh().catch(() => undefined);
    const stream = 'EventSource' in window ? new EventSource(`/api/events/stream?babyId=${encodeURIComponent(babyId)}`) : undefined;
    stream?.addEventListener('events', sync);
    const fallback = window.setInterval(sync, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    window.addEventListener('focus', sync); document.addEventListener('visibilitychange', onVisible);
    return () => { stream?.close(); window.clearInterval(fallback); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', onVisible); };
  }, [babyId, refresh]);
  useEffect(() => {
    const sync = () => flushEvents(async (event) => { await api.post('/api/events', event); }).then((count) => { if (count) { setNotice(`${count} offline ${count === 1 ? 'entry' : 'entries'} synced`); refresh(); } }).catch(() => undefined);
    window.addEventListener('online', sync); sync(); return () => window.removeEventListener('online', sync);
  }, [babyId, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    if ('serviceWorker' in navigator && 'PushManager' in window) navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => setRemindersEnabled(Boolean(subscription))).catch(() => undefined);
    return () => window.clearInterval(timer);
  }, []);

  async function toggleReminders() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Install Leo Logger to your home screen first, then reopen it to enable reminders.');
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await api.delete('/api/reminders/subscribe', { endpoint: current.endpoint });
        await current.unsubscribe(); setRemindersEnabled(false); setNotice('Feed reminders turned off on this device'); return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications were not allowed. You can enable them in your phone settings.');
      const config = await api.get<{ configured: boolean; publicKey: string | null }>('/api/reminders/config');
      if (!config.configured || !config.publicKey) throw new Error('Feed reminders are not available yet.');
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
      await api.post('/api/reminders/subscribe', subscription.toJSON());
      setRemindersEnabled(true); setNotice('Feed reminders enabled on this device');
    } catch (reason) { setNotice((reason as Error).message); }
  }

  async function loadFamilyInsight() {
    if (!babyId) return;
    setInsightBusy(true); setInsightError('');
    try {
      const result = await api.get<{ insight: string }>(`/api/insights/ai?babyId=${babyId}`);
      setFamilyInsight(result.insight);
    } catch (reason) { setInsightError((reason as Error).message); }
    finally { setInsightBusy(false); }
  }

  async function log(input: Record<string, unknown>, label: string) {
    if (!babyId) return;
    setBusy(true); setNotice('');
    const payload = { ...input, babyId, startAt: new Date().toISOString(), clientMutationId: crypto.randomUUID() };
    try {
      const result = await api.post<{ event: BabyEvent }>('/api/events', payload);
      setEvents((current) => [result.event, ...current.filter((item) => item.id !== result.event.id)]);
      if (result.event.type === 'sleep') setActiveSleep(result.event);
      setFamilyInsight('');
      setNotice(`${label} logged`); navigator.vibrate?.(40);
    } catch {
      await queueEvent(payload); setNotice(`${label} saved offline and will sync`);
    } finally { setBusy(false); setFeedOpen(false); }
  }

  async function wake() {
    if (!activeSleep) return;
    setBusy(true);
    try {
      const result = await api.patch<{ event: BabyEvent }>(`/api/events/${activeSleep.id}`, { endAt: new Date().toISOString() });
      setEvents((current) => current.map((item) => item.id === result.event.id ? result.event : item)); setActiveSleep(undefined); setFamilyInsight(''); setNotice('Wake time logged');
    } catch (reason) { setNotice((reason as Error).message); } finally { setBusy(false); }
  }

  async function undo() {
    const latest = events[0]; if (!latest) return;
    try { await api.delete(`/api/events/${latest.id}`); setEvents((current) => current.slice(1)); if (latest.id === activeSleep?.id) setActiveSleep(undefined); setFamilyInsight(''); setNotice('Last entry undone'); }
    catch (reason) { setNotice((reason as Error).message); }
  }

  return <main className="safe-top safe-bottom mx-auto min-h-dvh max-w-xl px-4">
    <header className="mb-5 flex items-center justify-between gap-3">
      <div><p className="text-sm font-bold uppercase tracking-widest text-[#4f7b68]">Hello, {user.displayName}</p><div className="mt-1 flex items-center gap-2"><BabyIcon className="text-[#d28a3c]" /><h1 className="text-3xl font-black">{baby?.name || 'Baby'}</h1></div></div>
      <div className="flex gap-2">{user.role === 'admin' ? <button onClick={onAdmin} className="grid size-12 place-items-center rounded-full bg-white shadow-sm" aria-label="Open admin dashboard"><Settings /></button> : null}<button onClick={onLogout} className="rounded-full bg-stone-100 px-4 font-bold">Sign out</button></div>
    </header>
    {user.mustChangePassword ? <button onClick={onAdmin} className="mb-4 w-full rounded-2xl bg-amber-100 p-4 text-left font-bold text-amber-900">Temporary password in use. Open Admin Settings to change it now.</button> : null}
    <section className={`card mb-4 rounded-3xl p-4 ${nextFeedAt && nextFeedAt <= now ? 'bg-red-50 text-red-900' : 'bg-white'}`} aria-label="Feeding schedule">
      <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide opacity-70">Feeding reminder · every {durationLabel((baby?.feedingIntervalMinutes || 120) * 60_000)}</p><p className="mt-1 text-xl font-black">{nextFeedAt ? nextFeedAt <= now ? `Feed due ${durationLabel(now - nextFeedAt)} ago` : `Next feed in ${durationLabel(nextFeedAt - now)}` : 'Log the first feed to start reminders'}</p></div><button onClick={toggleReminders} className={`tap grid min-w-16 place-items-center rounded-2xl ${remindersEnabled ? 'bg-[#4f7b68] text-white' : 'bg-stone-100'}`} aria-label={remindersEnabled ? 'Turn off feed reminders' : 'Enable feed reminders'}>{remindersEnabled ? <Bell /> : <BellOff />}</button></div>
      <p className="mt-2 text-sm font-semibold opacity-70">{remindersEnabled ? 'Alerts are on for this device.' : 'Tap the bell to get an alert when feeding is due.'}</p>
    </section>
    <section className="card mb-4 rounded-3xl bg-[#f2efe9] p-4" aria-labelledby="family-insight-title"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#725d3c]"><Sparkles size={18} />AI family insight</p><h2 id="family-insight-title" className="mt-1 text-xl font-black">The last 7 days</h2></div><button type="button" onClick={loadFamilyInsight} disabled={insightBusy} className="min-h-12 shrink-0 rounded-xl bg-white px-4 font-black text-[#4f7b68] shadow-sm disabled:opacity-50">{insightBusy ? 'Thinking…' : familyInsight ? 'Refresh' : 'Show insight'}</button></div>{familyInsight ? <p className="mt-3 leading-relaxed text-stone-700">{familyInsight}</p> : <p className="mt-2 text-sm text-stone-600">Tap for a private summary of feeding, diapers, and sleep. It won’t create or change any logs.</p>}{insightError ? <p role="alert" className="mt-2 text-sm font-bold text-red-700">{insightError}</p> : null}<p className="mt-2 text-xs text-stone-500">Descriptive only—not medical advice.</p></section>
    {babies.length > 1 ? <label className="mb-4 block text-sm font-bold">Logging for<select value={babyId} onChange={(event) => { setBabyId(event.target.value); setFamilyInsight(''); setInsightError(''); }} className="ml-2 h-12 rounded-xl border border-stone-200 bg-white px-3">{babies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
    {notice ? <div role="status" className="mb-4 flex min-h-14 items-center justify-between rounded-2xl bg-[#e7f2ec] px-4 font-bold text-[#345343]"><span>{notice}</span>{events[0] && Date.now() - new Date(events[0].createdAt).getTime() < 120_000 ? <button onClick={undo} className="min-h-12 px-2 underline">Undo</button> : null}</div> : null}
    <section aria-labelledby="quick-title"><h2 id="quick-title" className="sr-only">Quick log</h2><div className="grid grid-cols-2 gap-3">
      <button disabled={busy} onClick={() => setFeedOpen(true)} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#fff0d7] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#e69a42] text-white"><Milk /></span>Feed</button>
      <button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'pee' }, 'Pee')} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#e3f3fc] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#58a7d1] text-white"><Droplets /></span>Pee</button>
      <button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'poop' }, 'Poop')} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#f5e7d3] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#a8794f] text-white"><Sparkles /></span>Poop</button>
      <button disabled={busy} onClick={() => activeSleep ? wake() : log({ type: 'sleep' }, 'Sleep')} className={`tap card flex min-h-36 flex-col items-center justify-center rounded-3xl p-4 text-xl font-black ${activeSleep ? 'bg-[#5d557d] text-white' : 'bg-[#ece9f7]'}`}><span className={`mb-2 grid size-14 place-items-center rounded-2xl text-white ${activeSleep ? 'bg-white/20' : 'bg-[#776c9b]'}`}><BedDouble /></span>{activeSleep ? 'Baby woke up' : 'Start sleep'}{activeSleep ? <span className="mt-1 text-xs font-semibold opacity-80">Started {ago(activeSleep.startAt)}</span> : null}</button>
    </div><button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'both' }, 'Pee + poop')} className="tap card mt-3 flex w-full items-center justify-center gap-3 rounded-2xl bg-white text-lg font-black"><Droplets className="text-[#58a7d1]" /><span>Pee + Poop</span><Sparkles className="text-[#a8794f]" /></button><button onClick={() => setChatOpen(true)} className="tap card mt-3 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#322b26] px-4 text-lg font-black text-white"><MessageCircle /><span>Tell Leo Logger</span><Mic size={20} /></button></section>
    <section className="mt-7"><div className="mb-3"><h2 className="text-xl font-black">Recent activity</h2><p className="text-sm text-stone-500">Tap one of your entries—or its time—to edit the details.</p></div><div className="card overflow-hidden rounded-3xl bg-white">{recent.length ? recent.map((event, index) => <RecentActivityRow key={event.id} event={event} person={people[event.createdBy] || 'Family'} editable={user.role === 'admin' || event.createdBy === user.id} onEdit={() => setEditing(event)} divider={Boolean(index)} />) : <p className="p-6 text-center text-stone-500">No activity logged yet.</p>}</div></section>
    {feedOpen ? <FeedSheet busy={busy} onClose={() => setFeedOpen(false)} onSave={(feed) => log({ type: 'feed', feed }, `${feed.ounces} oz feed`)} /> : null}
    {chatOpen && baby ? <Suspense fallback={null}><ChatLogger baby={baby} onClose={() => setChatOpen(false)} onLogged={() => { refresh(); setFamilyInsight(''); setNotice('Activity logged from chat'); }} /></Suspense> : null}
    {editing ? <Suspense fallback={null}><EventEditSheet event={editing} onClose={() => setEditing(undefined)} onUpdated={(updated) => { setEvents((current) => current.map((item) => item.id === updated.id ? updated : item).sort((a, b) => b.startAt.localeCompare(a.startAt))); if (updated.type === 'sleep') setActiveSleep(updated.endAt ? undefined : updated); setEditing(undefined); setFamilyInsight(''); setNotice('Activity updated'); }} /></Suspense> : null}
  </main>;
}
