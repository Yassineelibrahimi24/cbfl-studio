import type { Project } from '../types';
import { midiToHz } from '../theory/music';
import { clamp } from '../util';
import type { WireEvent } from './events';
import { trackAudible, type MixGraph } from './graph';
import { secondsPerTick } from './timeline';

export type LiveVoice = { startTime: number; stop: (when: number) => void };

export type BassVoice = { osc: OscillatorNode; gain: GainNode; freq: number; until: number; level: number };

function stopNode(node: AudioScheduledSourceNode, when: number): void {
  try {
    node.stop(when);
  } catch {
    /* already stopped */
  }
}

export function triggerWire(
  ctx: BaseAudioContext,
  graph: MixGraph,
  buffers: Map<string, AudioBuffer>,
  project: Project,
  ev: WireEvent,
  bass: Map<string, BassVoice>,
  endLimit?: number,
): LiveVoice | null {
  const time = ev.audioTime;
  if (endLimit !== undefined && time >= endLimit - 0.01) return null;
  const spt = secondsPerTick(project, project.bpm);
  const limit = endLimit ?? time + 30;

  if (ev.kind === 'metro' || ev.kind === 'sample') {
    const buffer = buffers.get(ev.sampleId ?? '');
    if (!buffer) return null;
    const chain = ev.kind === 'metro' ? null : graph.tracks.get(ev.trackId);
    if (ev.kind === 'sample' && !chain) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(clamp(ev.velocity, 0, 1), time);
    src.connect(gain);
    gain.connect(ev.kind === 'metro' ? graph.click : chain!.input);
    const dur = Math.min(buffer.duration, Math.max(0.02, limit - time));
    src.start(time);
    stopNode(src, time + dur);
    if (ev.kind === 'sample' && (ev.sampleId ?? '').includes('kick')) duck(graph, project, ev.trackId, time);
    return {
      startTime: time,
      stop: (when) => {
        gain.gain.cancelScheduledValues(when);
        gain.gain.setValueAtTime(0, when);
        stopNode(src, when);
      },
    };
  }

  if (ev.kind === 'audio') {
    const chain = graph.tracks.get(ev.trackId);
    const buffer = buffers.get(ev.sampleId ?? '');
    if (!chain || !buffer) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(chain.input);
    const want = (ev.durationTicks ?? 0) * spt;
    const dur = Math.min(buffer.duration, want > 0 ? want : buffer.duration, Math.max(0.02, limit - time));
    src.start(time, 0, dur);
    return { startTime: time, stop: (when) => stopNode(src, when) };
  }

  if (ev.kind === 'midi' && ev.pitch !== undefined) {
    const chain = graph.tracks.get(ev.trackId);
    if (!chain) return null;
    const freq = Math.max(20, midiToHz(ev.pitch));
    const dur = Math.max(0.05, (ev.durationTicks ?? project.ticksPerBeat) * spt);
    const vel = clamp(ev.velocity, 0.02, 1);
    if (ev.mono) return trigger808(ctx, chain.input, bass, ev.trackId, time, freq, dur, vel, limit);
    return triggerPoly(ctx, chain.input, time, freq, dur, vel * 0.28, 'triangle', limit);
  }
  return null;
}

function triggerPoly(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  freq: number,
  dur: number,
  vel: number,
  type: OscillatorType,
  limit: number,
): LiveVoice {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  const peak = Math.max(0.0002, vel);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.012);
  const end = Math.min(limit - 0.02, time + dur + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(time + 0.03, end));
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  stopNode(osc, end + 0.02);
  return {
    startTime: time,
    stop: (when) => {
      gain.gain.cancelScheduledValues(when);
      gain.gain.setValueAtTime(0, when);
      stopNode(osc, when);
    },
  };
}

function trigger808(
  ctx: BaseAudioContext,
  dest: AudioNode,
  bass: Map<string, BassVoice>,
  trackId: string,
  time: number,
  freq: number,
  dur: number,
  vel: number,
  limit: number,
): LiveVoice {
  const prev = bass.get(trackId);
  let startFreq = freq;
  if (prev && prev.until > time - 0.03) {
    startFreq = Math.max(20, prev.freq);
    prev.gain.gain.cancelScheduledValues(time);
    prev.gain.gain.setValueAtTime(Math.max(0.0002, prev.level), time);
    prev.gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    stopNode(prev.osc, time + 0.04);
  }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, time);
  if (Math.abs(startFreq - freq) > 0.5) {
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.045);
  }
  const dropAt = Math.min(limit - 0.05, time + Math.max(0.28, dur));
  osc.frequency.exponentialRampToValueAtTime(Math.max(22, freq * 0.62), Math.max(time + 0.08, dropAt));
  const peak = Math.max(0.0002, vel * 0.9);
  const release = Math.min(limit - 0.02, time + Math.max(0.28, dur + 0.12));
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(time + 0.05, release));
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  stopNode(osc, release + 0.03);
  bass.set(trackId, { osc, gain, freq, until: release, level: peak });
  return {
    startTime: time,
    stop: (when) => {
      gain.gain.cancelScheduledValues(when);
      gain.gain.setValueAtTime(0, when);
      stopNode(osc, when);
      if (bass.get(trackId)?.osc === osc) bass.delete(trackId);
    },
  };
}

function duck(graph: MixGraph, project: Project, sourceId: string, time: number): void {
  const source = project.tracks.find((t) => t.id === sourceId);
  if (!source || !trackAudible(source, project.tracks)) return;
  for (const track of project.tracks) {
    for (const fx of track.effects) {
      if (fx.type !== 'sidechain' || fx.sourceTrackId !== sourceId) continue;
      const gain = graph.tracks.get(track.id)?.sidechain.gain;
      if (!gain) continue;
      const depth = 1 - clamp(fx.amount, 0, 1) * 0.88;
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(1, time);
      gain.linearRampToValueAtTime(depth, time + 0.008);
      gain.linearRampToValueAtTime(1, time + 0.18);
    }
  }
}
