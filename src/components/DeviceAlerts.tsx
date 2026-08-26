import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { api } from '../api';

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default function DeviceAlerts({ setMessage, onChanged }: { setMessage: (message: string) => void; onChanged?: (enabled: boolean) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => setEnabled(Boolean(subscription))).catch(() => undefined);
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Install Leo Logger to your home screen first, then reopen it to enable alerts.');
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await api.delete('/api/reminders/subscribe', { endpoint: current.endpoint });
        await current.unsubscribe(); setEnabled(false); onChanged?.(false); setMessage('Feed and timer alerts turned off on this device.'); return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications were not allowed. You can enable them in your phone settings.');
      const config = await api.get<{ configured: boolean; publicKey: string | null }>('/api/reminders/config');
      if (!config.configured || !config.publicKey) throw new Error('Alerts are not available yet.');
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
      await api.post('/api/reminders/subscribe', subscription.toJSON());
      setEnabled(true); onChanged?.(true); setMessage('Feed and timer alerts enabled on this device.');
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="card rounded-3xl bg-white p-5"><h2 className="text-xl font-black">Alerts on this device</h2><p className="mt-2 text-stone-600">Get background notifications when a feed is due and when the upright timer finishes.</p><button type="button" onClick={toggle} disabled={busy} aria-pressed={enabled} className={`tap mt-5 flex w-full items-center justify-center gap-2 rounded-xl font-black disabled:opacity-50 ${enabled ? 'bg-[#4f7b68] text-white' : 'bg-stone-100 text-stone-800'}`}>{enabled ? <Bell size={20} /> : <BellOff size={20} />}{busy ? 'Saving…' : enabled ? 'Alerts are on' : 'Turn on alerts'}</button><p className="mt-2 text-sm text-stone-500">Set this separately on each phone or tablet. When enabled, the feeding reminder also appears on Home.</p></div>;
}
