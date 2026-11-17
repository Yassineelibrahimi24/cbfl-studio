import type { MidiNote, Project, StepRow } from '../types';
import { TRACK } from '../types';
import { barTicks, beatTicks, stepTicks } from '../audio/timeline';
import { MINOR_PROGRESSIONS, MAJOR_PROGRESSIONS, degreeOffset, diatonicQuality, nearestPitch, triadPitches, parseKey } from './music';
import { uid } from '../util';

export type MoodId = 'chill' | 'hard' | 'sad' | 'bouncy';

export type DrumVoices = { kick: string; snare: string; hat: string; perc: string };

export type BeatPlan = {
  mood: MoodId;
  seed: number;
  bpm: number;
  key: string;
  degrees: number[];
};

export const MOODS: { id: MoodId; label: string; blurb: string; bpm: number; key: string }[] = [
  { id: 'chill', label: 'Chill', blurb: 'Slow and soft', bpm: 92, key: 'D minor' },
  { id: 'hard', label: 'Hard', blurb: 'Louder and faster', bpm: 140, key: 'A minor' },
  { id: 'sad', label: 'Sad', blurb: 'Quiet and slow', bpm: 76, key: 'F minor' },
  { id: 'bouncy', label: 'Bouncy', blurb: 'Light and bright', bpm: 118, key: 'C major' },
];

const BASS_STEPS: Record<MoodId, number[]> = {
  chill: [4, 12],
  hard: [2, 6],
  sad: [4, 14],
  bouncy: [4, 12],
};

export function moodById(id: MoodId) {
  return MOODS.find((mood) => mood.id === id) ?? MOODS[0];
}

export function planBeat(mood: MoodId, seed: number): BeatPlan {
  const info = moodById(mood);
  const key = parseKey(info.key);
  const table = key.minor ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS;
  const degrees = table[Math.abs(seed) % table.length] ?? table[0];
  return { mood, seed, bpm: info.bpm, key: info.key, degrees };
}

function kickSteps(mood: MoodId, variant: number): number[] {
  if (mood === 'hard') return variant === 2 ? [0, 8, 12] : variant === 1 ? [0, 4, 8, 10, 12] : [0, 4, 8, 12];
  if (mood === 'bouncy') return variant === 1 ? [0, 6, 8, 14] : variant === 2 ? [0, 8, 10] : [0, 6, 8];
  if (mood === 'sad') return variant === 1 ? [0, 8, 10] : [0, 8];
  return variant === 1 ? [0, 6, 8] : variant === 2 ? [0, 8, 10] : [0, 8];
}

function hatHits(mood: MoodId, variant: number): { step: number; velocity: number }[] {
  const hits: { step: number; velocity: number }[] = [];
  for (let step = 0; step < 16; step++) {
    if (mood === 'sad' && step % 8 !== 0) continue;
    if ((mood === 'chill' || mood === 'bouncy') && step % 2 !== 0) continue;
    if (mood === 'bouncy' && variant === 2 && step % 4 !== 2) continue;
    const accent = step % 4 === 0 ? 0.32 : step % 2 === 0 ? 0.2 : 0.12;
    hits.push({ step, velocity: mood === 'hard' ? accent : accent * 0.85 });
  }
  return hits;
}

function row(sampleId: string, hits: { step: number; velocity: number }[]): StepRow {
  const cells = Array.from({ length: 16 }, () => ({ on: false, velocity: 0.8, probability: 1 }));
  for (const hit of hits) {
    if (hit.step >= 0 && hit.step < 16) cells[hit.step] = { on: true, velocity: hit.velocity, probability: 1 };
  }
  return { sampleId, cells };
}

function replaceClip(project: Project, trackId: string, clip: Project['clips'][number]): void {
  project.clips = project.clips.filter((item) => item.trackId !== trackId);
  project.clips.push(clip);
}

function rememberSample(project: Project, id: string, name: string): void {
  if (!project.samples.some((sample) => sample.id === id)) project.samples.push({ id, name });
}

const JARGON: Record<string, string> = {
  Drums: 'Rhythm',
  '808': 'Low notes',
  Keys: 'Chords',
  Melody: 'Tune',
  Audio: 'Extra',
  Vocals: 'My voice',
};

function renameJargon(project: Project): void {
  for (const track of project.tracks) {
    const next = JARGON[track.name];
    if (next) track.name = next;
  }
}

function setVolume(project: Project, id: string, volume: number): void {
  const track = project.tracks.find((item) => item.id === id);
  if (track) track.volume = volume;
}

