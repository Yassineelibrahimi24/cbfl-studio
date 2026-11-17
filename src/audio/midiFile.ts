import type { Project, StepClip } from '../types';
import { FACTORY } from '../types';
import { stepCycleTicks, stepOffsetTicks, timelineLengthTicks } from './timeline';

function vlq(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function strBytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 0x7f);
  return out;
}

type MidiEv = { tick: number; order: number; data: number[] };

function trackChunk(events: MidiEv[]): Uint8Array {
  const sorted = events.slice().sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const ev of sorted) {
    const tick = Math.max(last, Math.floor(ev.tick));
    body.push(...vlq(tick - last));
    body.push(...ev.data);
    last = tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00);
  const data = new Uint8Array(body);
  const out = new Uint8Array(8 + data.length);
  out.set([0x4d, 0x54, 0x72, 0x6b], 0);
  new DataView(out.buffer).setUint32(4, data.length, false);
  out.set(data, 8);
  return out;
}

function gmDrum(sampleId: string | undefined): number {
  if (sampleId === FACTORY.kick) return 36;
  if (sampleId === FACTORY.snare) return 38;
  if (sampleId === FACTORY.hat) return 42;
  if (sampleId === FACTORY.clap) return 39;
  return 60;
}

function stepNotes(project: Project, clip: StepClip): MidiEv[] {
  const events: MidiEv[] = [];
  const end = timelineLengthTicks(project);
  const cycle = stepCycleTicks(clip, project);
  const cycles = Math.ceil((end - clip.startTick) / cycle);
  for (let cyc = 0; cyc < cycles; cyc++) {
    const base = clip.startTick + cyc * cycle;
    if (base >= end) break;
    clip.rows.forEach((row) => {
      row.cells.forEach((cell, index) => {
        if (!cell.on || cell.probability <= 0 || index >= clip.steps) return;
        const tick = Math.round(base + stepOffsetTicks(clip, project, index));
        if (tick < clip.startTick || tick >= end) return;
        const vel = Math.max(1, Math.min(127, Math.round(cell.velocity * cell.probability * 127)));
        const pitch = gmDrum(row.sampleId);
        const dur = Math.max(1, Math.round(project.ticksPerBeat / 8));
        events.push({ tick, order: 1, data: [0x99, pitch, vel] });
        events.push({ tick: tick + dur, order: 0, data: [0x89, pitch, 0] });
      });
    });
  }
  return events;
}

export function encodeMidi(project: Project): Uint8Array {
  const division = Math.max(1, Math.min(32767, Math.round(project.ticksPerBeat)));
  const us = Math.max(1, Math.round(60_000_000 / project.bpm));
  const [num, den] = project.timeSignature;
  const dd = Math.max(0, Math.round(Math.log2(den || 4)));
  const conductor: MidiEv[] = [
    { tick: 0, order: 0, data: [0xff, 0x03, ...vlq(strBytes('CBFL').length), ...strBytes('CBFL')] },
    { tick: 0, order: 1, data: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] },
    { tick: 0, order: 2, data: [0xff, 0x58, 0x04, num & 0xff, dd & 0xff, 24, 8] },
  ];
  const chunks: Uint8Array[] = [trackChunk(conductor)];
  const songEnd = timelineLengthTicks(project);

  for (const track of project.tracks) {
    if (track.kind === 'audio') continue;
    const events: MidiEv[] = [
      { tick: 0, order: 0, data: [0xff, 0x03, ...vlq(strBytes(track.name).length), ...strBytes(track.name)] },
    ];
    const channel = track.kind === 'drum' ? 9 : 0;
    if (track.kind === 'drum') {
      for (const clip of project.clips) {
        if (clip.kind === 'step' && clip.trackId === track.id) events.push(...stepNotes(project, clip));
      }
    } else {
      for (const clip of project.clips) {
        if (clip.kind !== 'midi' || clip.trackId !== track.id) continue;
        for (const note of clip.notes) {
          const on = Math.max(0, Math.round(clip.startTick + note.tick));
          const off = Math.max(on + 1, Math.round(on + note.duration));
          if (on >= songEnd + project.ticksPerBeat) continue;
          const vel = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
          const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
          events.push({ tick: on, order: 1, data: [0x90 | channel, pitch, vel] });
          events.push({ tick: off, order: 0, data: [0x80 | channel, pitch, 0] });
        }
      }
    }
    if (events.length > 1) chunks.push(trackChunk(events));
  }

  const header = new Uint8Array(14);
  header.set([0x4d, 0x54, 0x68, 0x64], 0);
  const view = new DataView(header.buffer);
  view.setUint32(4, 6, false);
  view.setUint16(8, 1, false);
  view.setUint16(10, chunks.length, false);
  view.setUint16(12, division, false);
  const size = chunks.reduce((n, c) => n + c.length, header.length);
  const out = new Uint8Array(size);
  out.set(header, 0);
  let offset = header.length;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function metaSidecar(project: Project): string {
  return JSON.stringify(
    {
      bpm: project.bpm,
      key: project.key,
      timeSignature: project.timeSignature,
    },
    null,
    2,
  );
}
