import type { Project, Track } from '../types';
import { FACTORY, TRACK } from '../types';
import { planBeat, writeBeat } from '../theory/compose';

export function vocalsTrack(): Track {
  return {
    id: TRACK.vocals,
    kind: 'audio',
    name: 'My voice',
    mute: false,
    solo: false,
    volume: 0.85,
    pan: 0,
    sends: [0.12, 0.08],
    effects: [
      { type: 'eq', low: -2, mid: 1, high: 1.5 },
      { type: 'compressor', threshold: -16, ratio: 2.4 },
    ],
  };
}

const OLD_NAMES: Record<string, string> = {
  Drums: 'Rhythm',
  '808': 'Low notes',
  Keys: 'Chords',
  Melody: 'Tune',
  Audio: 'Extra',
  Vocals: 'My voice',
};

export function withFriendlyNames(project: Project): Project {
  if (!project.tracks.some((track) => OLD_NAMES[track.name])) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) => (OLD_NAMES[track.name] ? { ...track, name: OLD_NAMES[track.name] } : track)),
  };
}

export function ensureVocals(project: Project): Project {
  if (project.tracks.some((track) => track.id === TRACK.vocals)) return project;
  const next = structuredClone(project);
  const audioAt = next.tracks.findIndex((track) => track.id === TRACK.audio);
  next.tracks.splice(audioAt >= 0 ? audioAt + 1 : next.tracks.length, 0, vocalsTrack());
  return next;
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
        name: 'Rhythm',
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
        name: 'Low notes',
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
        name: 'Chords',
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
        name: 'Tune',
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
        name: 'Extra',
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
      vocalsTrack(),
    ],
    clips: [],
    samples: [
      { id: FACTORY.kick, name: 'Kick' },
      { id: FACTORY.snare, name: 'Snare' },
      { id: FACTORY.hat, name: 'Hat' },
      { id: FACTORY.clap, name: 'Clap' },
    ],
  };

  writeBeat(project, planBeat('chill', 0), 'all', {
    kick: FACTORY.kick,
    snare: FACTORY.snare,
    hat: FACTORY.hat,
    perc: FACTORY.clap,
  });
  return project;
}
