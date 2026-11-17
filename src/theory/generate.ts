import type { Clip, MidiClip, MidiNote, Project, StepClip, StepRow } from '../types';
import { FACTORY } from '../types';
import { barTicks, beatTicks, stepTicks } from '../audio/timeline';
import {
  MAJOR_PROGRESSIONS,
  MINOR_PROGRESSIONS,
  chordSymbol,
  degreeOffset,
  diatonicQuality,
  inScale,
  nearestPitch,
  noteName,
  parseKey,
  romanLabel,
  scaleOffsets,
  snapToScale,
  triadPitches,
  type KeyInfo,
} from './music';
import { clamp, mulberry32, uid } from '../util';

export type ToolKind = 'chords' | 'melody' | 'bass' | 'drums' | 'variation';

export type SuggestionDraft = {
  seed: number;
  kind: ToolKind;
  title: string;
  detail: string;
  clip: Clip;
  targetTrackId: string;
  replaceClipId: string | null;
};

function trackByKind(project: Project, kind: Project['tracks'][number]['kind'], nth = 0): string | null {
  const found = project.tracks.filter((t) => t.kind === kind);
  return found[nth]?.id ?? found[0]?.id ?? null;
}

function firstClip(project: Project, trackId: string, kind: Clip['kind']): Clip | undefined {
  return project.clips.find((c) => c.trackId === trackId && c.kind === kind);
}

function progression(key: KeyInfo, seed: number): number[] {
  const table = key.minor ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS;
  return table[seed % table.length] ?? table[0];
}

function chordLabels(key: KeyInfo, degrees: number[]): string {
  return degrees
    .map((degree) => {
      const quality = diatonicQuality(degree, key.minor);
      const pc = (key.root + degreeOffset(degree, key.minor)) % 12;
      return `${romanLabel(degree, quality)} ${chordSymbol(pc, quality)}`;
    })
    .join(' · ');
}

export function suggestChords(project: Project, seed: number): SuggestionDraft | null {
  const target = trackByKind(project, 'midi', 0);
  if (!target) return null;
  const key = parseKey(project.key);
  const rng = mulberry32(seed);
  const degrees = progression(key, Math.floor(rng() * 3));
  const bar = barTicks(project);
  const existing = firstClip(project, target, 'midi');
  const notes: MidiNote[] = [];
  degrees.forEach((degree, i) => {
    const quality = diatonicQuality(degree, key.minor);
    const pc = (key.root + degreeOffset(degree, key.minor)) % 12;
    const center = 48 + (rng() > 0.7 ? 12 : 0);
    for (const pitch of triadPitches(pc, quality, center)) {
      notes.push({ tick: i * bar, duration: bar, pitch, velocity: 0.46 + rng() * 0.08 });
    }
  });
  const clip: MidiClip = {
    id: existing?.id ?? uid('clip'),
    trackId: target,
    startTick: existing?.startTick ?? 0,
    kind: 'midi',
    notes,
  };
  return {
    seed,
    kind: 'chords',
    title: 'Chord progression',
    detail: `${chordLabels(key, degrees)}. Four bars in ${project.key}. Nothing is written until you accept.`,
    clip,
    targetTrackId: target,
    replaceClipId: existing?.id ?? null,
  };
}

