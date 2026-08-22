import { useState } from 'react';
import { Baby as BabyIcon, X } from 'lucide-react';
import { api } from '../api';
import type { Baby } from '../types';

const TIMEZONES = [
  ['America/New_York', 'Eastern time'],
  ['America/Chicago', 'Central time'],
  ['America/Denver', 'Mountain time'],
  ['America/Phoenix', 'Arizona time'],
  ['America/Los_Angeles', 'Pacific time'],
  ['America/Anchorage', 'Alaska time'],
  ['Pacific/Honolulu', 'Hawaii time'],
  ['Europe/London', 'London'],
  ['Europe/Paris', 'Central Europe'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Karachi', 'Pakistan'],
  ['Asia/Kolkata', 'India'],
  ['Asia/Tokyo', 'Japan'],
  ['Australia/Sydney', 'Sydney'],
  ['UTC', 'UTC'],
] as const;

export default function BabyProfileSheet({ baby, onClose, onUpdated }: { baby: Baby; onClose: () => void; onUpdated: (baby: Baby) => void }) {
  const [name, setName] = useState(baby.name);
  const [birthDate, setBirthDate] = useState(baby.birthDate || '');
  const [timezone, setTimezone] = useState(baby.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timezoneOptions = TIMEZONES.some(([value]) => value === baby.timezone)
    ? TIMEZONES
    : [[baby.timezone, baby.timezone] as const, ...TIMEZONES];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return setError('Enter a name.');
    setBusy(true); setError('');
    try {
      const result = await api.patch<{ baby: Baby }>(`/api/admin/babies/${baby.id}`, { name: cleanName, birthDate, timezone });
      onUpdated(result.baby);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }

  return <div className="fixed inset-0 z-40 flex items-end bg-stone-900/40 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="baby-profile-title" onClick={onClose}>
    <form onSubmit={save} onClick={(event) => event.stopPropagation()} className="safe-bottom max-h-[92dvh] w-full overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-[2rem]">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-[#fff0d7] text-[#d28a3c]"><BabyIcon /></span><div><p className="text-sm font-bold uppercase tracking-wide text-[#4f7b68]">Baby profile</p><h2 id="baby-profile-title" className="text-2xl font-black">Edit {baby.name}</h2></div></div>
        <button type="button" onClick={onClose} aria-label="Close baby profile" className="grid size-12 shrink-0 place-items-center rounded-full bg-stone-100"><X /></button>
      </header>

      <label className="mt-6 block font-bold">Name<input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-14 w-full rounded-2xl border-2 border-stone-200 px-4 text-lg outline-none focus:border-[#4f7b68]" /></label>
      <label className="mt-4 block font-bold">Birth date <span className="font-normal text-stone-500">(optional)</span><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} className="mt-2 h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-4 text-lg outline-none focus:border-[#4f7b68]" /></label>
      <label className="mt-4 block font-bold">Timezone<select required value={timezone} onChange={(event) => setTimezone(event.target.value)} className="mt-2 h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-4 text-lg outline-none focus:border-[#4f7b68]">{timezoneOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <p className="mt-2 text-sm text-stone-500">Used to show activity at the correct local time.</p>
      {error ? <p role="alert" className="mt-4 rounded-2xl bg-red-50 p-3 font-bold text-red-700">{error}</p> : null}
      <div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="tap rounded-2xl bg-stone-100 font-black">Cancel</button><button disabled={busy || !name.trim()} className="tap rounded-2xl bg-[#4f7b68] font-black text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save profile'}</button></div>
    </form>
  </div>;
}
