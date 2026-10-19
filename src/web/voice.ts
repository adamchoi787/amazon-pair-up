// Voice in and out with the Web Speech API. Recognition is available in
// Chromium browsers and Safari; elsewhere the app works by typing.

interface Recognition extends EventTarget {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

const Impl = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

export const canListen = !!Impl;
export const canSpeak = "speechSynthesis" in window;

/** Listen for one utterance. Calls onPartial with interim text; resolves with the final text ("" if nothing heard). */
export function listen(onPartial: (text: string) => void): { done: Promise<string>; stop: () => void } {
  if (!Impl) return { done: Promise.resolve(""), stop: () => undefined };
  const rec = new Impl();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  const done = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onPartial((finalText + interim).trim());
    };
    rec.onerror = (e) => (e.error === "no-speech" || e.error === "aborted" ? resolve("") : reject(new Error(e.error)));
    rec.onend = () => resolve(finalText.trim());
  });
  rec.start();
  return { done, stop: () => rec.stop() };
}

let voice: SpeechSynthesisVoice | undefined;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const lang = (navigator.language || "en-US").toLowerCase();
  voice = voices.find((v) => v.lang.toLowerCase() === lang && /natural|neural|google|samantha|aria/i.test(v.name))
    ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
}
if (canSpeak) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export function speak(text: string) {
  if (!canSpeak || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.03;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
}
