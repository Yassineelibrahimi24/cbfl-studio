import { FACTORY, TRACK } from './types';
import { createDefaultProject, ensureVocals } from './state/defaultProject';
import { barTicks, beatTicks, stepTicks } from './audio/timeline';
import { collectEvents } from './audio/events';
import { NoteCursor } from './audio/clock';
import { encodeWav, wavHasTempoChunk } from './audio/wav';
import { encodeMidi, metaSidecar } from './audio/midiFile';
import { critiqueProject } from './theory/critique';
import { planBeat, writeBeat } from './theory/compose';
import { pitchesInKey, suggestBass, suggestChords, suggestDrums, suggestMelody } from './theory/generate';
import { inScale, parseKey } from './theory/music';
import type { Project } from './types';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function approx(value: number, expected: number, slack = 0.02): boolean {
  return Math.abs(value - expected) <= slack;
}

const project = createDefaultProject();
const bar = barTicks(project);
const beat = beatTicks(project);
check(beat === 480, '4/4 beat is one quarter');
check(bar === 1920, 'bar is four beats');
check(stepTicks(project) === 120, 'sixteenth is a quarter of a beat');

const kicks = collectEvents(project, 0, bar, false).filter((event) => event.sampleId === FACTORY.kick);
check(kicks.length === 2, `expected 2 kicks in a bar, got ${kicks.length}`);
check(kicks[0]?.tick === 0 && kicks[1]?.tick === beat * 2, 'starter kicks sit on beats 1 and 3 so swing does not move them');

const cursor = new NoteCursor();
cursor.start({
  audioTime: 0,
  positionTick: 0,
  bpm: 120,
  project,
  loopOn: true,
  loopStart: 0,
  loopEnd: bar,
  metronome: false,
});
const times: number[] = [];
for (let t = 0; t < 3; t += 0.05) {
  for (const event of cursor.poll(t).events) {
    if (event.sampleId === FACTORY.kick) times.push(Number(event.audioTime.toFixed(4)));
  }
}
const unique = [...new Set(times)];
check(unique.length >= 3, `expected a looping kick, got ${unique.join(', ')}`);
for (let i = 1; i < unique.length; i++) {
  check(approx(unique[i] - unique[i - 1], 1, 0.03), `kick gap ${unique[i] - unique[i - 1]} should be 1s at 120 BPM`);
}

const late: Project = {
  ...project,
  clips: [{ id: 'n', trackId: project.tracks[1]?.id ?? 'trk_bass', startTick: 0, kind: 'midi', notes: [{ tick: beat, duration: beat, pitch: 33, velocity: 1 }] }],
};
const lateClock = new NoteCursor();
lateClock.start({
  audioTime: 0,
  positionTick: 0,
  bpm: 120,
  project: late,
  loopOn: false,
  loopStart: 0,
  loopEnd: bar,
  metronome: false,
});
check(lateClock.poll(0).events.length === 0, 'a note on the next beat is not emitted inside the first lookahead');
let found = false;
for (let t = 0.2; t < 0.7; t += 0.05) {
  if (lateClock.poll(t).events.some((event) => event.kind === 'midi')) found = true;
}
check(found, 'the note is emitted once the horizon reaches it');

const wav = encodeWav([new Float32Array([0, 0.5, -0.5]), new Float32Array([0, 0.25, -0.25])], 44100);
check(wav.byteLength === 44 + 12, 'stereo wav is a 44-byte header plus frames');
check(!wavHasTempoChunk(wav), 'wav carries no tempo chunk');
const header = new TextDecoder('latin1').decode(new Uint8Array(wav).slice(0, 44));
check(header.startsWith('RIFF') && header.includes('WAVE') && header.includes('fmt ') && header.includes('data'), 'wav header is PCM');

const midi = encodeMidi(project);
check(midi[0] === 0x4d && midi[1] === 0x54 && midi[2] === 0x68 && midi[3] === 0x64, 'midi starts with MThd');
check(new DataView(midi.buffer, midi.byteOffset, midi.byteLength).getUint16(8) === 1, 'midi is format 1');
const meta = JSON.parse(metaSidecar(project)) as { bpm: number; key: string; timeSignature: number[] };
check(meta.bpm === project.bpm && meta.key === project.key && meta.timeSignature[0] === 4 && meta.timeSignature[1] === 4, 'sidecar has bpm, key, time signature');