export function suggestMelody(project: Project, seed: number): SuggestionDraft | null {
  const target = trackByKind(project, 'midi', 1) ?? trackByKind(project, 'midi', 0);
  if (!target) return null;
  const key = parseKey(project.key);
  const rng = mulberry32(seed + 17);
  const bar = barTicks(project);
  const beat = beatTicks(project);
  const eighth = beat / 2;
  const bars = 4;
  const steps = Math.round((bars * bar) / eighth);
  const tonic = nearestPitch(key.root, 69);
  let degree = 0;
  const notes: MidiNote[] = [];
  const scale = scaleOffsets(key.minor);
  for (let i = 0; i < steps; i++) {
    const downbeat = i % 2 === 0;
    if (!downbeat && rng() < 0.22) continue;
    const choices = [-2, -1, -1, 0, 1, 1, 2, 3];
    degree = clamp(degree + (choices[Math.floor(rng() * choices.length)] ?? 1), -3, 7);
    if (i >= steps - 2) degree = 0;
    const idx = ((degree % 7) + 7) % 7;
    const oct = Math.floor(degree / 7);
    const pc = (key.root + (scale[idx] ?? 0)) % 12;
    const pitch = nearestPitch(pc, tonic) + oct * 12;
    const durSteps = rng() < 0.25 && i < steps - 1 ? 2 : 1;
    notes.push({
      tick: Math.round(i * eighth),
      duration: Math.round(eighth * durSteps),
      pitch: snapToScale(clamp(pitch, tonic - 12, tonic + 14), key),
      velocity: 0.62 + rng() * 0.28,
    });
    if (durSteps === 2) i += 1;
  }
  const existing = firstClip(project, target, 'midi');
  const clip: MidiClip = {
    id: existing?.id ?? uid('clip'),
    trackId: target,
    startTick: existing?.startTick ?? 0,
    kind: 'midi',
    notes,
  };
  const preview = notes.slice(0, 8).map((n) => noteName(n.pitch)).join(' ');
  return {
    seed,
    kind: 'melody',
    title: 'Melody in key',
    detail: `${notes.length} notes in ${project.key}, starting ${preview}. Accept writes this clip.`,
    clip,
    targetTrackId: target,
    replaceClipId: existing?.id ?? null,
  };
}

export function suggestBass(project: Project, seed: number): SuggestionDraft | null {
  const target = trackByKind(project, 'bass', 0);
  if (!target) return null;
  const key = parseKey(project.key);
  const rng = mulberry32(seed + 41);
  const degrees = progression(key, Math.floor(rng() * 3));
  const bar = barTicks(project);
  const beat = beatTicks(project);
  const notes: MidiNote[] = [];
  const labels: string[] = [];
  degrees.forEach((degree, i) => {
    const quality = diatonicQuality(degree, key.minor);
    const pc = (key.root + degreeOffset(degree, key.minor)) % 12;
    const root = nearestPitch(pc, 36);
    const fifth = clamp(root + 7, 28, 48);
    labels.push(chordSymbol(pc, quality));
    notes.push({ tick: i * bar, duration: Math.round(beat * 1.5), pitch: root, velocity: 0.92 });
    notes.push({
      tick: i * bar + beat * 2,
      duration: Math.round(beat * 0.9),
      pitch: rng() > 0.5 ? root : fifth,
      velocity: 0.78,
    });
  });
  const existing = firstClip(project, target, 'midi');
  const clip: MidiClip = {
    id: existing?.id ?? uid('clip'),
    trackId: target,
    startTick: existing?.startTick ?? 0,
    kind: 'midi',
    notes,
  };
  return {
    seed,
    kind: 'bass',
    title: 'Bass locked to chords',
    detail: `Roots follow ${labels.join(' · ')}. Low 808 pitches stay on the chord roots. Accept to replace the bass clip.`,
    clip,
    targetTrackId: target,
    replaceClipId: existing?.id ?? null,
  };
}

function drumRow(sampleId: string, steps: number, hits: { index: number; velocity: number; probability?: number }[]): StepRow {
  const cells = Array.from({ length: steps }, () => ({ on: false, velocity: 0.8, probability: 1 }));
  for (const hit of hits) {
    if (hit.index >= 0 && hit.index < steps) {
      cells[hit.index] = { on: true, velocity: hit.velocity, probability: hit.probability ?? 1 };
    }
  }
  return { sampleId, cells };
}

