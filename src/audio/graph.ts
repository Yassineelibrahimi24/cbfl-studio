import type { EffectSlot, Project, Track } from '../types';
import { clamp } from '../util';

export type TrackChain = {
  id: string;
  input: GainNode;
  volume: GainNode;
  mute: GainNode;
  panner: StereoPannerNode;
  send1: GainNode;
  send2: GainNode;
  sidechain: GainNode;
  updates: ((slot: EffectSlot, bpm: number) => void)[];
  insertTypes: string[];
};

export type MixGraph = {
  tracks: Map<string, TrackChain>;
  output: GainNode;
  click: GainNode;
  delayTime: AudioParam;
  update(project: Project): void;
};

export function trackAudible(track: Track, tracks: Track[]): boolean {
  if (track.mute) return false;
  const anySolo = tracks.some((t) => t.solo);
  return !anySolo || track.solo;
}

function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const amount = clamp(drive, 0, 1);
  if (amount < 0.001) {
    for (let i = 0; i < n; i++) curve[i] = (i / (n - 1)) * 2 - 1;
    return curve;
  }
  const k = 1 + amount * 18;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

function shelf(ctx: BaseAudioContext, type: BiquadFilterType, freq: number): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = freq;
  node.Q.value = 0.7;
  return node;
}

type Built = { output: AudioNode; update: (slot: EffectSlot, bpm: number) => void };

function buildInsert(ctx: BaseAudioContext, input: AudioNode, slot: EffectSlot, impulse: AudioBuffer): Built {
  if (slot.type === 'eq') {
    const low = shelf(ctx, 'lowshelf', 140);
    const mid = shelf(ctx, 'peaking', 1100);
    const high = shelf(ctx, 'highshelf', 6500);
    input.connect(low);
    low.connect(mid);
    mid.connect(high);
    const update = (s: EffectSlot) => {
      if (s.type !== 'eq') return;
      low.gain.value = s.low;
      mid.gain.value = s.mid;
      high.gain.value = s.high;
    };
    update(slot);
    return { output: high, update };
  }
  if (slot.type === 'compressor') {
    const c = ctx.createDynamicsCompressor();
    c.knee.value = 8;
    c.attack.value = 0.008;
    c.release.value = 0.18;
    input.connect(c);
    const update = (s: EffectSlot) => {
      if (s.type !== 'compressor') return;
      c.threshold.value = clamp(s.threshold, -60, 0);
      c.ratio.value = clamp(s.ratio, 1, 20);
    };
    update(slot);
    return { output: c, update };
  }
  if (slot.type === 'saturation') {
    const sh = ctx.createWaveShaper();
    sh.oversample = '2x';
    input.connect(sh);
    const update = (s: EffectSlot) => {
      if (s.type !== 'saturation') return;
      sh.curve = saturationCurve(s.drive);
    };
    update(slot);
    return { output: sh, update };
  }
  if (slot.type === 'delay') {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const delay = ctx.createDelay(1.5);
    const fb = ctx.createGain();
    const sum = ctx.createGain();
    input.connect(dry);
    input.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    dry.connect(sum);
    wet.connect(sum);
    const update = (s: EffectSlot) => {
      if (s.type !== 'delay') return;
      delay.delayTime.value = clamp(s.time, 0.01, 1.4);
      fb.gain.value = clamp(s.feedback, 0, 0.85);
      const mix = clamp(s.mix, 0, 1);
      wet.gain.value = mix;
      dry.gain.value = 1 - mix * 0.85;
    };
    update(slot);
    return { output: sum, update };
  }
  if (slot.type === 'reverb') {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    const sum = ctx.createGain();
    input.connect(dry);
    input.connect(conv);
    conv.connect(wet);
    dry.connect(sum);
    wet.connect(sum);
    const update = (s: EffectSlot) => {
      if (s.type !== 'reverb') return;
      const mix = clamp(s.mix, 0, 1);
      wet.gain.value = mix;
      dry.gain.value = 1 - mix * 0.75;
    };
    update(slot);
    return { output: sum, update };
  }
  const pass = ctx.createGain();
  input.connect(pass);
  return { output: pass, update: () => undefined };
}

function buildTrack(ctx: BaseAudioContext, track: Track, impulse: AudioBuffer, reverb: GainNode, delay: GainNode, sum: GainNode): TrackChain {
  const input = ctx.createGain();
  const sidechain = ctx.createGain();
  const volume = ctx.createGain();
  const mute = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const send1 = ctx.createGain();
  const send2 = ctx.createGain();
  let node: AudioNode = input;
  const updates: ((slot: EffectSlot, bpm: number) => void)[] = [];
  const insertTypes: string[] = [];
  for (const slot of track.effects) {
    if (slot.type === 'sidechain') continue;
    const built = buildInsert(ctx, node, slot, impulse);
    node = built.output;
    updates.push(built.update);
    insertTypes.push(slot.type);
  }
  node.connect(sidechain);
  sidechain.connect(volume);
  volume.connect(mute);
  mute.connect(panner);
  panner.connect(sum);
  panner.connect(send1);
  panner.connect(send2);
  send1.connect(reverb);
  send2.connect(delay);
  volume.gain.value = track.volume;
  panner.pan.value = clamp(track.pan, -1, 1);
  send1.gain.value = track.sends[0];
  send2.gain.value = track.sends[1];
  return { id: track.id, input, volume, mute, panner, send1, send2, sidechain, updates, insertTypes };
}

export function insertSignature(track: Track): string {
  return track.effects.filter((e) => e.type !== 'sidechain').map((e) => e.type).join(',');
}

export function buildMixGraph(ctx: BaseAudioContext, project: Project, impulse: AudioBuffer): MixGraph {
  const output = ctx.createGain();
  output.gain.value = 0.9;
  const sum = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  limiter.knee.value = 2;
  sum.connect(limiter);
  limiter.connect(output);

  const reverbIn = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = impulse;
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = 0.85;
  reverbIn.connect(conv);
  conv.connect(reverbOut);
  reverbOut.connect(sum);

  const delayIn = ctx.createGain();
  const delay = ctx.createDelay(1.5);
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.7;
  delayIn.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(delayOut);
  delayOut.connect(sum);
  const eighth = 60 / Math.max(40, project.bpm) / 2;
  delay.delayTime.value = clamp(eighth * 1.5, 0.05, 1.2);

  const click = ctx.createGain();
  click.gain.value = 0.55;
  click.connect(sum);

  const tracks = new Map<string, TrackChain>();
  for (const track of project.tracks) {
    tracks.set(track.id, buildTrack(ctx, track, impulse, reverbIn, delayIn, sum));
  }

  const graph: MixGraph = {
    tracks,
    output,
    click,
    delayTime: delay.delayTime,
    update(next: Project) {
      const eighthNote = 60 / Math.max(40, next.bpm) / 2;
      delay.delayTime.value = clamp(eighthNote * 1.5, 0.05, 1.2);
      for (const track of next.tracks) {
        const chain = tracks.get(track.id);
        if (!chain) continue;
        chain.volume.gain.value = clamp(track.volume, 0, 1.5);
        chain.panner.pan.value = clamp(track.pan, -1, 1);
        chain.send1.gain.value = clamp(track.sends[0], 0, 1);
        chain.send2.gain.value = clamp(track.sends[1], 0, 1);
        chain.mute.gain.value = trackAudible(track, next.tracks) ? 1 : 0;
        const inserts = track.effects.filter((e) => e.type !== 'sidechain');
        inserts.forEach((slot, i) => chain.updates[i]?.(slot, next.bpm));
      }
    },
  };
  graph.update(project);
  return graph;
}
