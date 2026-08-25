import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Baby as BabyIcon, BedDouble, Bell, Droplets, LogOut, MessageCircle, Milk, Pencil, RefreshCw, Settings, Sparkles, Timer, X } from 'lucide-react';
import { api } from '../api';
import { feedCountdownLabel } from '../feedCountdown';
import { flushEvents, queueEvent } from '../offline';
import type { Baby, BabyEvent, User } from '../types';
import { uprightReminderDelay } from '../uprightReminder';
import FeedSheet from './FeedSheet';

const ChatLogger = lazy(() => import('./ChatLogger'));
const EventEditSheet = lazy(() => import('./EventEditSheet'));
const BabyProfileSheet = lazy(() => import('./BabyProfileSheet'));

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

function clockTimeLabel(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

function RecentActivityRow({ event, person, editable, onEdit, divider }: { event: BabyEvent; person: string; editable: boolean; onEdit: () => void; divider: boolean }) {
  const content = <><div className="text-left"><p className="font-black capitalize">{eventLabel(event)}</p><p className="text-sm text-stone-500">{person}</p></div><span className={`flex shrink-0 items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold ${editable ? 'bg-stone-100 text-[#345343]' : 'text-stone-500'}`}><time className="whitespace-nowrap">{ago(event.startAt)}</time>{editable ? <Pencil size={16} aria-hidden="true" /> : null}</span></>;
  const className = `flex min-h-18 w-full items-center justify-between gap-3 p-4 ${divider ? 'border-t border-stone-100' : ''}`;
  return editable ? <button type="button" onClick={onEdit} className={`${className} hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#4f7b68]`} aria-label={`Edit ${eventLabel(event)}, logged ${ago(event.startAt)}`}>{content}</button> : <div className={className}>{content}</div>;
}

export default function Logger({ user, babies, initialSleep, aiEnabled, onAdmin, onLogout, onBabyChanged }: { user: User; babies: Baby[]; initialSleep?: BabyEvent; aiEnabled: boolean; onAdmin: () => void; onLogout: () => void; onBabyChanged: (baby: Baby) => void }) {
  const [babyId, setBabyId] = useState(user.defaultBabyId || babies[0]?.id);
  const [events, setEvents] = useState<BabyEvent[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [activeSleep, setActiveSleep] = useState(initialSleep?.babyId === babyId ? initialSleep : undefined);
  const [feedOpen, setFeedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [editing, setEditing] = useState<BabyEvent>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [caregiverInsight, setCaregiverInsight] = useState('');
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState('');
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStart = useRef<number | undefined>(undefined);
  const pullDistanceRef = useRef(0);
  const uprightAlerted = useRef(new Set<string>());
  const baby = babies.find((item) => item.id === babyId);
  const recent = useMemo(() => events.slice(0, 8), [events]);
  const latestFeed = useMemo(() => events.find((event) => event.type === 'feed'), [events]);
  const nextFeedAt = latestFeed ? new Date(latestFeed.startAt).getTime() + (baby?.feedingIntervalMinutes || 120) * 60_000 : undefined;
  const latestFeedAt = latestFeed ? new Date(latestFeed.startAt).getTime() : undefined;
  const uprightDueAt = latestFeedAt === undefined ? undefined : latestFeedAt + 15 * 60_000;
  const uprightCountdownActive = user.uprightTimerEnabled === true && uprightDueAt !== undefined && uprightDueAt > now;
  const showUprightTimer = user.uprightTimerEnabled === true && (uprightDueAt === undefined || uprightCountdownActive);

  const refresh = useCallback(async () => {
    if (!babyId) return;
    const result = await api.get<{ events: BabyEvent[]; people: Record<string, string> }>(`/api/events?babyId=${babyId}&limit=30`);
    setEvents(result.events); setPeople(result.people);
    setActiveSleep(result.events.find((event) => event.type === 'sleep' && !event.endAt));
  }, [babyId]);

  useEffect(() => { refresh().catch(() => setNotice('Could not refresh. You can still log offline.')); }, [refresh]);
  useEffect(() => {
    if (babyId && babies.some((item) => item.id === babyId)) return;
    const availableDefault = babies.find((item) => item.id === user.defaultBabyId)?.id;
    setBabyId(availableDefault || babies[0]?.id);
  }, [babies, babyId, user.defaultBabyId]);
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
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    let cancelled = false;
    const sync = () => navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => { if (!cancelled) setRemindersEnabled(Boolean(subscription)); })
      .catch(() => { if (!cancelled) setRemindersEnabled(false); });
    sync();
    window.addEventListener('focus', sync);
    return () => { cancelled = true; window.removeEventListener('focus', sync); };
  }, []);
  useEffect(() => {
    if (!remindersEnabled && !uprightCountdownActive) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [remindersEnabled, uprightCountdownActive]);
  useEffect(() => {
    if (!user.uprightTimerEnabled || !babyId) return;
    const latestFeed = events.find((event) => event.type === 'feed');
    if (!latestFeed) return;
    const marker = `${latestFeed.id}:${latestFeed.startAt}`;
    const storageKey = `leo-logger:upright-alert:v1:${user.id}:${babyId}`;
    let alreadyAlerted = uprightAlerted.current.has(marker);
    try { alreadyAlerted ||= localStorage.getItem(storageKey) === marker; } catch { /* In-memory tracking still prevents repeats. */ }
    if (alreadyAlerted) return;
    const notify = () => {
      uprightAlerted.current.add(marker);
      try { localStorage.setItem(storageKey, marker); } catch { /* Storage can be unavailable in private browsing. */ }
      setNotice(`${baby?.name || 'Baby'}'s 15-minute upright time is complete`);
      navigator.vibrate?.([100, 80, 100]);
    };
    const delay = uprightReminderDelay(latestFeed.startAt);
    if (delay === undefined) return;
    if (delay === 0) { notify(); return; }
    const timer = window.setTimeout(notify, delay);
    return () => window.clearTimeout(timer);
  }, [baby?.name, babyId, events, user.id, user.uprightTimerEnabled]);
  async function loadCaregiverInsight() {
    if (!babyId) return;
    setInsightBusy(true); setInsightError('');
    try {
      const result = await api.get<{ insight: string }>(`/api/insights/ai?babyId=${babyId}`);
      setCaregiverInsight(result.insight);
    } catch (reason) { setInsightError((reason as Error).message); }
    finally { setInsightBusy(false); }
  }

  function startPull(event: React.TouchEvent<HTMLElement>) {
    if (window.scrollY <= 0 && !refreshing) pullStart.current = event.touches[0]?.clientY;
  }

  function movePull(event: React.TouchEvent<HTMLElement>) {
    if (pullStart.current === undefined || window.scrollY > 0) return;
    const distance = (event.touches[0]?.clientY || 0) - pullStart.current;
    if (distance <= 0) { pullDistanceRef.current = 0; return setPullDistance(0); }
    event.preventDefault();
    const nextDistance = Math.min(96, distance * .45);
    pullDistanceRef.current = nextDistance; setPullDistance(nextDistance);
  }

  async function finishPull() {
    const shouldRefresh = pullDistanceRef.current >= 64;
    pullStart.current = undefined; pullDistanceRef.current = 0; setPullDistance(0);
    if (!shouldRefresh || refreshing) return;
    setRefreshing(true);
    try { await refresh(); setNotice('Everything is up to date'); }
    catch { setNotice('Could not refresh. Check your connection and try again.'); }
    finally { setRefreshing(false); }
  }

  async function log(input: Record<string, unknown>, label: string) {
    if (!babyId) return;
    setBusy(true); setNotice('');
    const payload = { ...input, babyId, startAt: new Date().toISOString(), clientMutationId: crypto.randomUUID() };
    try {
      const result = await api.post<{ event: BabyEvent }>('/api/events', payload);
      setEvents((current) => [result.event, ...current.filter((item) => item.id !== result.event.id)]);
      if (result.event.type === 'sleep') setActiveSleep(result.event);
      setCaregiverInsight('');
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
      setEvents((current) => current.map((item) => item.id === result.event.id ? result.event : item)); setActiveSleep(undefined); setCaregiverInsight(''); setNotice('Wake time logged');
    } catch (reason) { setNotice((reason as Error).message); } finally { setBusy(false); }
  }

  async function undo() {
    const latest = events[0]; if (!latest) return;
    try { await api.delete(`/api/events/${latest.id}`); setEvents((current) => current.slice(1)); if (latest.id === activeSleep?.id) setActiveSleep(undefined); setCaregiverInsight(''); setNotice('Last entry undone'); }
    catch (reason) { setNotice((reason as Error).message); }
  }

  return <main className="safe-top safe-bottom mx-auto min-h-dvh max-w-xl overscroll-y-contain px-4" onTouchStart={startPull} onTouchMove={movePull} onTouchEnd={finishPull} onTouchCancel={() => { pullStart.current = undefined; pullDistanceRef.current = 0; setPullDistance(0); }}>
    <div className="grid place-items-center overflow-hidden text-sm font-bold text-[#4f7b68] transition-[height]" style={{ height: refreshing ? 52 : pullDistance }} aria-live="polite"><span className="flex items-center gap-2"><RefreshCw size={19} className={refreshing ? 'animate-spin' : ''} style={{ transform: refreshing ? undefined : `rotate(${Math.min(180, pullDistance * 3)}deg)` }} />{refreshing ? 'Refreshing…' : pullDistance >= 64 ? 'Release to refresh' : 'Pull to refresh'}</span></div>
    <header className="mb-5 flex items-center justify-between gap-3">
      <div><p className="text-sm font-bold uppercase tracking-widest text-[#4f7b68]">Hello, {user.displayName}</p>{user.role === 'admin' && baby ? <button type="button" onClick={() => setProfileOpen(true)} className="mt-1 flex min-h-12 items-center gap-2 rounded-xl pr-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4f7b68]" aria-label={`Edit ${baby.name}'s profile`}><BabyIcon className="text-[#d28a3c]" /><h1 className="text-3xl font-black">{baby.name}</h1><Pencil size={18} className="text-stone-400" aria-hidden="true" /></button> : <div className="mt-1 flex min-h-12 items-center gap-2"><BabyIcon className="text-[#d28a3c]" /><h1 className="text-3xl font-black">{baby?.name || 'Baby'}</h1></div>}</div>
      <button type="button" onClick={() => setSettingsOpen(true)} className="grid size-12 shrink-0 place-items-center rounded-full bg-white shadow-sm" aria-label="Open settings"><Settings /></button>
    </header>
    {user.mustChangePassword ? <button onClick={onAdmin} className="mb-4 w-full rounded-2xl bg-amber-100 p-4 text-left font-bold text-amber-900">Temporary password in use. Open Admin Settings to change it now.</button> : null}
    {remindersEnabled ? <section className={`card mb-4 rounded-3xl p-4 ${nextFeedAt && nextFeedAt <= now ? 'bg-red-50 text-red-900' : 'bg-white'}`} aria-label="Feeding reminder"><p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide opacity-70"><Bell size={18} />Feeding reminder · every {durationLabel((baby?.feedingIntervalMinutes || 120) * 60_000)}</p><p className="mt-1 text-2xl font-black tabular-nums">{nextFeedAt ? nextFeedAt > now ? `Next feed in ${feedCountdownLabel(nextFeedAt - now)}` : now - nextFeedAt < 1_000 ? 'Feed due now' : `Feed overdue by ${feedCountdownLabel(now - nextFeedAt)}` : 'Log the first feed to start the reminder'}</p>{nextFeedAt ? <p className="mt-1 font-bold opacity-80"><time dateTime={new Date(nextFeedAt).toISOString()}>{nextFeedAt > now ? 'Next feed at' : 'Feed was due at'} {clockTimeLabel(nextFeedAt)}</time></p> : null}<p className="mt-2 text-sm font-semibold opacity-70">Alerts are on for this device.{user.role === 'admin' ? ' Manage them under Settings.' : ''}</p></section> : null}
    {showUprightTimer ? <section className={`card mb-4 rounded-3xl p-4 ${uprightCountdownActive ? 'bg-[#e9f3ee]' : 'bg-white'}`} aria-label="15-minute upright timer"><p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#4f7b68]"><Timer size={18} />15-minute upright timer</p><p className="mt-1 text-2xl font-black tabular-nums">{uprightDueAt === undefined ? 'Starts after the next feed' : `Hold upright for ${feedCountdownLabel(uprightDueAt - now)}`}</p>{uprightDueAt !== undefined ? <p className="mt-1 font-bold text-[#4f7b68]"><time dateTime={new Date(uprightDueAt).toISOString()}>Upright until {clockTimeLabel(uprightDueAt)}</time></p> : null}<p className="mt-2 text-sm font-semibold text-stone-600">Starts automatically after each feed and disappears when complete.</p></section> : null}
    {aiEnabled ? <section className="card mb-4 rounded-3xl bg-[#f2efe9] p-4" aria-labelledby="caregiver-insight-title"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#725d3c]"><Sparkles size={18} />AI caregiver insight</p><h2 id="caregiver-insight-title" className="mt-1 text-xl font-black">The last 7 days</h2></div><button type="button" onClick={loadCaregiverInsight} disabled={insightBusy} className="min-h-12 shrink-0 rounded-xl bg-white px-4 font-black text-[#4f7b68] shadow-sm disabled:opacity-50">{insightBusy ? 'Thinking…' : caregiverInsight ? 'Refresh' : 'Show insight'}</button></div>{caregiverInsight ? <p className="mt-3 leading-relaxed text-stone-700">{caregiverInsight}</p> : <p className="mt-2 text-sm text-stone-600">Tap for a private summary of feeding, diapers, and sleep. It won’t create or change any logs.</p>}{insightError ? <p role="alert" className="mt-2 text-sm font-bold text-red-700">{insightError}</p> : null}<p className="mt-2 text-xs text-stone-500">Descriptive only—not medical advice. AI can make mistakes.</p></section> : null}
    {babies.length > 1 ? <label className="mb-4 block text-sm font-bold">Logging for<select value={babyId} onChange={(event) => { setBabyId(event.target.value); setCaregiverInsight(''); setInsightError(''); }} className="ml-2 h-12 rounded-xl border border-stone-200 bg-white px-3">{babies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
    {notice ? <div role="status" className="mb-4 flex min-h-14 items-center justify-between rounded-2xl bg-[#e7f2ec] px-4 font-bold text-[#345343]"><span>{notice}</span>{events[0] && Date.now() - new Date(events[0].createdAt).getTime() < 120_000 ? <button onClick={undo} className="min-h-12 px-2 underline">Undo</button> : null}</div> : null}
    <section aria-labelledby="quick-title"><h2 id="quick-title" className="sr-only">Quick log</h2><div className="grid grid-cols-2 gap-3">
      <button disabled={busy} onClick={() => setFeedOpen(true)} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#fff0d7] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#e69a42] text-white"><Milk /></span>Feed</button>
      <button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'pee' }, 'Pee')} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#e3f3fc] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#58a7d1] text-white"><Droplets /></span>Pee</button>
      <button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'poop' }, 'Poop')} className="tap card flex min-h-36 flex-col items-center justify-center rounded-3xl bg-[#f5e7d3] p-4 text-xl font-black"><span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#a8794f] text-white"><Sparkles /></span>Poop</button>
      <button disabled={busy} onClick={() => activeSleep ? wake() : log({ type: 'sleep' }, 'Sleep')} className={`tap card flex min-h-36 flex-col items-center justify-center rounded-3xl p-4 text-xl font-black ${activeSleep ? 'bg-[#5d557d] text-white' : 'bg-[#ece9f7]'}`}><span className={`mb-2 grid size-14 place-items-center rounded-2xl text-white ${activeSleep ? 'bg-white/20' : 'bg-[#776c9b]'}`}><BedDouble /></span>{activeSleep ? 'Baby woke up' : 'Start sleep'}{activeSleep ? <span className="mt-1 text-xs font-semibold opacity-80">Started {ago(activeSleep.startAt)}</span> : null}</button>
    </div><button disabled={busy} onClick={() => log({ type: 'diaper', diaper: 'both' }, 'Pee + poop')} className="tap card mt-3 flex w-full items-center justify-center gap-3 rounded-2xl bg-white text-lg font-black"><Droplets className="text-[#58a7d1]" /><span>Pee + Poop</span><Sparkles className="text-[#a8794f]" /></button></section>
    <section className="mt-7 mb-20"><div className="mb-3"><h2 className="text-xl font-black">Recent activity</h2><p className="text-sm text-stone-500">Tap one of your entries—or its time—to edit or delete it.</p></div><div className="card overflow-hidden rounded-3xl bg-white">{recent.length ? recent.map((event, index) => <RecentActivityRow key={event.id} event={event} person={people[event.createdBy] || 'Caregiver'} editable={user.role === 'admin' || event.createdBy === user.id} onEdit={() => setEditing(event)} divider={Boolean(index)} />) : <p className="p-6 text-center text-stone-500">No activity logged yet.</p>}</div></section>
    {!chatOpen && !editing && !feedOpen && !profileOpen && !settingsOpen ? <button type="button" onClick={() => setChatOpen(true)} className="fixed right-4 z-30 grid size-16 place-items-center rounded-full bg-[#322b26] text-white shadow-xl transition-transform active:scale-95" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }} aria-label="Tell Leo Logger"><MessageCircle size={30} aria-hidden="true" /></button> : null}
    {settingsOpen ? <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="home-settings-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="safe-bottom w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wider text-[#4f7b68]">Account</p><h2 id="home-settings-title" className="text-2xl font-black">Settings</h2></div><button type="button" onClick={() => setSettingsOpen(false)} className="grid size-12 place-items-center rounded-full bg-stone-100" aria-label="Close settings"><X /></button></div>{user.role === 'admin' ? <button type="button" onClick={() => { setSettingsOpen(false); onAdmin(); }} className="tap mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#4f7b68] font-black text-white"><Settings size={20} />Caregiver dashboard and settings</button> : null}<button type="button" onClick={onLogout} className="tap mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-stone-100 font-black text-red-700"><LogOut size={20} />Sign out</button></section></div> : null}
    {feedOpen ? <FeedSheet busy={busy} onClose={() => setFeedOpen(false)} onSave={(feed) => log({ type: 'feed', feed }, `${feed.ounces} oz feed`)} /> : null}
    {chatOpen && baby ? <Suspense fallback={null}><ChatLogger baby={baby} aiEnabled={aiEnabled} onClose={() => setChatOpen(false)} onLogged={() => { refresh(); setCaregiverInsight(''); setNotice('Activity logged from chat'); }} /></Suspense> : null}
    {editing ? <Suspense fallback={null}><EventEditSheet event={editing} onClose={() => setEditing(undefined)} onUpdated={(updated) => { setEvents((current) => current.map((item) => item.id === updated.id ? updated : item).sort((a, b) => b.startAt.localeCompare(a.startAt))); if (updated.type === 'sleep') setActiveSleep(updated.endAt ? undefined : updated); setEditing(undefined); setCaregiverInsight(''); setNotice('Activity updated'); }} onDeleted={(deleted) => { setEvents((current) => current.filter((item) => item.id !== deleted.id)); if (deleted.id === activeSleep?.id) setActiveSleep(undefined); setEditing(undefined); setCaregiverInsight(''); setNotice('Activity deleted'); }} /></Suspense> : null}
    {profileOpen && baby ? <Suspense fallback={null}><BabyProfileSheet baby={baby} onClose={() => setProfileOpen(false)} onUpdated={(updated) => { onBabyChanged(updated); setProfileOpen(false); }} /></Suspense> : null}
  </main>;
}
