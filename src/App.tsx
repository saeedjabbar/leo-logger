import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './api';
import type { MeResponse } from './types';
import Login from './components/Login';
import Logger from './components/Logger';

const Admin = lazy(() => import('./components/Admin'));

export default function App() {
  const [me, setMe] = useState<MeResponse>();
  const [loading, setLoading] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);

  async function refresh() {
    try { setMe(await api.get<MeResponse>('/api/me')); } catch { setMe(undefined); } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function logout() { await api.post('/api/auth/logout').catch(() => undefined); setMe(undefined); setAdminOpen(false); }
  function onLogin() { refresh(); }

  if (loading) return <main className="grid min-h-dvh place-items-center"><p className="text-xl font-black">Opening Leo Logger…</p></main>;
  if (!me) return <Login onLogin={onLogin} />;
  if (adminOpen && me.user.role === 'admin') return <Suspense fallback={<main className="grid min-h-dvh place-items-center"><p className="font-black">Loading dashboard…</p></main>}><Admin currentUser={me.user} initialBabies={me.babies} onBack={() => setAdminOpen(false)} onChanged={refresh} /></Suspense>;
  return <Logger user={me.user} babies={me.babies} initialSleep={me.activeSleep} onAdmin={() => setAdminOpen(true)} onLogout={logout} onBabyChanged={(baby) => setMe((current) => current ? { ...current, babies: current.babies.map((item) => item.id === baby.id ? baby : item) } : current)} />;
}
