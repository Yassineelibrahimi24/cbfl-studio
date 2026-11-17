import { FACTORY } from '../types';
import { hashNoise } from '../util';

function envSample(t: number, decay: number): number {
  return Math.exp(-t * decay);
}

export function makeKick(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = 0.38;
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 46 + 150 * Math.exp(-t * 32);
    phase += (2 * Math.PI * f) / sr;
    const body = Math.sin(phase) * envSample(t, 8);
    const click = hashNoise(i, 1) * envSample(t, 220);
    d[i] = Math.max(-1, Math.min(1, body * 0.95 + click * 0.42));
  }
  return buf;
}

export function makeSnare(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = 0.28;
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const tone = Math.sin(2 * Math.PI * 186 * t) * envSample(t, 24);
    const noise = hashNoise(i, 2) * envSample(t, 16);
    const snap = hashNoise(i, 3) * envSample(t, 70);
    d[i] = Math.max(-1, Math.min(1, tone * 0.35 + noise * 0.55 + snap * 0.25));
  }
  return buf;
}

export function makeHat(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = 0.07;
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = hashNoise(i, 4);
    const hp = n - prev;
    prev = n;
    const metal = Math.sin(2 * Math.PI * 7200 * t) * 0.15;
    d[i] = Math.max(-1, Math.min(1, (hp * 0.85 + metal) * envSample(t, 62)));
  }
  return buf;
}

export function makeClap(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = 0.32;
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const bursts = [0, 0.011, 0.023];
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    for (let b = 0; b < bursts.length; b++) {
      const x = t - bursts[b];
      if (x >= 0 && x < 0.09) s += hashNoise(i, 5 + b) * envSample(x, 38) * (b === 2 ? 1.15 : 0.7);
    }
    const tail = hashNoise(i, 9) * envSample(t, 12) * 0.35;
    d[i] = Math.max(-1, Math.min(1, s * 0.75 + tail));
  }
  return buf;
}

export function makeImpulse(ctx: BaseAudioContext, seconds = 1.5): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const n = hashNoise(i, 20 + ch);
      d[i] = n * Math.pow(1 - t / seconds, 3.2) * 0.45;
    }
  }
  return buf;
}

export function factoryBuffers(ctx: BaseAudioContext): Map<string, AudioBuffer> {
  return new Map<string, AudioBuffer>([
    [FACTORY.kick, makeKick(ctx)],
    [FACTORY.snare, makeSnare(ctx)],
    [FACTORY.hat, makeHat(ctx)],
    [FACTORY.clap, makeClap(ctx)],
  ]);
}

export const FACTORY_NAMES: { id: string; name: string }[] = [
  { id: FACTORY.kick, name: 'Kick' },
  { id: FACTORY.snare, name: 'Snare' },
  { id: FACTORY.hat, name: 'Hat' },
  { id: FACTORY.clap, name: 'Clap' },
];