export function suggestDrums(project: Project, seed: number): SuggestionDraft | null {
  const target = trackByKind(project, 'drum', 0);
  if (!target) return null;
  const rng = mulberry32(seed + 7);
  const variant = Math.floor(rng() * 3);
  const kickSets = [
    [0, 4, 8, 12],
    [0, 3, 8, 11],
    [0, 6, 8, 14],
  ];
  const kicks = kickSets[variant] ?? kickSets[0];
  const hats = Array.from({ length: 16 }, (_, i) => ({
    index: i,
    velocity: i % 4 === 0 ? 0.62 : i % 2 === 0 ? 0.4 : 0.24,
    probability: i === 15 ? 0.7 : 1,
  }));
  const rows: StepRow[] = [
    drumRow(FACTORY.kick, 16, kicks.map((index) => ({ index, velocity: 0.98 }))),
    drumRow(FACTORY.snare, 16, [
      { index: 4, velocity: 0.9 },
      { index: 12, velocity: 0.86 },
      ...(variant === 2 ? [{ index: 10, velocity: 0.35, probability: 0.6 }] : []),
    ]),
    drumRow(FACTORY.hat, 16, hats),
    drumRow(
      FACTORY.clap,
      16,
      variant === 1
        ? [
            { index: 4, velocity: 0.7 },
            { index: 12, velocity: 0.7 },
          ]
        : [{ index: 12, velocity: 0.55 }],
    ),
  ];
  const existing = firstClip(project, target, 'step');
  const swing = variant === 1 ? 0.28 : 0.12;
  const clip: StepClip = {
    id: existing?.kind === 'step' ? existing.id : uid('clip'),
    trackId: target,
    startTick: existing?.startTick ?? 0,
    kind: 'step',
    steps: 16,
    swing,
    rows,
  };
  const names = ['four on the floor', 'syncopated kick', 'offbeat kick'];
  return {
    seed,
    kind: 'drums',
    title: 'Drum pattern',
    detail: `${names[variant] ?? 'pattern'}, snare on 2 and 4, swing ${Math.round(swing * 100)}%. Accept replaces the step clip.`,
    clip,
    targetTrackId: target,
    replaceClipId: existing?.id ?? null,
  };
}

export function suggestVariation(project: Project, clip: Clip, seed: number): SuggestionDraft | null {
  const key = parseKey(project.key);
  const rng = mulberry32(seed + 99);
  if (clip.kind === 'midi') {
    const notes = clip.notes.map((n) => ({ ...n }));
    if (notes.length === 0) return null;
    const index = Math.floor(rng() * notes.length);
    const note = notes[index];
    if (!note) return null;
    const dir = rng() > 0.5 ? 1 : -1;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    let pitch = note.pitch + dir * (rng() > 0.7 ? 2 : 1);
    if (track?.kind === 'bass' || track?.kind === 'midi') pitch = snapToScale(pitch, key);
    if (track?.kind === 'bass') pitch = clamp(pitch, 28, 52);
    note.pitch = pitch;
    note.velocity = clamp(note.velocity + (rng() - 0.5) * 0.2, 0.2, 1);
    if (notes.length > 2 && rng() > 0.6) {
      const other = notes[Math.floor(rng() * notes.length)];
      if (other && other !== note) other.duration = Math.max(stepTicks(project), Math.round(other.duration * (rng() > 0.5 ? 0.5 : 1.5)));
    }
    const changed = notes.some((n, i) => n.pitch !== clip.notes[i]?.pitch || n.velocity !== clip.notes[i]?.velocity);
    if (!changed) note.velocity = clamp(note.velocity + 0.05, 0.2, 1);
    const next: MidiClip = { ...clip, notes };
    return {
      seed,
      kind: 'variation',
      title: 'Variation',
      detail: `Moved ${noteName(note.pitch)} and reshaped velocity. Stays in ${project.key} for pitched tracks. Accept replaces this clip.`,
      clip: next,
      targetTrackId: clip.trackId,
      replaceClipId: clip.id,
    };
  }
  if (clip.kind === 'step') {
    const rows = clip.rows.map((row) => ({
      sampleId: row.sampleId,
      cells: row.cells.map((cell) => ({ ...cell })),
    }));
    const row = rows[Math.floor(rng() * rows.length)];
    if (!row) return null;
    const cell = row.cells[Math.floor(rng() * row.cells.length)];
    if (!cell) return null;
    cell.on = !cell.on;
    cell.velocity = clamp(0.4 + rng() * 0.6, 0.15, 1);
    const next: StepClip = { ...clip, swing: clamp(clip.swing + (rng() - 0.5) * 0.1, 0, 0.6), rows };
    return {
      seed,
      kind: 'variation',
      title: 'Pattern variation',
      detail: 'Flipped a step and nudged swing. Accept replaces this pattern.',
      clip: next,
      targetTrackId: clip.trackId,
      replaceClipId: clip.id,
    };
  }
  return null;
}

export function pitchesInKey(notes: MidiNote[], keyName: string): boolean {
  const key = parseKey(keyName);
  return notes.every((n) => inScale(n.pitch, key));
}
