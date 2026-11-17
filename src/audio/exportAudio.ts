import { Audio } from 'audiobox';
import { encodeMp3 } from 'audiobox/mp3';
import type { Project } from '../types';
import { collectEvents, shouldPlay, type WireEvent } from './events';
import { buildMixGraph } from './graph';
import { makeImpulse } from './samples';
import { secondsPerTick, timelineLengthTicks } from './timeline';
import { triggerWire } from './trigger';
import { audioBufferToWav } from './wav';

export async function renderProject(
  project: Project,
  buffers: Map<string, AudioBuffer>,
  soloTrackId: string | null,
): Promise<AudioBuffer> {
  const ticks = timelineLengthTicks(project);
  const musical = ticks * secondsPerTick(project, project.bpm);
  const seconds = musical + 2;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(sampleRate * seconds)), sampleRate);
  const impulse = makeImpulse(ctx);
  const mix = structuredClone(project);
  if (soloTrackId) {
    for (const track of mix.tracks) {
      track.solo = track.id === soloTrackId;
      track.mute = false;
    }
  }
  const graph = buildMixGraph(ctx, mix, impulse);
  graph.output.connect(ctx.destination);
  const spt = secondsPerTick(mix, mix.bpm);
  const events = collectEvents(mix, 0, ticks, false);
  const bass = new Map();
  const random = Math.random;
  for (const ev of events) {
    if (!shouldPlay(ev.probability, random)) continue;
    const wire: WireEvent = {
      kind: ev.kind,
      audioTime: ev.tick * spt,
      tick: ev.tick,
      trackId: ev.trackId,
      sampleId: ev.sampleId,
      pitch: ev.pitch,
      durationTicks: ev.durationTicks,
      velocity: ev.velocity,
      mono: ev.mono,
    };
    triggerWire(ctx, graph, buffers, mix, wire, bass, seconds);
  }
  return ctx.startRendering();
}

export function bufferToWav(buffer: AudioBuffer): ArrayBuffer {
  return audioBufferToWav(buffer);
}

/** MPEG-1 Layer III of the offline mix. 44.1 kHz stereo, 192 kbit/s CBR. */
export function bufferToMp3(buffer: AudioBuffer): Uint8Array {
  return encodeMp3(Audio.fromAudioBuffer(buffer), { bitrate: 192 });
}
