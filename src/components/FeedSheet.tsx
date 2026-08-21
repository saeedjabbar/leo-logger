import { useState } from 'react';
import { Milk, X } from 'lucide-react';

type Feed = { ounces: number; source: 'formula' | 'breast_milk' | 'combo'; formulaOunces?: number; breastMilkOunces?: number };

export default function FeedSheet({ onClose, onSave, busy }: { onClose: () => void; onSave: (feed: Feed) => void; busy: boolean }) {
  const [ounces, setOunces] = useState('');
  const [source, setSource] = useState<Feed['source']>('formula');
  const [advanced, setAdvanced] = useState(false);
  const [formulaOunces, setFormulaOunces] = useState('');
  const [breastMilkOunces, setBreastMilkOunces] = useState('');
  const total = Number(ounces);
  const split = Number(formulaOunces || 0) + Number(breastMilkOunces || 0);
  const valid = total > 0 && (!advanced || source !== 'combo' || Math.abs(total - split) < .001);

  return <div className="fixed inset-0 z-30 flex items-end bg-stone-900/40" role="dialog" aria-modal="true" aria-labelledby="feed-title" onClick={onClose}>
    <form className="safe-bottom max-h-[94dvh] w-full overflow-y-auto rounded-t-[2rem] bg-white p-5" onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ ounces: total, source, ...(advanced && source === 'combo' ? { formulaOunces: Number(formulaOunces || 0), breastMilkOunces: Number(breastMilkOunces || 0) } : {}) }); }} onClick={(event) => event.stopPropagation()}>
      <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-stone-200" />
      <div className="flex items-center justify-between"><h2 id="feed-title" className="text-2xl font-black">Log a feeding</h2><button type="button" onClick={onClose} aria-label="Close" className="grid size-12 place-items-center rounded-full bg-stone-100"><X /></button></div>
      <label htmlFor="ounces" className="mt-6 block font-bold">How many ounces?</label>
      <div className="mt-2 flex items-center rounded-2xl border-2 border-stone-200 px-4 focus-within:border-[#4f7b68]"><Milk className="text-[#4f7b68]" /><input autoFocus id="ounces" value={ounces} onChange={(event) => setOunces(event.target.value)} inputMode="decimal" placeholder="0" className="h-20 w-full bg-transparent px-3 text-center text-5xl font-black outline-none" /><span className="text-xl font-bold text-stone-500">oz</span></div>
      <div className="mt-3 grid grid-cols-4 gap-2">{[1, 2, 3, 4].map((amount) => <button type="button" key={amount} onClick={() => setOunces(String(amount))} className="tap rounded-xl bg-stone-100 text-lg font-black">{amount} oz</button>)}</div>
      <fieldset className="mt-6"><legend className="font-bold">What kind?</legend><div className="mt-2 grid grid-cols-3 gap-2">{([['formula', 'Formula'], ['breast_milk', 'Breast milk'], ['combo', 'Combo']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => { setSource(value); if (value !== 'combo') setAdvanced(false); }} className={`tap rounded-2xl px-2 font-bold ${source === value ? 'bg-[#4f7b68] text-white' : 'bg-stone-100'}`}>{label}</button>)}</div></fieldset>
      {source === 'combo' ? <div className="mt-4 rounded-2xl bg-amber-50 p-4"><label className="flex min-h-12 items-center gap-3 font-bold"><input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} className="size-6 accent-[#4f7b68]" />Enter the optional split</label>{advanced ? <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-sm font-bold">Formula oz<input value={formulaOunces} onChange={(event) => setFormulaOunces(event.target.value)} inputMode="decimal" className="mt-1 h-14 w-full rounded-xl border-2 border-white bg-white px-3 text-xl outline-none" /></label><label className="text-sm font-bold">Breast milk oz<input value={breastMilkOunces} onChange={(event) => setBreastMilkOunces(event.target.value)} inputMode="decimal" className="mt-1 h-14 w-full rounded-xl border-2 border-white bg-white px-3 text-xl outline-none" /></label>{Math.abs(total - split) >= .001 ? <p className="col-span-2 text-sm font-semibold text-red-700">The split must add up to {total || 0} oz.</p> : null}</div> : null}</div> : null}
      <button disabled={!valid || busy} className="tap mt-6 w-full rounded-2xl bg-[#4f7b68] text-xl font-black text-white disabled:opacity-40">{busy ? 'Saving…' : `Log ${total || 0} oz now`}</button>
    </form>
  </div>;
}
