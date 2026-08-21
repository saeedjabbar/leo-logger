import { useCallback, useEffect, useMemo, useState } from 'react';
import { Baby as BabyIcon, BedDouble, Droplets, Milk, Settings, Sparkles } from 'lucide-react';
import { api } from '../api';
import { flushEvents, queueEvent } from '../offline';
import type { Baby, BabyEvent, User } from '../types';
import FeedSheet from './FeedSheet';

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

export default function Logger({ user, babies, initialSleep, onAdmin, onLogout }: { user: User; babies: Baby[]; initialSleep?: BabyEvent; onAdmin: () => void; onLogout: () => void }) {
  const [babyId, setBabyId] = useState(user.defaultBabyId || babies[0]?.id);
  const [events, setEvents] = useState<BabyEvent[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [activeSleep, setActiveSleep] = useState(initialSleep?.babyId === babyId ? initialSleep : undefined);
  const [feedOpen, setFeedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const baby = babies.find((item) => item.id === babyId);
  const recent = useMemo(() => events.slice(0, 8), [events]);

  const refresh = useCallback(async () => {
    if (!babyId) return;
    const result = await api.get<{ events: BabyEvent[]; people: Record<string, string> }>(`/api/events?babyId=${babyId}&limit=30`);
    setEvents(result.events); setPeople(result.people);
    setActiveSleep(result.events.find((event) => event.type === 'sleep' && !event.endAt));
  }, [babyId]);

  useEffect(() => { refresh().catch(() => setNotice('Could not refresh. You can still log offline.')); }, [refresh]);
  useEffect(() => {
    const sync = () => flushEvents(async (event) => { await api.post('/api/events', event); }).then((count) => { if (count) { setNotice(`${count} offline ${count === 1 ? 'entry' : 'entries'} synced`); refresh(); } }).catch(() => undefined);
    window.addEventListener('online', sync); sync(); return () => window.removeEventListener('online', sync);
  }, [babyId, refresh]);

  async function log(input: Record<string, unknown>, label: string) {
    if (!babyId) return;
    setBusy(true); setNotice('');
    const payload = { ...input, babyId, startAt: new Date().toISOString(), clientMutationId: crypto.randomUUID() };
    try {
      const result = await api.post<{ event: BabyEvent }>('/api/events', payload);
      setEvents((current) => [result.event, ...current.filter((item) => item.id !== result.event.id)]);
      if (result.event.type === 'sleep') setActiveSleep(result.event);
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
      setEvents((current) => current.map((item) => item.id === result.event.id ? result.event : item)); setActiveSleep(undefined); setNotice('Wake time logged');
    } catch (reason) { setNotice((reason as Error).message); } finally { setBusy(false); }
  }

  async function undo() {
    const latest = events[0]; if (!latest) return;
    try { await api.delete(`/api/events/${latest.id}`); setEvents((current) => current.slice(1)); if (latest.id === activeSleep?.id) setActiveSleep(undefined); setNotice('Last entry undone'); }
    catch (reason) { setNotice((reason as Error).message); }
  }

  return <main className="safe-top safe-bottom mx-auto min-h-dvh max-w-xl px-4">
    <header className="mb-5 flex items-center justify-between gap-3">
      <div><p className="text-sm font-bold uppercase tracking-widest text-[#4f7b68]">Hello, {user.displayName}</p><div className="mt-1 flex items-center gap-2"><BabyIcon className="text-[#d28a3c]" /><h1 className="text-3xl font-black">{baby?.name || 'Baby'}</h1></div></div>
      <div className="flex gap-2">{user.role === 'master_admin' ? <button onClick={onAdmin} className="grid size-12 place-items-center rounded-full bg-white shadow-sm" aria-label="Open admin dashboard"><Settings /></button> : null}<button onClick={onLogout} className="rounded-full bg-stone-100 px-4 font-bold">Sign out</button></div>
    </header>
    {user.mustChangePassword ? <button onClick={onAdmin} className="mb-4 w-full rounded-2xl bg-amber-100 p-4 text-left font-bold text-amber-900">Temporary password in use. Open Admin Settings to change it now.</button> : null}
    {babies.length > 1 ? <label className="mb-4 block text-sm font-bold">Logging for<select value={babyId} onChange={(event) => setBabyId(event.target.value)} className="ml-2 h-12 rounded-xl border border-stone-200 bg-white px-3">{babies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
    {notice ? <div role="status" className="mb-4 flex min-h-14 items-center justify-between rounded-2xl bg-[#e7f2ec] px-4 font-bold text-[#345343]"><span>{notice}</span>{events[0] && Date.now() - new Date(events[0].createdAt).getTime() < 120_000 ? <button onClick={undo} className="min-h-12 px-2 underline">Undo</button> : null}</div> : null}
    <section aria-labelledby="quick-title"><h2 id="quick-title" className="sr-only">Quick log</h2><div className="grid grid-cols-2 gap-3">
      <button disabled={busy} onClick={() => setFeedOpen(true)} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#fff0d7] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#e69a42] text-white"><Milk /></span>Feed</button>
      <button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'pee' }, 'Pee')} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#e3f3fc] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#58a7d1] text-white"><Droplets /></span>Pee</button>
      <button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'poop' }, 'Poop')} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#f5e7d3] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#a8794f] text-white"><Sparkles /></span>Poop</button>
      <button disabled={busy} onClick={() => activeSleep ? wake() : log({ type: 'sleep' }, 'Sleep')} className={`tap card flex min-h-36 flex-col items-center justify-center rounded-3xl p-4 text-xl font-black ${activeSleep ? 'bg-[#5d557d] text-white' : 'bg-[#ece9f7]'}`}><span className={`mb-2 grid size-14 place-items-center rounded-2xl text-white ${activeSleep ? 'bg-white/20' : 'bg-[#776c9b]'}`}><BedDouble /></span>{activeSleep ? 'Baby woke up' : 'Start sleep'}{activeSleep ? <span className="mt-1 text-xs font-semibold opacity-80">Started {ago(activeSleep.startAt)}</span> : null}</button>
    </div><button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'both' }, 'Pee + poop')} className="tap card mt-3 flex w-full items-center justify-center gap-3 rounded-2xl bg-white text-lg font-black"><Droplets className="text-[#58a7d1]" /><span>Pee + Poop</span><Sparkles className="text-[#a8794f]" /></button></section>
    <section className="mt-7"><h2 className="mb-3 text-xl font-black">Recent activity</h2><div className="card overflow-hidden rounded-3xl bg-white">{recent.length ? recent.map((event, index) => <div key={event.id} className={`flex items-center justify-between gap-3 p-4 ${index ? 'border-t border-stone-100' : ''}`}><div><p className="font-black capitalize">{eventLabel(event)}</p><p className="text-sm text-stone-500">{people[event.createdBy] || 'Family'} · {event.channel}</p></div><time className="whitespace-nowrap text-sm font-bold text-stone-500">{ago(event.startAt)}</time></div>) : <p className="p-6 text-center text-stone-500">No activity logged yet.</p>}</div></section>
    {feedOpen ? <FeedSheet busy={busy} onClose={() => setFeedOpen(false)} onSave={(feed) => log({ type: 'feed', feed }, `${feed.ounces} oz feed`)} /> : null}
  </main>;
}
