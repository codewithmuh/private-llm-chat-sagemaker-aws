/**
 * The microphone button: record the user and turn it into text.
 *
 * 1. getUserMedia + MediaRecorder record the microphone (WebM/Opus in Chrome
 *    and Firefox, MP4/AAC in Safari).
 * 2. The browser decodes the recording and resamples it to a 16 kHz mono WAV,
 *    the format Whisper works with, so the server needs no audio converter.
 *    16 kHz x 16 bit = 32 KB per second: a minute is about 2 MB.
 * 3. POST /api/speech/transcribe/ returns the text (backend/apps/speech).
 *
 * The microphone only works on https:// pages and on localhost: browsers block
 * it elsewhere.
 */
import { apiUrl, csrfHeaders, isAbortError, networkError, toApiError } from "./api";

export const MAX_RECORDING_SECONDS = 120;
const SAMPLE_RATE = 16_000;

export function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

export interface Recording {
  /** Stop recording and get the audio. */
  stop: () => Promise<Blob>;
  /** Stop recording and throw the audio away. */
  cancel: () => void;
}

/** Asks for the microphone (the browser shows its permission prompt once). */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      // Release the microphone, which also turns off the browser's indicator.
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
  });
  recorder.start();
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  return {
    stop: () => {
      stop();
      return stopped;
    },
    cancel: stop,
  };
}

/** Any recording the browser can play, as a 16 kHz mono 16-bit WAV. */
export async function toWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await recording.arrayBuffer());
  } finally {
    void context.close();
  }
  // Rendering into a 1-channel, 16 kHz context resamples and mixes to mono.
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), SAMPLE_RATE);
}

/** A WAV file is a 44-byte header followed by the 16-bit samples. */
function encodeWav(samples: Float32Array, rate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // size of this "fmt " block
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/** The words in the recording ("" when nothing was said). */
export async function transcribe(wav: Blob, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("audio", wav, "speech.wav");
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/speech/transcribe/"), {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", ...(await csrfHeaders()) },
      body: form,
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw networkError();
  }
  if (!res.ok) throw await toApiError(res);
  return ((await res.json()) as { text: string }).text;
}
