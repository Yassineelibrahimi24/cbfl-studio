export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type KeyInfo = { root: number; minor: boolean };

export function parseKey(key: string): KeyInfo {
  const m = key.trim().match(/^([A-Ga-g])([#b])?\s*(major|minor|maj|min|m)?$/);
  if (!m) return { root: 9, minor: true };
  let root = NATURAL[m[1].toUpperCase()] ?? 0;
  if (m[2] === '#') root = (root + 1) % 12;
  if (m[2] === 'b') root = (root + 11) % 12;
  const q = (m[3] ?? 'major').toLowerCase();
  const minor = q === 'm' || q === 'min' || q === 'minor';
  return { root, minor };
}

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export function scaleOffsets(minor: boolean): number[] {
  return minor ? MINOR_SCALE : MAJOR_SCALE;
}

export function pitchClass(pitch: number): number {
  return ((Math.round(pitch) % 12) + 12) % 12;
}

export function noteName(pitch: number): string {
  const pc = pitchClass(pitch);
  const oct = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function scaleSet(key: KeyInfo): Set<number> {
  return new Set(scaleOffsets(key.minor).map((s) => (key.root + s) % 12));
}

export function inScale(pitch: number, key: KeyInfo): boolean {
  return scaleSet(key).has(pitchClass(pitch));
}

export type TriadQuality = 'maj' | 'min' | 'dim';

const MAJOR_QUALITY: TriadQuality[] = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
const MINOR_QUALITY: TriadQuality[] = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'];

export function diatonicQuality(degree: number, minor: boolean): TriadQuality {
  const table = minor ? MINOR_QUALITY : MAJOR_QUALITY;
  const idx = ((degree % 7) + 7) % 7;
  return table[idx] ?? 'maj';
}

export function degreeOffset(degree: number, minor: boolean): number {
  const scale = scaleOffsets(minor);
  const idx = ((degree % 7) + 7) % 7;
  const oct = Math.floor(degree / 7);
  return (scale[idx] ?? 0) + oct * 12;
}

export function nearestPitch(pc: number, center: number): number {
  const base = pitchClass(pc);
  let best = base;
  let bestDist = Infinity;
  for (let oct = -1; oct <= 9; oct++) {
    const n = base + oct * 12;
    const d = Math.abs(n - center);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

export function triadPitches(rootPc: number, quality: TriadQuality, center: number): number[] {
  const root = nearestPitch(rootPc, center);
  const third = root + (quality === 'maj' ? 4 : 3);
  const fifth = root + (quality === 'dim' ? 6 : 7);
  return [root, third, fifth];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function romanLabel(degree: number, quality: TriadQuality): string {
  const idx = ((degree % 7) + 7) % 7;
  const raw = ROMAN[idx] ?? 'I';
  if (quality === 'min') return raw.toLowerCase();
  if (quality === 'dim') return `${raw.toLowerCase()}°`;
  return raw;
}

export function chordSymbol(rootPc: number, quality: TriadQuality): string {
  const name = NOTE_NAMES[pitchClass(rootPc)];
  if (quality === 'min') return `${name}m`;
  if (quality === 'dim') return `${name}dim`;
  return name;
}

export const MAJOR_PROGRESSIONS: number[][] = [
  [0, 4, 5, 3],
  [0, 5, 3, 4],
  [0, 3, 4, 0],
];

export const MINOR_PROGRESSIONS: number[][] = [
  [0, 5, 2, 6],
  [0, 3, 4, 0],
  [0, 5, 3, 4],
];

export function snapToScale(pitch: number, key: KeyInfo): number {
  if (inScale(pitch, key)) return pitch;
  for (let d = 1; d <= 6; d++) {
    if (inScale(pitch + d, key)) return pitch + d;
    if (inScale(pitch - d, key)) return pitch - d;
  }
  return pitch;
}
