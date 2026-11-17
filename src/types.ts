export type TrackKind = 'drum' | 'bass' | 'midi' | 'audio';

export type EffectSlot =
  | { type: 'eq'; low: number; mid: number; high: number }
  | { type: 'compressor'; threshold: number; ratio: number }
  | { type: 'reverb'; mix: number; impulseId: string }
  | { type: 'delay'; time: number; feedback: number; mix: number }
  | { type: 'saturation'; drive: number }
  | { type: 'sidechain'; sourceTrackId: string; amount: number };

export type AutomationPoint = { tick: number; value: number };

export type Track = {
  id: string;
  kind: TrackKind;
  name: string;
  mute: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  sends: [number, number];
  effects: EffectSlot[];
};

export type MidiNote = { tick: number; duration: number; pitch: number; velocity: number };

export type StepCell = { on: boolean; velocity: number; probability: number };

export type StepRow = { sampleId: string; cells: StepCell[] };

export type Clip =
  | { id: string; trackId: string; startTick: number; kind: 'midi'; notes: MidiNote[] }
  | { id: string; trackId: string; startTick: number; kind: 'step'; steps: number; swing: number; rows: StepRow[] }
  | { id: string; trackId: string; startTick: number; kind: 'audio'; sampleId: string; durationTicks: number };

export type MidiClip = Extract<Clip, { kind: 'midi' }>;
export type StepClip = Extract<Clip, { kind: 'step' }>;
export type AudioClip = Extract<Clip, { kind: 'audio' }>;

export type Project = {
  version: 1;
  bpm: number;
  key: string;
  timeSignature: [number, number];
  ticksPerBeat: number;
  tracks: Track[];
  clips: Clip[];
  samples: { id: string; name: string }[];
};

export const FACTORY = {
  kick: 'smp_kick',
  snare: 'smp_snare',
  hat: 'smp_hat',
  clap: 'smp_clap',
  impulse: 'impulse',
} as const;

export const TRACK = {
  drums: 'trk_drums',
  bass: 'trk_bass',
  keys: 'trk_keys',
  melody: 'trk_melody',
  audio: 'trk_audio',
  vocals: 'trk_vocals',
} as const;

export const CLIP = {
  drums: 'clip_drums',
  bass: 'clip_bass',
  keys: 'clip_keys',
  melody: 'clip_melody',
} as const;

export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Project>;
  return v.version === 1 && typeof v.bpm === 'number' && Array.isArray(v.tracks) && Array.isArray(v.clips) && typeof v.key === 'string';
}
