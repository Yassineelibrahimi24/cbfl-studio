import type { Clip, MidiClip, Project, StepClip } from '../types';

export function beatTicks(project: Project): number {
  const den = project.timeSignature[1] || 4;
  return (project.ticksPerBeat * 4) / den;
}

export function barTicks(project: Project): number {
  return beatTicks(project) * (project.timeSignature[0] || 4);
}

export function stepTicks(project: Project): number {
  return beatTicks(project) / 4;
}

export function secondsPerTick(project: Project, bpm: number): number {
  return 60 / Math.max(1, bpm) / beatTicks(project);
}

export function stepCycleTicks(clip: StepClip, project: Project): number {
  return Math.max(1, clip.steps) * stepTicks(project);
}

export function stepOffsetTicks(clip: StepClip, project: Project, index: number): number {
  const sp = stepTicks(project);
  let tick = index * sp;
  if (index % 2 === 1) tick += clip.swing * sp * 0.5;
  return tick;
}

export function timelineLengthTicks(project: Project): number {
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

export type StepRegion = { clip: StepClip; start: number; end: number };

export function stepRegions(project: Project, trackId: string): StepRegion[] {
  const clips = project.clips
    .filter((c): c is StepClip => c.kind === 'step' && c.trackId === trackId)
    .slice()
    .sort((a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id));
  const songEnd = timelineLengthTicks(project);
  return clips.map((clip, i) => {
    const cycle = stepCycleTicks(clip, project);
    const next = clips[i + 1];
    const end = next
      ? Math.max(next.startTick, clip.startTick + 1)
      : Math.max(songEnd, clip.startTick + cycle);
    return { clip, start: clip.startTick, end };
  });
}

export function clipEndTick(clip: Clip, project: Project): number {
  if (clip.kind === 'audio') return clip.startTick + Math.max(1, clip.durationTicks);
  if (clip.kind === 'midi') {
    const len = clip.notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0);
    const bar = barTicks(project);
    const filled = Math.max(len, bar);
    return clip.startTick + Math.ceil(filled / bar) * bar;
  }
  const region = stepRegions(project, clip.trackId).find((r) => r.clip.id === clip.id);
  return region?.end ?? clip.startTick + barTicks(project);
}

export function wrapTick(tick: number, loopStart: number, loopEnd: number, loopOn: boolean): number {
  if (!loopOn || loopEnd <= loopStart) return Math.max(0, tick);
  const len = loopEnd - loopStart;
  let rel = tick - loopStart;
  rel = ((rel % len) + len) % len;
  return loopStart + rel;
}

export function formatPosition(tick: number, project: Project): string {
  const bar = barTicks(project);
  const beat = beatTicks(project);
  const step = stepTicks(project);
  const safe = Math.max(0, tick);
  const b = Math.floor(safe / bar);
  const rem = safe - b * bar;
  const be = Math.floor(rem / beat);
  const s = Math.floor((rem - be * beat) / Math.max(1, step));
  return `${b + 1}.${be + 1}.${s + 1}`;
}

export function snapTicks(tick: number, grid: number): number {
  if (grid <= 0) return Math.max(0, tick);
  return Math.max(0, Math.round(tick / grid) * grid);
}

export function gridTicks(project: Project, snap: 'bar' | 'beat' | '16th'): number {
  if (snap === 'bar') return barTicks(project);
  if (snap === 'beat') return beatTicks(project);
  return stepTicks(project);
}

export function stepIndexAt(clip: StepClip, project: Project, localTick: number): number {
  let idx = 0;
  for (let i = 0; i < clip.steps; i++) {
    if (stepOffsetTicks(clip, project, i) <= localTick + 0.5) idx = i;
  }
  return idx;
}

export function midiContentTicks(clip: MidiClip): number {
  return clip.notes.reduce((m, n) => Math.max(m, n.tick + n.duration), 0);
}