export function writeBeat(project: Project, plan: BeatPlan, part: 'all' | 'drums' | 'bass' | 'melody', voices: DrumVoices): void {
  const key = parseKey(part === 'all' ? plan.key : project.key);
  if (part === 'all') {
    project.bpm = plan.bpm;
    project.key = plan.key;
    renameJargon(project);
    setVolume(project, TRACK.drums, 0.84);
    setVolume(project, TRACK.bass, 0.76);
    setVolume(project, TRACK.keys, 0.4);
    setVolume(project, TRACK.melody, 0.58);
  }
  if (part === 'all' || part === 'drums') writeDrums(project, plan, voices);
  if (part === 'all') writeChords(project, plan, key);
  if (part === 'all' || part === 'bass') writeBass(project, plan, key);
  if (part === 'all' || part === 'melody') writeMelody(project, plan, key, part === 'melody');
}

function writeDrums(project: Project, plan: BeatPlan, voices: DrumVoices): void {
  const variant = Math.abs(plan.seed) % 3;
  const kicks = kickSteps(plan.mood, variant).map((step) => ({ step, velocity: plan.mood === 'sad' ? 0.82 : 0.98 }));
  const snare = [
    { step: 4, velocity: plan.mood === 'sad' ? 0.62 : 0.88 },
    { step: 12, velocity: plan.mood === 'sad' ? 0.7 : 0.92 },
  ];
  const perc = plan.mood === 'sad' ? [] : [{ step: 12, velocity: plan.mood === 'hard' ? 0.55 : 0.36 }];
  const swing = plan.mood === 'bouncy' ? 0.2 : plan.mood === 'chill' ? 0.1 : 0.04;
  rememberSample(project, voices.kick, 'Beat kick');
  rememberSample(project, voices.snare, 'Beat snare');
  rememberSample(project, voices.hat, 'Beat hat');
  rememberSample(project, voices.perc, 'Beat perc');
  replaceClip(project, TRACK.drums, {
    id: uid('clip'),
    trackId: TRACK.drums,
    startTick: 0,
    kind: 'step',
    steps: 16,
    swing,
    rows: [row(voices.kick, kicks), row(voices.snare, snare), row(voices.hat, hatHits(plan.mood, variant)), row(voices.perc, perc)],
  });
}

function writeChords(project: Project, plan: BeatPlan, key: ReturnType<typeof parseKey>): void {
  const bar = barTicks(project);
  const notes: MidiNote[] = [];
  plan.degrees.forEach((degree, index) => {
    const quality = diatonicQuality(degree, key.minor);
    const pc = (key.root + degreeOffset(degree, key.minor)) % 12;
    for (const pitch of triadPitches(pc, quality, 62)) {
      notes.push({ tick: index * bar, duration: bar, pitch, velocity: 0.34 });
    }
  });
  replaceClip(project, TRACK.keys, {
    id: uid('clip'),
    trackId: TRACK.keys,
    startTick: 0,
    kind: 'midi',
    notes,
  });
}

function writeBass(project: Project, plan: BeatPlan, key: ReturnType<typeof parseKey>): void {
  const bar = barTicks(project);
  const beat = beatTicks(project);
  const step = stepTicks(project);
  const steps = BASS_STEPS[plan.mood];
  const notes: MidiNote[] = [];
  plan.degrees.forEach((degree, index) => {
    const pc = (key.root + degreeOffset(degree, key.minor)) % 12;
    const root = nearestPitch(pc, 36);
    const fifth = Math.min(48, root + 7);
    steps.forEach((start, hit) => {
      notes.push({
        tick: index * bar + start * step,
        duration: Math.round(beat * 0.9),
        pitch: hit === 0 ? root : fifth,
        velocity: hit === 0 ? 0.9 : 0.72,
      });
    });
  });
  replaceClip(project, TRACK.bass, {
    id: uid('clip'),
    trackId: TRACK.bass,
    startTick: 0,
    kind: 'midi',
    notes,
  });
}

function writeMelody(project: Project, plan: BeatPlan, key: ReturnType<typeof parseKey>, simpler: boolean): void {
  const bar = barTicks(project);
  const beat = beatTicks(project);
  const notes: MidiNote[] = [];
  const tonic = nearestPitch(key.root, 74);
  plan.degrees.forEach((degree, index) => {
    const quality = diatonicQuality(degree, key.minor);
    const pc = (key.root + degreeOffset(degree, key.minor)) % 12;
    const chord = triadPitches(pc, quality, 74);
    const last = index === plan.degrees.length - 1;
    const first = last ? tonic : (chord[0] ?? tonic);
    notes.push({ tick: index * bar, duration: simpler ? beat * 3 : beat * 2, pitch: first, velocity: 0.62 });
    if (!simpler && !last) {
      const second = chord[1] ?? first;
      notes.push({ tick: index * bar + beat * 2, duration: beat, pitch: second, velocity: 0.5 });
    }
  });
  replaceClip(project, TRACK.melody, {
    id: uid('clip'),
    trackId: TRACK.melody,
    startTick: 0,
    kind: 'midi',
    notes,
  });
}
