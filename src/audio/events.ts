import type { Project } from '../types';
import { barTicks, beatTicks, stepCycleTicks, stepOffsetTicks, stepRegions } from './timeline';

export type SchedKind = 'sample' | 'midi' | 'audio' | 'metro';

export type SchedEvent = {
  kind: SchedKind;
  tick: number;
  order: number;
  trackId: string;
  sampleId?: string;
  pitch?: number;
  durationTicks?: number;
  velocity: number;
  probability: number;
  mono?: boolean;
};

export type WireEvent = {
  kind: SchedKind;
  audioTime: number;
  tick: number;
  trackId: string;
  sampleId?: string;
  pitch?: number;
  durationTicks?: number;
  velocity: number;
  mono?: boolean;
};

export function shouldPlay(probability: number, random: () => number): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  return random() < probability;
}

export function collectEvents(project: Project, rangeStart: number, rangeEnd: number, metronome: boolean): SchedEvent[] {
  if (rangeEnd <= rangeStart) return [];
  const out: SchedEvent[] = [];
  const tracks = new Map(project.tracks.map((t) => [t.id, t]));

  for (const clip of project.clips) {
    const track = tracks.get(clip.trackId);
    if (!track) continue;
    if (clip.kind === 'step' && track.kind === 'drum') {
      const region = stepRegions(project, clip.trackId).find((r) => r.clip.id === clip.id);
      if (!region) continue;
      const from = Math.max(rangeStart, region.start);
      const to = Math.min(rangeEnd, region.end);
      if (to <= from) continue;
      const cycle = stepCycleTicks(clip, project);
      const firstCycle = Math.floor((from - clip.startTick) / cycle);
      const lastCycle = Math.floor((to - 1e-6 - clip.startTick) / cycle);
      for (let cyc = Math.max(0, firstCycle); cyc <= lastCycle; cyc++) {
        const base = clip.startTick + cyc * cycle;
        clip.rows.forEach((row) => {
          row.cells.forEach((cell, index) => {
            if (!cell.on || index >= clip.steps) return;
            const tick = base + stepOffsetTicks(clip, project, index);
            if (tick < from || tick >= to) return;
            out.push({
              kind: 'sample',
              tick,
              order: 0,
              trackId: clip.trackId,
              sampleId: row.sampleId,
              velocity: cell.velocity,
              probability: cell.probability,
            });
          });
        });
      }
    } else if (clip.kind === 'midi' && (track.kind === 'bass' || track.kind === 'midi')) {
      for (const note of clip.notes) {
        const tick = clip.startTick + note.tick;
        if (tick < rangeStart || tick >= rangeEnd) continue;
        out.push({
          kind: 'midi',
          tick,
          order: 2,
          trackId: clip.trackId,
          pitch: note.pitch,
          durationTicks: Math.max(1, note.duration),
          velocity: note.velocity,
          probability: 1,
          mono: track.kind === 'bass',
        });
      }
    } else if (clip.kind === 'audio' && track.kind === 'audio') {
      if (clip.startTick >= rangeStart && clip.startTick < rangeEnd) {
        out.push({
          kind: 'audio',
          tick: clip.startTick,
          order: 3,
          trackId: clip.trackId,
          sampleId: clip.sampleId,
          durationTicks: clip.durationTicks,
          velocity: 1,
          probability: 1,
        });
      }
    }
  }

  if (metronome) {
    const beat = beatTicks(project);
    let tick = Math.ceil((rangeStart - 1e-6) / beat) * beat;
    if (tick < rangeStart) tick += beat;
    for (; tick < rangeEnd; tick += beat) {
      out.push({
        kind: 'metro',
        tick,
        order: 1,
        trackId: 'metro',
        velocity: 0.85,
        probability: 1,
        sampleId: 'smp_kick',
      });
    }
  }

  out.sort((a, b) => a.tick - b.tick || a.order - b.order);
  return out;
}

export function barCount(project: Project): number {
  return Math.max(1, Math.round(timelineSafe(project) / barTicks(project)));
}

function timelineSafe(project: Project): number {
  const bar = barTicks(project);
  let end = bar * 4;
  for (const clip of project.clips) {
    if (clip.kind === 'midi') {
      const len = clip.notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0);
      end = Math.max(end, clip.startTick + Math.max(len, bar));
    } else if (clip.kind === 'audio') {
      end = Math.max(end, clip.startTick + Math.max(clip.durationTicks, 1));
    } else {
      end = Math.max(end, clip.startTick + bar * 4);
    }
  }
  return end;
}
