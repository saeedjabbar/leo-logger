import { useState } from 'react';
import { LogOut, Settings, X } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';
import DeviceAlerts from './DeviceAlerts';

export default function CaregiverSettingsSheet({ user, onClose, onAdmin, onLogout, onUserChanged, onAlertsChanged }: { user: User; onClose: () => void; onAdmin: () => void; onLogout: () => void; onUserChanged: (user: User) => void; onAlertsChanged: (enabled: boolean) => void }) {
  const [uprightTimerEnabled, setUprightTimerEnabled] = useState(user.uprightTimerEnabled === true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function saveUprightTimer() {
    setSaving(true); setMessage('');
    try {
      const result = await api.patch<{ user: User }>('/api/me/preferences', { uprightTimerEnabled });
      onUserChanged(result.user);
      setMessage(`15-minute upright timer ${uprightTimerEnabled ? 'enabled' : 'disabled'}.`);
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="home-settings-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#f6f3ed] p-5 shadow-2xl"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wider text-[#4f7b68]">Account</p><h2 id="home-settings-title" className="text-2xl font-black">Settings</h2></div><button type="button" onClick={onClose} className="grid size-12 place-items-center rounded-full bg-white" aria-label="Close settings"><X /></button></div>{message ? <p role="status" className="mt-4 rounded-2xl bg-amber-50 p-3 font-bold">{message}</p> : null}<div className="mt-4 space-y-4"><DeviceAlerts setMessage={setMessage} onChanged={onAlertsChanged} /><div className="card rounded-3xl bg-white p-5"><h2 className="text-xl font-black">After-feeding upright timer</h2><p className="mt-2 text-stone-600">Show a 15-minute countdown after each feed and alert you when upright time is complete.</p><label className="mt-5 flex min-h-14 cursor-pointer items-center justify-between gap-4 rounded-2xl bg-stone-50 px-4 font-bold"><span>15-minute upright timer</span><input type="checkbox" checked={uprightTimerEnabled} onChange={(event) => setUprightTimerEnabled(event.target.checked)} className="size-6 accent-[#4f7b68]" /></label><button type="button" onClick={saveUprightTimer} disabled={saving} className="tap mt-4 w-full rounded-xl bg-[#4f7b68] font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save timer preference'}</button><p className="mt-2 text-sm text-stone-500">This applies only to your caregiver account.</p></div>{user.role === 'admin' ? <button type="button" onClick={() => { onClose(); onAdmin(); }} className="tap flex w-full items-center justify-center gap-2 rounded-xl bg-[#4f7b68] font-black text-white"><Settings size={20} />Caregiver dashboard and settings</button> : null}<button type="button" onClick={onLogout} className="tap flex w-full items-center justify-center gap-2 rounded-xl bg-white font-black text-red-700"><LogOut size={20} />Sign out</button></div></section></div>;
}
