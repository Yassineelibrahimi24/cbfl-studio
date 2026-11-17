import type { Project } from '../types';
import { barTicks, beatTicks, stepCycleTicks, stepOffsetTicks, stepRegions, timelineLengthTicks } from '../audio/timeline';
import { inScale, noteName, parseKey } from './music';

export type CritiqueItem = { id: string; severity: 'warn' | 'info'; message: string };

function formatBars(bars: number[]): string {
  const unique = [...new Set(bars)].sort((a, b) => a - b);
  if (unique.length === 0) return '';
  if (unique.length <= 6) return unique.map((b) => `bar ${b}`).join(', ');
  return `bars ${unique[0]}–${unique[unique.length - 1]} (${unique.length})`;
}

export function critiqueProject(project: Project): CritiqueItem[] {
  const items: CritiqueItem[] = [];
  const key = parseKey(project.key);
  const bar = barTicks(project);
  const beat = beatTicks(project);
  const tol = beat / 4;
  const songEnd = timelineLengthTicks(project);
  const bars = Math.max(1, Math.round(songEnd / bar));

  const outside = new Map<string, string[]>();
  for (const clip of project.clips) {
    if (clip.kind !== 'midi') continue;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (!track || (track.kind !== 'midi' && track.kind !== 'bass')) continue;
    for (const note of clip.notes) {
      if (!inScale(note.pitch, key)) {
        const list = outside.get(track.name) ?? [];
        const name = noteName(note.pitch);
        if (!list.includes(name)) list.push(name);
        outside.set(track.name, list);
      }
    }
  }
  for (const [name, notes] of outside) {
    const shown = notes.slice(0, 6).join(', ');
    const more = notes.length > 6 ? ` (+${notes.length - 6})` : '';
    items.push({
      id: `key-${name}`,
      severity: 'warn',
      message: `${name}: ${shown}${more} sit outside ${project.key}.`,
    });
  }

  const kickTicks: number[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'drum') continue;
    for (const region of stepRegions(project, track.id)) {
      const cycle = stepCycleTicks(region.clip, project);
      const cycles = Math.ceil((Math.min(region.end, songEnd) - region.start) / cycle) + 1;
      for (let cyc = 0; cyc < cycles; cyc++) {
        const base = region.clip.startTick + cyc * cycle;
        region.clip.rows.forEach((row) => {
          if (!row.sampleId.includes('kick')) return;
          row.cells.forEach((cell, index) => {
            if (!cell.on || index >= region.clip.steps) return;
            const tick = base + stepOffsetTicks(region.clip, project, index);
            if (tick >= region.start && tick < region.end && tick < songEnd) kickTicks.push(tick);
          });
        });
      }
    }
  }

  const clashBars: number[] = [];
  for (const clip of project.clips) {
    if (clip.kind !== 'midi') continue;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.kind !== 'bass') continue;
    for (const note of clip.notes) {
      if (note.pitch > 48) continue;
      const start = clip.startTick + note.tick;
      for (const kick of kickTicks) {
        if (Math.abs(kick - start) <= tol) {
          clashBars.push(Math.floor(start / bar) + 1);
          break;
        }
      }
    }
  }
  if (clashBars.length) {
    items.push({
      id: 'low-end',
      severity: 'warn',
      message: `Low end: kick and 808 share an onset in ${formatBars(clashBars)}.`,
    });
  }

  const occupied = new Array<boolean>(bars).fill(false);
  const mark = (tick: number, dur: number) => {
    const a = Math.max(0, Math.floor(tick / bar));
    const b = Math.max(a, Math.floor((tick + Math.max(1, dur) - 1) / bar));
    for (let i = a; i <= b && i < bars; i++) occupied[i] = true;
  };
  for (const clip of project.clips) {
    if (clip.kind === 'midi') {
      if (clip.notes.length === 0) continue;
      for (const note of clip.notes) mark(clip.startTick + note.tick, note.duration);
    } else if (clip.kind === 'audio') {
      mark(clip.startTick, clip.durationTicks);
    } else {
      const region = stepRegions(project, clip.trackId).find((r) => r.clip.id === clip.id);
      if (!region) continue;
      const any = clip.rows.some((row) => row.cells.some((cell) => cell.on));
      if (!any) continue;
      mark(region.start, Math.max(1, region.end - region.start));
    }
  }
  const empty = occupied.map((on, i) => (on ? -1 : i + 1)).filter((n) => n > 0);
  if (empty.length) {
    items.push({
      id: 'empty',
      severity: 'info',
      message: `Empty ${formatBars(empty)}.`,
    });
  }

  if (items.length === 0) {
    items.push({ id: 'ok', severity: 'info', message: 'No low-end clashes, empty bars, or out-of-key notes.' });
  }
  return items;
}
