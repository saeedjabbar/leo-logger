import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { Baby, KeyRound, Mail } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';

export default function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'caregiver' | 'admin'>('caregiver');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState(localStorage.getItem('leo-admin-email') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitPin(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api.post<{ user: User }>('/api/auth/pin', { pin }); onLogin(result.user); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api.post<{ user: User }>('/api/auth/password', { email, password }); localStorage.setItem('leo-admin-email', email); onLogin(result.user); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  async function usePasskey() {
    setBusy(true); setError('');
    try {
      const challenge = await api.post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/api/auth/passkeys/login/options', { email });
      const credential = await startAuthentication({ optionsJSON: challenge.options });
      const result = await api.post<{ user: User }>('/api/auth/passkeys/login/verify', { challengeId: challenge.challengeId, response: credential });
      localStorage.setItem('leo-admin-email', email); onLogin(result.user);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  return <main className="safe-top safe-bottom mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
    <div className="mb-8 text-center">
      <div className="mx-auto mb-4 grid size-20 place-items-center rounded-[2rem] bg-[#f4bd76] text-white"><Baby size={44} strokeWidth={2.4} /></div>
      <h1 className="text-4xl font-black tracking-tight">Leo Logger</h1>
      <p className="mt-2 text-lg text-stone-600">Baby care, one easy tap at a time.</p>
    </div>
    <div className="card rounded-3xl bg-white p-5">
      <div className="mb-5 grid grid-cols-2 rounded-2xl bg-stone-100 p-1" role="tablist">
        <button className={`tap rounded-xl font-bold ${mode === 'caregiver' ? 'bg-white shadow-sm' : ''}`} onClick={() => setMode('caregiver')}>Caregiver PIN</button>
        <button className={`tap rounded-xl font-bold ${mode === 'admin' ? 'bg-white shadow-sm' : ''}`} onClick={() => setMode('admin')}>Parent admin</button>
      </div>
      {mode === 'caregiver' ? <form onSubmit={submitPin}>
        <label className="font-bold" htmlFor="pin">Your six-digit PIN</label>
        <div className="mt-2 flex items-center rounded-2xl border-2 border-stone-200 px-4 focus-within:border-amber-500"><KeyRound className="text-stone-400" /><input id="pin" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="h-16 w-full bg-transparent px-3 text-center text-3xl font-black tracking-[.3em] outline-none" aria-describedby="login-error" /></div>
        <button disabled={busy || pin.length !== 6} className="tap mt-5 w-full rounded-2xl bg-[#4f7b68] text-xl font-black text-white disabled:opacity-40">Open my logger</button>
        <p className="mt-4 text-center text-sm text-stone-500">You only need this once on your phone.</p>
      </form> : <form onSubmit={submitPassword}>
        <label className="font-bold" htmlFor="email">Email</label>
        <div className="mt-2 flex items-center rounded-2xl border-2 border-stone-200 px-4 focus-within:border-amber-500"><Mail className="text-stone-400" /><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" className="h-14 w-full bg-transparent px-3 outline-none" /></div>
        <label className="mt-4 block font-bold" htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="mt-2 h-14 w-full rounded-2xl border-2 border-stone-200 px-4 outline-none focus:border-amber-500" />
        <button disabled={busy} className="tap mt-5 w-full rounded-2xl bg-[#4f7b68] text-lg font-black text-white disabled:opacity-40">Sign in</button>
        <button type="button" disabled={busy || !email} onClick={usePasskey} className="tap mt-3 w-full rounded-2xl border-2 border-stone-200 text-lg font-bold disabled:opacity-40">Use Face ID or passkey</button>
      </form>}
      {error ? <p id="login-error" role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-center font-semibold text-red-700">{error}</p> : null}
    </div>
  </main>;
}
