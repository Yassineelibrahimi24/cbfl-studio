import { createContext, useContext, useState, type ReactNode } from 'react';

export const HELP = {
  idle: 'Hover any control for a one-line explanation. Sound is scheduled on the audio clock.',
  play: 'Play from the playhead. Notes start on the audio clock, not on a screen redraw.',
  stop: 'Silence every voice immediately. Press Stop again to return to the loop start.',
  record: 'Record the mic into an audio clip, or keys into the selected MIDI clip. Needs a click.',
  bpm: 'Tempo in beats per minute. Changing it changes the gap between kicks.',
  metronome: 'Kick burst on every beat, separate from the drum pattern. Mute drums if both feel stacked.',
  loop: 'Repeat the region between loop start and loop end.',
  loopStart: 'Loop start, in bars.',
  loopEnd: 'Loop end, in bars. Playback jumps back to the start at this bar.',
  snap: 'Snap clip moves, note draws, and seeks to this grid.',
  time: 'Playhead as bar.beat.16th. Click the ruler to move it.',
  undo: 'Undo the last edit. Suggestions are not applied by undo until you have accepted one.',
  redo: 'Redo the edit you just undid.',
  save: 'Write the project JSON and sample blobs into this browser.',
  reload: 'Replace the open project with the copy stored in this browser.',
  exportMix: 'Render a stereo WAV of the arrangement. The file has no tempo tag.',
  exportMp3: 'Render the same stereo mix, encode MP3 in this browser, and save it to your downloads. Nothing is uploaded.',
  exportStems: 'Render one WAV per track with that track soloed. WAV files still have no tempo.',
  exportMidi: 'Download a Type 1 MIDI file. Drums are on channel 10.',
  exportMeta: 'Download project.meta.json with bpm, key, and time signature for FL.',
  key: 'Song key, such as A minor or F# major. Scale rows and theory tools use it.',
  meter: 'Output level. A kick on each beat flashes this while the drums play.',
  signature: 'Time signature. A beat is the denominator, and sixteen steps are four beats.',
  track: 'Select this track. Mute and solo apply in the mixer and the playlist.',
  mute: 'Mute this track. A muted kick also stops ducking tracks that listen to it.',
  solo: 'Solo this track. If any track is soloed, the others go silent.',
  rename: 'Rename the track. The name is written into the MIDI file.',
  playlist: 'Drag clips to move them. They snap to the grid. Drop a one-shot on the audio lane.',
  ruler: 'Click to move the playhead. Drag the loop edges to resize the loop.',
  step: 'Click a cell to toggle it. Drag up or down to change velocity.',
  swing: 'Delay odd 16ths. Even kicks stay on the beat, so the kick gap stays one beat.',
  velocity: 'How hard this step or note plays, from soft to full.',
  probability: 'Chance this step plays each loop. 100% always plays.',
  row: 'This drum row. Drop a one-shot here to change its sample. Click to preview.',
  newClip: 'Add an empty clip on the selected track.',
  deleteClip: 'Remove the selected clip from the playlist.',
  piano: 'Draw notes on the 808 or MIDI track. Highlighted rows are in key.',
  quantize: 'Snap every note in this clip to the current grid.',
  octave: 'Shift the piano roll up or down an octave.',
  deleteNote: 'Delete the selected note. Delete and Backspace do the same.',
  volume: 'Track volume, after the insert effects.',
  pan: 'Left and right placement of this track.',
  send1: 'Send level into the shared reverb bus.',
  send2: 'Send level into the shared delay bus.',
  master: 'Master volume in front of the speakers.',
  eq: 'Shelf and mid bell, in decibels. Zero is flat.',
  comp: 'Compressor threshold and ratio on this track.',
  reverb: 'Insert reverb mix. The impulse is synthesized, not a recorded room.',
  delay: 'Insert delay time, feedback, and mix.',
  drive: 'WaveShaper saturation. Zero is clean.',
  sidechain: 'Duck this track with a gain envelope when the source kick plays.',
  addFx: 'Add an insert. Sidechain ducks with a gain envelope so Safari can play it.',
  removeFx: 'Remove this insert from the track.',
  chords: 'Suggest a diatonic progression. Nothing changes until you accept.',
  melody: 'Suggest a melody that stays in the song key.',
  bass: 'Suggest 808 notes locked to the chord roots.',
  drums: 'Suggest a 16-step drum pattern.',
  vary: 'Suggest a variation of the selected clip. The original stays until you accept.',
  accept: 'Write the suggestion into the project. This is the only way a suggestion lands.',
  reject: 'Drop the suggestion. The project stays as it is.',
  sample: 'Preview this sound. Drag it onto a drum row, the Audio lane, or Vocals.',
  critique: 'Notes, not a grade. Gold means outside the key, or the kick and 808 hit together. Blue means an empty bar, or nothing to flag.',
  ideas: 'Drafts stay here until you press Accept.',
  sounds: 'Built-in drums, sounds you add, and a free CC0 pack.',
  newSong: 'Start over. This browser keeps one song, so download an MP3 first if you want to keep this one.',
  addSample: 'Add a wav, mp3, or ogg from this computer. It joins the sound list.',
  addLink: 'Add a sound from a link. It only works when that site lets the browser fetch the file.',
  midiIn: 'Listen to a hardware keyboard. Notes play the selected track and record while recording.',
  keys: 'Computer keys Z through M play the selected pitched track. Z X C V play drums.',
  audioLane: 'Drop a sound here or press Record. On Vocals, the recording sits on top of the beat.',
} as const;

const SetCtx = createContext<(text: string) => void>(() => undefined);
const TextCtx = createContext<string>(HELP.idle);

export function HelpProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string>(HELP.idle);
  return (
    <SetCtx.Provider value={setText}>
      <TextCtx.Provider value={text}>{children}</TextCtx.Provider>
    </SetCtx.Provider>
  );
}

export function useSetHelp(): (text: string) => void {
  return useContext(SetCtx);
}

export function HelpBar() {
  const text = useContext(TextCtx);
  return <footer className="helpbar">{text}</footer>;
}

export function tip(help: string, setHelp: (text: string) => void): {
  title: string;
  onMouseEnter: () => void;
  onFocus: () => void;
} {
  return {
    title: help,
    onMouseEnter: () => setHelp(help),
    onFocus: () => setHelp(help),
  };
}
