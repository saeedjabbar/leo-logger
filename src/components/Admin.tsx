import { useCallback, useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { ArrowLeft, Baby as BabyIcon, BarChart3, Bell, BellOff, CalendarClock, Download, FileUp, KeyRound, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import type { Baby, BabyEvent, Insights, User } from '../types';

type Tab = 'overview' | 'history' | 'caregivers' | 'schedules' | 'babies' | 'settings';
const number = (value: number, digits = 1) => value.toFixed(digits).replace(/\.0$/, '');

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default function Admin({ currentUser, initialBabies, onBack, onChanged }: { currentUser: User; initialBabies: Baby[]; onBack: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>(currentUser.mustChangePassword ? 'settings' : 'overview');
  const [babies, setBabies] = useState(initialBabies);
  const [babyId, setBabyId] = useState(currentUser.defaultBabyId || initialBabies[0]?.id);
  const [range, setRange] = useState(30);
  const [insights, setInsights] = useState<Insights>();
  const [events, setEvents] = useState<BabyEvent[]>([]);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setMessage('');
    try {
      const [stats, history, caregivers, babyData] = await Promise.all([
        babyId ? api.get<Insights>(`/api/insights?babyId=${babyId}&from=${new Date(Date.now() - range * 86_400_000).toISOString()}&to=${new Date().toISOString()}`) : Promise.resolve(undefined),
        babyId ? api.get<{ events: BabyEvent[]; people: Record<string, string> }>(`/api/events?babyId=${babyId}&limit=500`) : Promise.resolve({ events: [], people: {} }),
        api.get<{ users: User[] }>('/api/admin/users'), api.get<{ babies: Baby[] }>('/api/admin/babies'),
      ]);
      setInsights(stats); setEvents(history.events); setPeople(history.people); setUsers(caregivers.users); setBabies(babyData.babies);
    } catch (reason) { setMessage((reason as Error).message); }
  }, [babyId, range]);
  useEffect(() => { load(); }, [load]);

  async function removeEvent(event: BabyEvent) {
    if (!confirm('Delete this entry? It will remain in the audit history.')) return;
    try { await api.delete(`/api/events/${event.id}`); setMessage('Entry deleted'); load(); }
    catch (reason) { setMessage((reason as Error).message); }
  }

  async function editEvent(event: BabyEvent) {
    const start = prompt('Start time (ISO format)', event.startAt); if (!start) return;
    const body: Record<string, unknown> = { startAt: new Date(start).toISOString() };
    if (event.type === 'feed') { const ounces = prompt('Ounces', String(event.feed?.ounces ?? '')); if (ounces === null) return; body.feed = { ...event.feed, ounces: Number(ounces) }; }
    if (event.type === 'sleep') { const end = prompt('Wake time (leave blank if still sleeping)', event.endAt || ''); body.endAt = end ? new Date(end).toISOString() : undefined; }
    try { await api.patch(`/api/events/${event.id}`, body); setMessage('Entry updated'); load(); }
    catch (reason) { setMessage((reason as Error).message); }
  }

  return <main className="safe-top safe-bottom mx-auto min-h-dvh max-w-6xl px-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><button onClick={onBack} className="grid size-12 place-items-center rounded-full bg-white shadow-sm" aria-label="Back to logger"><ArrowLeft /></button><div><p className="text-sm font-bold uppercase tracking-wider text-[#4f7b68]">Admin</p><h1 className="text-3xl font-black">Caregiver dashboard</h1></div></div><div className="flex gap-2"><select value={babyId} onChange={(event) => setBabyId(event.target.value)} className="h-12 rounded-xl border bg-white px-3 font-bold">{babies.map((baby) => <option value={baby.id} key={baby.id}>{baby.name}</option>)}</select><button onClick={load} className="grid size-12 place-items-center rounded-xl bg-white shadow-sm" aria-label="Refresh"><RefreshCw /></button></div></header>
    <nav className="my-5 flex gap-2 overflow-x-auto pb-1" aria-label="Admin sections">{([['overview', 'Insights', BarChart3], ['history', 'History', FileUp], ['caregivers', 'Caregivers', Users], ['schedules', 'Schedules', CalendarClock], ['babies', 'Babies', BabyIcon], ['settings', 'Settings', KeyRound]] as const).map(([value, label, Icon]) => <button key={value} onClick={() => setTab(value)} className={`tap flex min-w-max items-center gap-2 rounded-2xl px-5 font-black ${tab === value ? 'bg-[#4f7b68] text-white' : 'bg-white'}`}><Icon size={20} />{label}</button>)}</nav>
    {message ? <p role="status" className="mb-4 rounded-2xl bg-amber-50 p-4 font-bold">{message}</p> : null}
    {tab === 'overview' ? <Overview key={`${babyId}:${range}`} insights={insights} range={range} setRange={setRange} babyId={babyId} /> : null}
    {tab === 'history' ? <History events={events} people={people} onEdit={editEvent} onDelete={removeEvent} babyId={babyId} onImported={(text) => { setMessage(text); load(); }} /> : null}
    {tab === 'caregivers' ? <Caregivers users={users} babies={babies} onChanged={() => { load(); onChanged(); }} setMessage={setMessage} /> : null}
    {tab === 'schedules' ? <Schedules currentUser={currentUser} babies={babies} setMessage={setMessage} onChanged={() => { load(); onChanged(); }} /> : null}
    {tab === 'babies' ? <Babies babies={babies} setMessage={setMessage} onChanged={() => { load(); onChanged(); }} onRemoved={(removedId) => { setBabies((current) => current.filter((baby) => baby.id !== removedId)); setBabyId((current) => current === removedId ? babies.find((baby) => baby.id !== removedId)?.id ?? '' : current); onChanged(); }} /> : null}
    {tab === 'settings' ? <Settings setMessage={setMessage} onChanged={onChanged} /> : null}
  </main>;
}

function Overview({ insights, range, setRange, babyId }: { insights?: Insights; range: number; setRange: (value: number) => void; babyId?: string }) {
  if (!insights) return <p className="p-10 text-center">Loading insights…</p>;
  const cards = [
    ['Total ounces', `${number(insights.totals.ounces)} oz`], ['Feeds', String(insights.totals.feeds)], ['Wet diapers', String(insights.totals.wet)], ['Dirty diapers', String(insights.totals.dirty)],
    ['Sleep', `${number(insights.totals.sleepHours)} hrs`], ['Longest sleep', `${number(insights.totals.longestSleepHours)} hrs`], ['Avg. feed gap', `${number(insights.feedIntervals.averageHours)} hrs`], ['Median feed gap', `${number(insights.feedIntervals.medianHours)} hrs`],
  ];
  return <section><div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-black">Last {range} days</h2><select value={range} onChange={(event) => setRange(Number(event.target.value))} className="h-12 rounded-xl border bg-white px-3 font-bold"><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{cards.map(([label, value]) => <article key={label} className="card rounded-2xl bg-white p-4"><p className="text-sm font-bold text-stone-500">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></article>)}</div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2"><article className="card rounded-3xl bg-white p-4"><h3 className="mb-4 text-lg font-black">Feeding and sleep trend</h3><div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={insights.daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} /><YAxis /><Tooltip /><Legend /><Line type="monotone" dataKey="ounces" stroke="#d28a3c" strokeWidth={3} /><Line type="monotone" dataKey="sleepHours" stroke="#776c9b" strokeWidth={3} /></LineChart></ResponsiveContainer></div></article>
      <article className="card rounded-3xl bg-white p-4"><h3 className="mb-4 text-lg font-black">Diaper trend</h3><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={insights.daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="wet" fill="#58a7d1" /><Bar dataKey="dirty" fill="#a8794f" /></BarChart></ResponsiveContainer></div></article>
      <article className="card rounded-3xl bg-white p-4 lg:col-span-2"><h3 className="mb-4 text-lg font-black">Typical activity by hour</h3><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={insights.hourly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="hour" tickFormatter={(hour) => `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="feeds" fill="#d28a3c" /><Bar dataKey="diapers" fill="#58a7d1" /><Bar dataKey="sleeps" fill="#776c9b" /></BarChart></ResponsiveContainer></div></article></div>
    <div className="mt-5 flex flex-wrap gap-3"><a href={`/api/admin/export.csv?babyId=${babyId}`} className="tap flex items-center gap-2 rounded-2xl bg-white px-5 font-black shadow-sm"><Download />Export CSV</a></div><p className="mt-4 text-sm text-stone-500">Trends are descriptive only and are not medical advice.</p>
  </section>;
}

function History({ events, people, onEdit, onDelete, babyId, onImported }: { events: BabyEvent[]; people: Record<string, string>; onEdit: (event: BabyEvent) => void; onDelete: (event: BabyEvent) => void; babyId?: string; onImported: (message: string) => void }) {
  async function importFile(file: File) {
    if (!babyId) return;
    try { const result = await api.post<{ imported: number; flagged: number; skipped: number }>('/api/admin/import', { filename: file.name, content: await file.text(), babyId }); onImported(`Imported ${result.imported} rows; ${result.flagged} flagged for review; ${result.skipped} already imported.`); }
    catch (reason) { onImported((reason as Error).message); }
  }
  return <section><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">Event history</h2><label className="tap flex cursor-pointer items-center gap-2 rounded-2xl bg-[#4f7b68] px-5 font-black text-white"><FileUp />Import Huckleberry CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); }} /></label></div>
    <div className="card overflow-x-auto rounded-3xl bg-white"><table className="w-full min-w-[720px] text-left"><thead className="bg-stone-50 text-sm uppercase text-stone-500"><tr><th className="p-4">When</th><th>Type</th><th>Details</th><th>Logged by</th><th>Review</th><th className="p-4">Actions</th></tr></thead><tbody>{events.map((event) => <tr key={event.id} className="border-t border-stone-100"><td className="p-4 whitespace-nowrap">{new Date(event.startAt).toLocaleString()}</td><td className="capitalize font-bold">{event.type.replace('_', ' ')}</td><td>{event.feed ? `${event.feed.ounces ?? '?'} oz · ${event.feed.source.replace('_', ' ')}` : event.diaper || (event.endAt ? `Ended ${new Date(event.endAt).toLocaleTimeString()}` : '')}</td><td>{people[event.createdBy] || 'Import'}</td><td>{event.importWarnings?.map((warning) => <span key={warning} className="mr-1 rounded bg-amber-100 px-2 py-1 text-xs font-bold">{warning}</span>)}</td><td className="p-4 whitespace-nowrap"><button onClick={() => onEdit(event)} className="mr-3 font-bold text-[#4f7b68] underline">Edit</button><button onClick={() => onDelete(event)} className="font-bold text-red-700 underline">Delete</button></td></tr>)}</tbody></table></div>
  </section>;
}

function Caregivers({ users, babies, onChanged, setMessage }: { users: User[]; babies: Baby[]; onChanged: () => void; setMessage: (message: string) => void }) {
  const [name, setName] = useState(''); const [pin, setPin] = useState(''); const [defaultBabyId, setDefaultBabyId] = useState(babies[0]?.id || '');
  async function addCaregiver(event: React.FormEvent) { event.preventDefault(); try { await api.post('/api/admin/users', { displayName: name, pin, allowedBabyIds: [defaultBabyId], defaultBabyId }); setName(''); setPin(''); setMessage(`${name} can now sign in with the PIN you created.`); onChanged(); } catch (reason) { setMessage((reason as Error).message); } }
  return <section><h2 className="mb-3 text-2xl font-black">Caregivers</h2><div className="grid gap-5 lg:grid-cols-2"><form onSubmit={addCaregiver} className="card h-fit rounded-3xl bg-white p-5"><h3 className="text-lg font-black">Add a caregiver</h3><label className="mt-4 block font-bold">Name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-stone-200 px-3" required /></label><label className="mt-3 block font-bold">Six-digit PIN<input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="mt-1 h-14 w-full rounded-xl border-2 border-stone-200 px-3 text-xl tracking-widest" required /></label><label className="mt-3 block font-bold">Default baby<select value={defaultBabyId} onChange={(event) => setDefaultBabyId(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-stone-200 bg-white px-3">{babies.map((baby) => <option value={baby.id} key={baby.id}>{baby.name}</option>)}</select></label><button disabled={pin.length !== 6 || !defaultBabyId} className="tap mt-4 w-full rounded-xl bg-[#4f7b68] font-black text-white disabled:opacity-40"><Plus className="mr-2 inline" />Add caregiver</button></form><div className="space-y-2">{users.map((user) => user.role === 'caregiver' ? <CaregiverCard key={user.id} user={user} babies={babies} onChanged={onChanged} setMessage={setMessage} /> : <div key={user.id} className="card rounded-2xl bg-white p-4"><p className="font-black">{user.displayName}</p><p className="text-sm text-stone-500">Admin · {user.active ? 'Active' : 'Disabled'}</p></div>)}</div></div></section>;
}

function Schedules({ currentUser, babies, setMessage, onChanged }: { currentUser: User; babies: Baby[]; setMessage: (message: string) => void; onChanged: () => void }) {
  const [uprightTimerEnabled, setUprightTimerEnabled] = useState(currentUser.uprightTimerEnabled === true);
  const [saving, setSaving] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  useEffect(() => { setUprightTimerEnabled(currentUser.uprightTimerEnabled === true); }, [currentUser.uprightTimerEnabled]);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => setRemindersEnabled(Boolean(subscription))).catch(() => undefined);
  }, []);
  async function saveUprightTimer() {
    setSaving(true);
    try { await api.patch('/api/me/preferences', { uprightTimerEnabled }); setMessage(`15-minute upright timer ${uprightTimerEnabled ? 'enabled' : 'disabled'}.`); onChanged(); }
    catch (reason) { setMessage((reason as Error).message); }
    finally { setSaving(false); }
  }
  async function toggleReminders() {
    setReminderBusy(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Install Leo Logger to your home screen first, then reopen it to enable alerts.');
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await api.delete('/api/reminders/subscribe', { endpoint: current.endpoint });
        await current.unsubscribe(); setRemindersEnabled(false); setMessage('Feed and timer alerts turned off on this device.'); return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications were not allowed. You can enable them in your phone settings.');
      const config = await api.get<{ configured: boolean; publicKey: string | null }>('/api/reminders/config');
      if (!config.configured || !config.publicKey) throw new Error('Alerts are not available yet.');
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
      await api.post('/api/reminders/subscribe', subscription.toJSON());
      setRemindersEnabled(true); setMessage('Feed and timer alerts enabled on this device.');
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setReminderBusy(false); }
  }
  return <section><h2 className="text-2xl font-black">Schedules</h2><p className="mt-1 text-stone-600">Manage feeding reminders and your post-feed routine.</p><div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="space-y-3">{babies.length ? babies.map((baby) => <BabyScheduleCard key={baby.id} baby={baby} setMessage={setMessage} onChanged={onChanged} />) : <div className="card rounded-3xl bg-white p-5 text-stone-600">Add a baby before setting a feeding schedule.</div>}</div><div className="space-y-4"><div className="card rounded-3xl bg-white p-5"><h3 className="text-lg font-black">Alerts on this device</h3><p className="mt-2 text-stone-600">Get notified when a feed is due and when an enabled upright timer finishes.</p><button type="button" onClick={toggleReminders} disabled={reminderBusy} aria-pressed={remindersEnabled} className={`tap mt-5 flex w-full items-center justify-center gap-2 rounded-xl font-black disabled:opacity-50 ${remindersEnabled ? 'bg-[#4f7b68] text-white' : 'bg-stone-100 text-stone-800'}`}>{remindersEnabled ? <Bell size={20} /> : <BellOff size={20} />}{reminderBusy ? 'Saving…' : remindersEnabled ? 'Alerts are on' : 'Turn on alerts'}</button><p className="mt-2 text-sm text-stone-500">Alerts are enabled separately on each phone or tablet.</p></div><div className="card rounded-3xl bg-white p-5"><h3 className="text-lg font-black">After-feeding upright timer</h3><p className="mt-2 text-stone-600">With alerts enabled, you’ll get a reminder after holding the baby upright for 15 minutes following a feed.</p><label className="mt-5 flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-stone-50 px-4 font-bold"><span>15-minute upright timer</span><input type="checkbox" checked={uprightTimerEnabled} onChange={(event) => setUprightTimerEnabled(event.target.checked)} className="size-6 accent-[#4f7b68]" /></label><button type="button" onClick={saveUprightTimer} disabled={saving} className="tap mt-4 w-full rounded-xl bg-[#4f7b68] font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save timer preference'}</button><p className="mt-2 text-sm text-stone-500">This preference applies to your caregiver account.</p></div></div></div></section>;
}

function Babies({ babies, setMessage, onChanged, onRemoved }: { babies: Baby[]; setMessage: (message: string) => void; onChanged: () => void; onRemoved: (id: string) => void }) {
  const [babyName, setBabyName] = useState(''); const [birthDate, setBirthDate] = useState(''); const [removingId, setRemovingId] = useState('');
  async function addBaby(event: React.FormEvent) { event.preventDefault(); const name = babyName.trim(); try { await api.post('/api/admin/babies', { name, birthDate: birthDate || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York' }); setBabyName(''); setBirthDate(''); setMessage(`${name} added.`); onChanged(); } catch (reason) { setMessage((reason as Error).message); } }
  async function removeBaby(baby: Baby) {
    if (!confirm(`Remove ${baby.name}? ${baby.name} will no longer appear for caregivers. Existing activity history will be preserved.`)) return;
    setRemovingId(baby.id);
    try { await api.delete(`/api/admin/babies/${baby.id}`); setMessage(`${baby.name} removed.`); onRemoved(baby.id); }
    catch (reason) { setMessage((reason as Error).message); }
    finally { setRemovingId(''); }
  }
  return <section><h2 className="text-2xl font-black">Babies</h2><p className="mt-1 text-stone-600">Add a baby or remove one who no longer needs tracking.</p><div className="mt-4 grid gap-5 lg:grid-cols-2"><form onSubmit={addBaby} className="card h-fit rounded-3xl bg-white p-5"><h3 className="text-lg font-black">Add a baby</h3><label className="mt-4 block font-bold">Baby name<input value={babyName} onChange={(event) => setBabyName(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-stone-200 px-3" required /></label><label className="mt-3 block font-bold">Birth date (optional)<input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-stone-200 px-3" /></label><button className="tap mt-4 w-full rounded-xl bg-[#4f7b68] font-black text-white"><Plus className="mr-2 inline" />Add baby</button></form><div className="space-y-3">{babies.map((baby) => <article key={baby.id} className="card flex items-center justify-between gap-4 rounded-2xl bg-white p-4"><div><p className="font-black">{baby.name}</p><p className="text-sm text-stone-500">{baby.birthDate ? `Born ${baby.birthDate}` : 'Birth date not set'}</p></div><button type="button" onClick={() => removeBaby(baby)} disabled={removingId === baby.id} className="min-h-12 rounded-xl px-3 font-bold text-red-700 disabled:opacity-50" aria-label={`Remove ${baby.name}`}><Trash2 className="mr-1 inline" size={19} />{removingId === baby.id ? 'Removing…' : 'Remove'}</button></article>)}{babies.length === 0 ? <div className="card rounded-3xl bg-white p-5 text-stone-600">No babies have been added yet.</div> : null}</div></div></section>;
}

function BabyScheduleCard({ baby, setMessage, onChanged }: { baby: Baby; setMessage: (message: string) => void; onChanged: () => void }) {
  const [minutes, setMinutes] = useState(baby.feedingIntervalMinutes || 120);
  async function save() {
    try { await api.patch(`/api/schedules/${baby.id}`, { feedingIntervalMinutes: minutes }); setMessage(`${baby.name}'s feeding reminder is now every ${number(minutes / 60)} hours.`); onChanged(); }
    catch (reason) { setMessage((reason as Error).message); }
  }
  return <div className="card rounded-2xl bg-white p-4"><p className="font-black">{baby.name}</p><p className="text-sm text-stone-500">{baby.birthDate ? `Born ${baby.birthDate} · ` : ''}{baby.timezone}</p><label className="mt-3 block font-bold">Feed reminder interval<div className="mt-1 flex gap-2"><input type="number" min={15} max={720} step={15} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} className="h-12 min-w-0 flex-1 rounded-xl border-2 border-stone-200 px-3" /><span className="grid place-items-center text-sm text-stone-500">minutes</span><button onClick={save} className="rounded-xl bg-[#4f7b68] px-4 font-black text-white">Save</button></div></label><p className="mt-2 text-sm text-stone-500">Currently every {number(minutes / 60)} hours. A feed automatically resets the timer.</p></div>;
}

function CaregiverCard({ user, babies, onChanged, setMessage }: { user: User; babies: Baby[]; onChanged: () => void; setMessage: (message: string) => void }) {
  const [name, setName] = useState(user.displayName);
  const [allowed, setAllowed] = useState(user.allowedBabyIds);
  const [defaultBabyId, setDefaultBabyId] = useState(user.defaultBabyId || user.allowedBabyIds[0] || '');
  async function saveCaregiver() {
    const displayName = name.trim();
    if (!displayName) return setMessage('Enter a caregiver name.');
    if (!allowed.length) return setMessage('A caregiver needs access to at least one baby.');
    const nextDefault = allowed.includes(defaultBabyId) ? defaultBabyId : allowed[0];
    try { await api.patch(`/api/admin/users/${user.id}`, { displayName, allowedBabyIds: allowed, defaultBabyId: nextDefault }); setDefaultBabyId(nextDefault); setMessage(`${displayName}'s details updated.`); onChanged(); }
    catch (reason) { setMessage((reason as Error).message); }
  }
  async function resetPin() {
    const pin = prompt(`New six-digit PIN for ${name.trim() || user.displayName}`)?.replace(/\D/g, '');
    if (!pin) return;
    if (!/^\d{6}$/.test(pin)) return setMessage('The PIN must contain exactly six digits.');
    try { await api.patch(`/api/admin/users/${user.id}`, { pin }); setMessage(`${name.trim() || user.displayName}'s PIN was reset.`); }
    catch (reason) { setMessage((reason as Error).message); }
  }
  return <details className="card rounded-2xl bg-white p-4"><summary className="cursor-pointer list-none"><p className="font-black">{user.displayName}</p><p className="text-sm text-stone-500">Caregiver · {user.active ? 'Active' : 'Disabled'} · tap to edit</p></summary><div className="mt-4 border-t border-stone-100 pt-3"><label className="block font-bold">Caregiver name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="mt-1 h-12 w-full rounded-xl border-2 border-stone-200 px-3" /></label><fieldset className="mt-4"><legend className="font-bold">Baby access</legend>{babies.map((baby) => <label key={baby.id} className="flex min-h-12 items-center gap-3"><input type="checkbox" className="size-5 accent-[#4f7b68]" checked={allowed.includes(baby.id)} onChange={(event) => setAllowed((current) => event.target.checked ? [...current, baby.id] : current.filter((id) => id !== baby.id))} />{baby.name}</label>)}<label className="mt-2 block font-bold">Default baby<select value={defaultBabyId} onChange={(event) => setDefaultBabyId(event.target.value)} className="mt-1 h-12 w-full rounded-xl border bg-white px-3">{babies.filter((baby) => allowed.includes(baby.id)).map((baby) => <option value={baby.id} key={baby.id}>{baby.name}</option>)}</select></label></fieldset><button onClick={saveCaregiver} className="tap mt-3 w-full rounded-xl bg-[#4f7b68] font-black text-white">Save caregiver</button></div><div className="mt-3 flex flex-wrap gap-4"><button onClick={resetPin} className="min-h-12 font-bold text-[#4f7b68] underline">Reset PIN</button>{user.active ? <button onClick={async () => { await api.patch(`/api/admin/users/${user.id}`, { active: false }); setMessage(`${user.displayName} disabled and signed out.`); onChanged(); }} className="min-h-12 font-bold text-red-700 underline">Disable and sign out</button> : <button onClick={async () => { await api.patch(`/api/admin/users/${user.id}`, { active: true }); setMessage(`${user.displayName} enabled.`); onChanged(); }} className="min-h-12 font-bold text-[#4f7b68] underline">Enable</button>}</div></details>;
}

function Settings({ setMessage, onChanged }: { setMessage: (message: string) => void; onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState('');
  const [aiEnabled, setAiEnabled] = useState<boolean>(); const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.get<{ settings: { aiEnabled: boolean } }>('/api/admin/ai-settings').then((result) => { if (!cancelled) setAiEnabled(result.settings.aiEnabled); }).catch((reason) => { if (!cancelled) setMessage((reason as Error).message); });
    return () => { cancelled = true; };
  }, [setMessage]);
  async function changePassword(event: React.FormEvent) { event.preventDefault(); try { await api.post('/api/auth/password/change', { currentPassword, newPassword }); setCurrentPassword(''); setNewPassword(''); setMessage('Password changed.'); onChanged(); } catch (reason) { setMessage((reason as Error).message); } }
  async function addPasskey() { try { const result = await api.post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/api/auth/passkeys/register/options'); const credential = await startRegistration({ optionsJSON: result.options }); await api.post('/api/auth/passkeys/register/verify', { challengeId: result.challengeId, response: credential }); setMessage('Passkey added to this account.'); } catch (reason) { setMessage((reason as Error).message); } }
  async function toggleAi() {
    if (aiEnabled === undefined) return;
    const next = !aiEnabled; setAiBusy(true);
    try { const result = await api.patch<{ settings: { aiEnabled: boolean } }>('/api/admin/ai-settings', { aiEnabled: next }); setAiEnabled(result.settings.aiEnabled); setMessage(`AI features turned ${result.settings.aiEnabled ? 'on' : 'off'} for this household.`); onChanged(); }
    catch (reason) { setMessage((reason as Error).message); }
    finally { setAiBusy(false); }
  }
  return <section className="grid gap-5 lg:grid-cols-2"><form onSubmit={changePassword} className="card rounded-3xl bg-white p-5"><h2 className="text-xl font-black">Change recovery password</h2><label className="mt-4 block font-bold">Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" className="mt-1 h-14 w-full rounded-xl border-2 border-stone-200 px-3" /></label><label className="mt-3 block font-bold">New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} autoComplete="new-password" className="mt-1 h-14 w-full rounded-xl border-2 border-stone-200 px-3" /></label><button className="tap mt-4 w-full rounded-xl bg-[#4f7b68] font-black text-white">Change password</button></form><div className="card rounded-3xl bg-white p-5"><h2 className="text-xl font-black">Face ID or passkey</h2><p className="mt-2 text-stone-600">Register this phone or computer for quick, secure admin sign-in.</p><button onClick={addPasskey} className="tap mt-5 w-full rounded-xl border-2 border-[#4f7b68] font-black text-[#4f7b68]"><KeyRound className="mr-2 inline" />Add a passkey</button></div><div className="card rounded-3xl bg-white p-5 lg:col-span-2"><h2 className="text-xl font-black">AI privacy</h2><p className="mt-2 max-w-3xl text-stone-600">Control hosted AI insights, natural-language interpretation, and voice transcription for this household. Simple typed activity logging and every one-tap button keep working when this is off.</p><div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-stone-50 p-4"><div><p className="font-black">AI features</p><p className="text-sm text-stone-500">{aiEnabled === undefined ? 'Checking current setting…' : aiEnabled ? 'Enabled for this household' : 'Disabled for this household'}</p></div><button type="button" onClick={toggleAi} disabled={aiBusy || aiEnabled === undefined} aria-pressed={aiEnabled === true} className={`min-h-12 min-w-24 rounded-full px-5 font-black disabled:opacity-50 ${aiEnabled ? 'bg-[#4f7b68] text-white' : 'bg-stone-200 text-stone-800'}`}>{aiBusy ? 'Saving…' : aiEnabled ? 'On' : 'Off'}</button></div><p className="mt-3 text-sm text-stone-500">Only an admin can change this household-wide setting. Provider choices and billing are intentionally not exposed yet.</p></div></section>;
}
