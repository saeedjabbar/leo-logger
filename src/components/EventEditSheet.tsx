import { useState } from 'react';
import { Clock3, Save, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { BabyEvent } from '../types';

function localDateTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function titleFor(event: BabyEvent) {
  if (event.type === 'feed') return 'Edit feeding';
  if (event.type === 'diaper') return 'Edit diaper';
  if (event.type === 'sleep') return 'Edit sleep';
  return 'Edit activity';
}

export default function EventEditSheet({ event, onClose, onUpdated, onDeleted }: { event: BabyEvent; onClose: () => void; onUpdated: (event: BabyEvent) => void; onDeleted: (event: BabyEvent) => void }) {
  const [startAt, setStartAt] = useState(() => localDateTime(event.startAt));
  const [endAt, setEndAt] = useState(() => localDateTime(event.endAt));
  const [diaper, setDiaper] = useState(event.diaper || 'pee');
  const [ounces, setOunces] = useState(String(event.feed?.ounces ?? ''));
  const [source, setSource] = useState(event.feed?.source || 'formula');
  const [formulaOunces, setFormulaOunces] = useState(String(event.feed?.formulaOunces ?? ''));
  const [breastMilkOunces, setBreastMilkOunces] = useState(String(event.feed?.breastMilkOunces ?? ''));
  const [notes, setNotes] = useState(event.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const total = Number(ounces);
  const hasSplit = formulaOunces !== '' || breastMilkOunces !== '';
  const split = Number(formulaOunces || 0) + Number(breastMilkOunces || 0);
  const validSplit = source !== 'combo' || !hasSplit || Math.abs(total - split) < .001;
  const validSleep = event.type !== 'sleep' || !event.endAt || Boolean(endAt);
  const valid = Boolean(startAt) && (event.type !== 'feed' || total > 0) && validSplit && validSleep;

  async function save(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!valid) return;
    setBusy(true); setError('');
    const body: Record<string, unknown> = { startAt: new Date(startAt).toISOString(), notes: notes.trim() };
    if (event.type === 'diaper') body.diaper = diaper;
    if (event.type === 'feed') body.feed = {
      ounces: total, source,
      ...(source === 'combo' && hasSplit ? { formulaOunces: Number(formulaOunces || 0), breastMilkOunces: Number(breastMilkOunces || 0) } : {}),
    };
    if (event.type === 'sleep' && endAt) body.endAt = new Date(endAt).toISOString();
    try {
      const result = await api.patch<{ event: BabyEvent }>(`/api/events/${event.id}`, body);
      onUpdated(result.event);
    } catch (reason) { setError((reason as Error).message); setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError('');
    try {
      await api.delete(`/api/events/${event.id}`);
      onDeleted(event);
    } catch (reason) { setError((reason as Error).message); setBusy(false); }
  }

  return <div className="fixed inset-0 z-40 flex items-end bg-stone-900/40 md:items-center md:justify-center" role="dialog" aria-modal="true" aria-labelledby="edit-event-title" onClick={onClose}>
    <form className="safe-bottom max-h-[94dvh] w-full overflow-y-auto rounded-t-[2rem] bg-white p-5 md:max-w-xl md:rounded-[2rem]" onSubmit={save} onClick={(clickEvent) => clickEvent.stopPropagation()}>
      <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-stone-200" />
      <div className="flex items-center justify-between"><div><p className="text-sm font-bold uppercase tracking-wide text-[#4f7b68]">Activity details</p><h2 id="edit-event-title" className="text-2xl font-black">{titleFor(event)}</h2></div><button type="button" onClick={onClose} aria-label="Close editor" className="grid size-12 place-items-center rounded-full bg-stone-100"><X /></button></div>

      <label className="mt-5 block font-bold" htmlFor="event-start"><span className="flex items-center gap-2"><Clock3 size={19} />Exact date and time</span><input id="event-start" type="datetime-local" step="60" value={startAt} onChange={(inputEvent) => setStartAt(inputEvent.target.value)} className="mt-2 h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-3 text-lg outline-none focus:border-[#4f7b68]" required /></label>

      {event.type === 'diaper' ? <fieldset className="mt-5"><legend className="font-bold">What was in the diaper?</legend><div className="mt-2 grid grid-cols-3 gap-2">{([['pee', 'Pee'], ['poop', 'Poop'], ['both', 'Both']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => setDiaper(value)} className={`tap rounded-2xl px-2 font-bold ${diaper === value ? 'bg-[#4f7b68] text-white' : 'bg-stone-100'}`}>{label}</button>)}</div></fieldset> : null}

      {event.type === 'feed' ? <><label className="mt-5 block font-bold">Ounces<input value={ounces} onChange={(inputEvent) => setOunces(inputEvent.target.value)} inputMode="decimal" className="mt-2 h-14 w-full rounded-2xl border-2 border-stone-200 px-3 text-2xl font-black outline-none focus:border-[#4f7b68]" /></label><fieldset className="mt-5"><legend className="font-bold">Milk type</legend><div className="mt-2 grid grid-cols-3 gap-2">{([['formula', 'Formula'], ['breast_milk', 'Breast milk'], ['combo', 'Combo']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => setSource(value)} className={`tap rounded-2xl px-2 font-bold ${source === value ? 'bg-[#4f7b68] text-white' : 'bg-stone-100'}`}>{label}</button>)}</div></fieldset>{source === 'combo' ? <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-amber-50 p-4"><label className="text-sm font-bold">Formula oz<input value={formulaOunces} onChange={(inputEvent) => setFormulaOunces(inputEvent.target.value)} inputMode="decimal" className="mt-1 h-12 w-full rounded-xl border-2 border-white px-3" /></label><label className="text-sm font-bold">Breast milk oz<input value={breastMilkOunces} onChange={(inputEvent) => setBreastMilkOunces(inputEvent.target.value)} inputMode="decimal" className="mt-1 h-12 w-full rounded-xl border-2 border-white px-3" /></label>{!validSplit ? <p className="col-span-2 text-sm font-bold text-red-700">The split must add up to {total || 0} oz.</p> : null}</div> : null}</> : null}

      {event.type === 'sleep' ? <label className="mt-5 block font-bold">Wake date and time {event.endAt ? '' : '(optional)'}<input type="datetime-local" step="60" value={endAt} onChange={(inputEvent) => setEndAt(inputEvent.target.value)} className="mt-2 h-14 w-full rounded-2xl border-2 border-stone-200 bg-white px-3 text-lg outline-none focus:border-[#4f7b68]" required={Boolean(event.endAt)} /></label> : null}

      <label className="mt-5 block font-bold">Notes (optional)<textarea value={notes} onChange={(inputEvent) => setNotes(inputEvent.target.value)} maxLength={500} rows={3} className="mt-2 w-full rounded-2xl border-2 border-stone-200 p-3 outline-none focus:border-[#4f7b68]" placeholder="Anything else the family should know?" /></label>
      {error ? <p role="alert" className="mt-4 rounded-2xl bg-red-50 p-3 font-bold text-red-800">{error}</p> : null}
      <button disabled={!valid || busy} className="tap mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4f7b68] text-xl font-black text-white disabled:opacity-40"><Save />{busy ? 'Saving…' : 'Save changes'}</button>
      {!confirmDelete ? <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl font-black text-red-700 disabled:opacity-40"><Trash2 />Delete this entry</button> : <div className="mt-4 rounded-2xl bg-red-50 p-4"><p className="font-black text-red-900">Delete this entry?</p><p className="mt-1 text-sm text-red-800">It will disappear from the family activity and insights.</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="min-h-12 rounded-xl bg-white font-black">Keep it</button><button type="button" onClick={remove} disabled={busy} className="min-h-12 rounded-xl bg-red-700 px-3 font-black text-white disabled:opacity-40">{busy ? 'Deleting…' : 'Yes, delete'}</button></div></div>}
    </form>
  </div>;
}