for (const seed of [1, 2, 3, 8]) {
  const chords = suggestChords(project, seed);
  const melody = suggestMelody(project, seed);
  const bass = suggestBass(project, seed);
  const drums = suggestDrums(project, seed);
  check(!!chords && chords.clip.kind === 'midi' && pitchesInKey(chords.clip.notes, project.key), 'chords stay in key');
  check(!!melody && melody.clip.kind === 'midi' && pitchesInKey(melody.clip.notes, project.key), 'melody stays in key');
  check(!!bass && bass.clip.kind === 'midi' && pitchesInKey(bass.clip.notes, project.key), 'bass stays in key');
  check(!!drums && drums.clip.kind === 'step' && drums.clip.rows[0]?.cells[0]?.on === true, 'drum suggestion has a downbeat kick');
}

const arrangement = critiqueProject(project);
check(!arrangement.some((item) => item.id === 'low-end'), 'the starter beat keeps the low notes off the kick');
check(arrangement.every((item) => !item.id.startsWith('key-')), 'the starter beat stays in key');

const sparse: Project = {
  ...project,
  clips: [
    {
      id: 'm',
      trackId: 'trk_melody',
      startTick: 0,
      kind: 'midi',
      notes: [{ tick: 0, duration: beat, pitch: 66, velocity: 0.8 }],
    },
  ],
};
const notes = critiqueProject(sparse);
check(notes.some((item) => item.id.startsWith('key-')), 'critique flags a note outside the key');
check(notes.some((item) => item.id === 'empty'), 'critique flags empty bars');
check(!inScale(66, parseKey('A minor')), 'F# is outside A minor');
const clashing = structuredClone(project);
const bassClip = clashing.clips.find((clip) => clip.trackId === TRACK.bass);
if (bassClip && bassClip.kind === 'midi') bassClip.notes.push({ tick: 0, duration: beat, pitch: 36, velocity: 1 });
check(critiqueProject(clashing).some((item) => item.message.startsWith('The kick and the low notes hit together')), 'low-end warning is plain language');
check(notes.some((item) => item.message.includes('outside the key')), 'key warning is plain language');
check(notes.some((item) => item.message.startsWith('Empty ')), 'empty bars stay a blue note');

check(project.tracks.some((track) => track.id === TRACK.vocals && track.kind === 'audio'), 'the default song has a vocals lane');
const without = { ...project, tracks: project.tracks.filter((track) => track.id !== TRACK.vocals) };
const migrated = ensureVocals(without);
check(migrated.tracks.some((track) => track.id === TRACK.vocals), 'an older song gains a vocals lane');
check(migrated.tracks.findIndex((track) => track.id === TRACK.vocals) === migrated.tracks.findIndex((track) => track.id === TRACK.audio) + 1, 'vocals sit after the audio lane');
check(ensureVocals(project) === project, 'a song that already has vocals is left in place');

const voices = { kick: 'k', snare: 's', hat: 'h', perc: 'p' };
for (const mood of ['chill', 'hard', 'sad', 'bouncy'] as const) {
  for (const seed of [0, 1, 2, 3, 4]) {
    const song = createDefaultProject();
    writeBeat(song, planBeat(mood, seed), 'all', voices);
    const review = critiqueProject(song);
    check(!review.some((item) => item.id === 'low-end'), `${mood} seed ${seed} keeps the low notes off the kick`);
    check(!review.some((item) => item.id.startsWith('key-')), `${mood} seed ${seed} stays in key`);
    const drum = song.clips.find((clip) => clip.trackId === TRACK.drums && clip.kind === 'step');
    check(!!drum && drum.kind === 'step' && drum.rows[1]?.cells[4]?.on === true && drum.rows[1]?.cells[12]?.on === true, `${mood} snare is on counts 2 and 4`);
  }
}

console.log('cbfl selftest ok');
