import type { Clip, MidiNote, Project, StepRow } from '../types';
import { CLIP, FACTORY, TRACK } from '../types';
import { beatTicks } from '../audio/timeline';

function cells(steps: number, hit: (index: number) => { on: boolean; velocity: number; probability?: number }): StepRow['cells'] {
  return Array.from({ length: steps }, (_, index) => {
    const cell = hit(index);
    return { on: cell.on, velocity: cell.velocity, probability: cell.probability ?? 1 };
  });
}

function note(beat: number, beats: number, pitch: number, velocity: number, beatLen: number): MidiNote {
  return {
    tick: Math.round(beat * beatLen),
    duration: Math.round(beats * beatLen),
    pitch,
    velocity,
  };
}

export function createDefaultProject(): Project {
  const project: Project = {
    version: 1,
    bpm: 140,
    key: 'A minor',
    timeSignature: [4, 4],
    ticksPerBeat: 480,
    tracks: [
      {
        id: TRACK.drums,
        kind: 'drum',
        name: 'Drums',
        mute: false,
        solo: false,
        volume: 0.82,
        pan: 0,
        sends: [0.05, 0],
        effects: [
          { type: 'eq', low: 1.5, mid: -1.2, high: 2 },
          { type: 'compressor', threshold: -14, ratio: 2.2 },
        ],
      },
      {
        id: TRACK.bass,
        kind: 'bass',
        name: '808',
        mute: false,
        solo: false,
        volume: 0.9,
        pan: 0,
        sends: [0, 0],
        effects: [
          { type: 'saturation', drive: 0.24 },
          { type: 'eq', low: 2.5, mid: -1.5, high: 0.5 },
          { type: 'compressor', threshold: -18, ratio: 3 },
          { type: 'sidechain', sourceTrackId: TRACK.drums, amount: 0.7 },
        ],
      },
      {
        id: TRACK.keys,
        kind: 'midi',
        name: 'Keys',
        mute: false,
        solo: false,
        volume: 0.52,
        pan: -0.18,
        sends: [0.22, 0],
        effects: [
          { type: 'eq', low: -2, mid: 0.4, high: 1.2 },
          { type: 'reverb', mix: 0.2, impulseId: FACTORY.impulse },
        ],
      },
      {
        id: TRACK.melody,
        kind: 'midi',
        name: 'Melody',
        mute: false,
        solo: false,
        volume: 0.66,
        pan: 0.22,
        sends: [0.08, 0.16],
        effects: [
          { type: 'eq', low: -3, mid: 1, high: 2 },
          { type: 'delay', time: 0.28, feedback: 0.28, mix: 0.16 },
        ],
      },
      {
        id: TRACK.audio,
        kind: 'audio',
        name: 'Audio',
        mute: false,
        solo: false,
        volume: 0.8,
        pan: 0,
        sends: [0.1, 0],
        effects: [
          { type: 'eq', low: 0, mid: 0, high: 0 },
          { type: 'compressor', threshold: -16, ratio: 2 },
        ],
      },
    ],
    clips: [],
    samples: [
      { id: FACTORY.kick, name: 'Kick' },
      { id: FACTORY.snare, name: 'Snare' },
      { id: FACTORY.hat, name: 'Hat' },
      { id: FACTORY.clap, name: 'Clap' },
    ],
  };

  const beat = beatTicks(project);
  const steps = 16;

  const drum: Clip = {
    id: CLIP.drums,
    trackId: TRACK.drums,
    startTick: 0,
    kind: 'step',
    steps,
    swing: 0.16,
    rows: [
      {
        sampleId: FACTORY.kick,
        cells: cells(steps, (i) => ({ on: i % 4 === 0, velocity: 0.98 })),
      },
      {
        sampleId: FACTORY.snare,
        cells: cells(steps, (i) => ({ on: i === 4 || i === 12, velocity: 0.88 })),
      },
      {
        sampleId: FACTORY.hat,
        cells: cells(steps, (i) => ({
          on: true,
          velocity: i % 4 === 0 ? 0.58 : i % 2 === 0 ? 0.36 : 0.22,
          probability: i === 15 ? 0.55 : 1,
        })),
      },
      {
        sampleId: FACTORY.clap,
        cells: cells(steps, (i) => ({ on: i === 4 || i === 12, velocity: 0.5 })),
      },
    ],
  };

  const bass: Clip = {
    id: CLIP.bass,
    trackId: TRACK.bass,
    startTick: 0,
    kind: 'midi',
    notes: [
      note(0, 1.5, 33, 0.95, beat),
      note(4, 1.5, 29, 0.9, beat),
      note(8, 1.5, 36, 0.92, beat),
      note(12, 1.5, 31, 0.9, beat),
    ],
  };

  const chords = [
    [45, 48, 52],
    [41, 45, 48],
    [48, 52, 55],
    [43, 47, 50],
  ];
  const keys: Clip = {
    id: CLIP.keys,
    trackId: TRACK.keys,
    startTick: 0,
    kind: 'midi',
    notes: chords.flatMap((pitches, barIndex) =>
      pitches.map((pitch) => note(barIndex * 4, 4, pitch, 0.42, beat)),
    ),
  };

  const melody: Clip = {
    id: CLIP.melody,
    trackId: TRACK.melody,
    startTick: 0,
    kind: 'midi',
    notes: [
      note(0, 1, 69, 0.78, beat),
      note(1, 1, 72, 0.74, beat),
      note(2, 0.5, 76, 0.8, beat),
      note(2.5, 0.5, 74, 0.7, beat),
      note(3, 1, 72, 0.74, beat),
      note(4, 1, 69, 0.76, beat),
      note(5, 0.5, 67, 0.66, beat),
      note(5.5, 0.5, 69, 0.7, beat),
      note(6, 1, 65, 0.72, beat),
      note(7, 1, 64, 0.7, beat),
      note(8, 1, 64, 0.74, beat),
      note(9, 1, 67, 0.72, beat),
      note(10, 0.5, 69, 0.78, beat),
      note(10.5, 0.5, 67, 0.66, beat),
      note(11, 1, 64, 0.72, beat),
      note(12, 1, 62, 0.7, beat),
      note(13, 1, 64, 0.74, beat),
      note(14, 2, 60, 0.68, beat),
    ],
  };

  project.clips = [drum, bass, keys, melody];
  return project;
}
