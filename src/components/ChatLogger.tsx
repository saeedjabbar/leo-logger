import { useEffect, useRef, useState } from 'react';
import { Bot, Mic, Send, Square, X } from 'lucide-react';
import { api } from '../api';
import type { Baby, BabyEvent } from '../types';

interface Message { id: string; role: 'user' | 'assistant'; text: string }
interface RecordingSession { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; chunks: Float32Array[]; timeout: number }

function wavBlob(chunks: Float32Array[], inputRate: number) {
  const inputLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const input = new Float32Array(inputLength);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const targetRate = 16_000;
  const outputLength = Math.max(1, Math.floor(input.length * targetRate / inputRate));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) output[index] = input[Math.min(input.length - 1, Math.floor(index * inputRate / targetRate))];
  const buffer = new ArrayBuffer(44 + output.length * 2);
  const view = new DataView(buffer);
  const text = (position: number, value: string) => [...value].forEach((character, index) => view.setUint8(position + index, character.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + output.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, output.length * 2, true);
  for (let index = 0; index < output.length; index += 1) view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, output[index])) * 0x7fff, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

function eventSummary(event: BabyEvent) {
  const time = new Date(event.startAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (event.type === 'feed') return `${event.feed?.ounces} oz ${event.feed?.source.replace('_', ' ')} at ${time}`;
  if (event.type === 'diaper') return `${event.diaper} at ${time}`;
  return `sleep at ${time}`;
}

export default function ChatLogger({ baby, onClose, onLogged }: { baby: Baby; onClose: () => void; onLogged: () => void }) {
  const [messages, setMessages] = useState<Message[]>([{ id: 'welcome', role: 'assistant', text: `Tell me what happened with ${baby.name}, or ask about recent patterns.` }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recording = useRef<RecordingSession | undefined>(undefined);
  useEffect(() => () => {
    const active = recording.current;
    if (active) { window.clearTimeout(active.timeout); active.stream.getTracks().forEach((track) => track.stop()); active.processor.disconnect(); active.source.disconnect(); active.context.close(); }
  }, []);

  async function submit(message = text, inputMode: 'chat' | 'voice' = 'chat') {
    const clean = message.trim(); if (!clean || busy) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: clean }]);
    setText(''); setBusy(true);
    try {
      const result = await api.post<{ reply: string; events: BabyEvent[]; clarificationNeeded: boolean }>('/api/chat', { babyId: baby.id, message: clean, inputMode });
      const logged = result.events.length ? ` Logged: ${result.events.map(eventSummary).join(', ')}.` : '';
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: `${result.reply}${logged}` }]);
      if (result.events.length) onLogged();
    } catch (reason) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: (reason as Error).message }]);
    } finally { setBusy(false); }
  }

  async function finishVoice() {
    const active = recording.current; if (!active) return;
    recording.current = undefined; window.clearTimeout(active.timeout); setListening(false);
    active.processor.disconnect(); active.source.disconnect(); active.stream.getTracks().forEach((track) => track.stop());
    await active.context.close();
    try {
      setBusy(true);
      const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wavBlob(active.chunks, active.context.sampleRate) });
      const result = await response.json() as { transcript?: string; error?: string };
      if (!response.ok || !result.transcript) throw new Error(result.error || 'Voice could not be transcribed');
      setText(result.transcript); setBusy(false); await submit(result.transcript, 'voice');
    } catch (reason) {
      setBusy(false); setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: (reason as Error).message }]);
    }
  }

  async function toggleVoice() {
    if (listening) { await finishVoice(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: 'Voice recording is not available in this browser.' }]); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor); processor.connect(context.destination);
      const timeout = window.setTimeout(() => finishVoice(), 12_000);
      recording.current = { stream, context, source, processor, chunks, timeout };
      setListening(true);
    } catch { setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: 'Microphone access was not allowed. Enable it in your browser settings and try again.' }]); }
  }

  return <div className="fixed inset-0 z-40 flex items-end bg-stone-900/40 md:items-center md:justify-center" role="dialog" aria-modal="true" aria-labelledby="chat-title" onClick={onClose}>
    <section className="safe-bottom flex h-[92dvh] w-full flex-col rounded-t-[2rem] bg-[#fffaf2] md:h-[760px] md:max-h-[90dvh] md:max-w-lg md:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-center justify-between border-b border-stone-200 p-4"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#4f7b68] text-white"><Bot /></span><div><h2 id="chat-title" className="text-xl font-black">Tell Leo Logger</h2><p className="text-sm text-stone-500">Log activities or ask about the data</p></div></div><button onClick={onClose} aria-label="Close chat" className="grid size-12 place-items-center rounded-full bg-white"><X /></button></header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">{messages.map((message) => <div key={message.id} className={`max-w-[88%] rounded-2xl p-3 ${message.role === 'user' ? 'ml-auto bg-[#4f7b68] text-white' : 'bg-white shadow-sm'}`}><p className="whitespace-pre-wrap font-medium">{message.text}</p></div>)}{busy ? <div className="w-fit rounded-2xl bg-white p-3 font-bold text-stone-500">Thinking…</div> : null}</div>
      <div className="border-t border-stone-200 bg-white p-3"><div className="mb-2 flex gap-2 overflow-x-auto text-sm"><button onClick={() => setText(`I fed ${baby.name} 2 oz at 2:10am`)} className="min-w-max rounded-full bg-stone-100 px-3 py-2 font-bold">“Fed 2 oz at 2:10am”</button><button onClick={() => setText('What patterns do you see this week?')} className="min-w-max rounded-full bg-stone-100 px-3 py-2 font-bold">“Patterns this week?”</button></div><form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); submit(); }}><textarea value={text} onChange={(event) => setText(event.target.value)} rows={2} placeholder="Type what happened…" className="min-h-14 flex-1 resize-none rounded-2xl border-2 border-stone-200 px-3 py-3 outline-none focus:border-[#4f7b68]" /><button type="button" onClick={toggleVoice} className={`grid size-14 shrink-0 place-items-center rounded-2xl ${listening ? 'bg-red-600 text-white' : 'bg-stone-100'}`} aria-label={listening ? 'Stop listening' : 'Speak activity'}>{listening ? <Square /> : <Mic />}</button><button disabled={!text.trim() || busy} className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#4f7b68] text-white disabled:opacity-40" aria-label="Send"><Send /></button></form><p className="mt-2 text-center text-xs text-stone-500">Activities log automatically. AI insights are descriptive, not medical advice.</p></div>
    </section>
  </div>;
}
