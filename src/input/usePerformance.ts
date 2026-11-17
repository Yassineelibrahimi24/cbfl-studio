import { useEffect, useRef } from 'react';
import type { AudioEngine } from '../audio/engine';
import { stepCycleTicks, stepIndexAt, stepTicks } from '../audio/timeline';
import type { Action, State } from '../state/store';
import { FACTORY } from '../types';
import { uid } from '../util';

const CHROMA = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM'];
const DRUM_KEYS: Record<string, number> = { KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3 };
const DRUM_NOTES: Record<number, number> = { 36: 0, 38: 1, 42: 2, 39: 3 };

type Held = { pitch: number; tick: number; clipId: string; trackId: string; clipStart: number };

export function usePerformance(
  engine: AudioEngine | null,
  state: State,
  dispatch: (action: Action) => void,
  onToggle: () => void,
) {
  const live = useRef({ engine, state, dispatch, onToggle });
  live.current = { engine, state, dispatch, onToggle };
  const held = useRef(new Map<string, Held>());

  const noteOn = (id: string, pitch: number) => {
    const { engine: audio, state: current } = live.current;
    if (!audio) return;
    const track = current.project.tracks.find((item) => item.id === current.selectedTrackId);
    if (!track) return;
    if (track.kind === 'drum') {
      const row = DRUM_NOTES[pitch];
      if (row === undefined) return;
      playDrum(row);
      return;
    }
    if (track.kind === 'audio') return;
    audio.previewNote(pitch, track.kind === 'bass');
    if (!current.transport.recording || !audio.isPlaying()) return;
    const existing = current.project.clips.find((clip) => clip.kind === 'midi' && clip.trackId === track.id && clip.id === current.selectedClipId);
    const clipId = existing?.id ?? uid('clip');
    const clipStart = existing?.startTick ?? Math.max(0, Math.round(audio.getPositionTick()));
    const tick = Math.max(0, Math.round(audio.getPositionTick() - clipStart));
    held.current.set(id, { pitch, tick, clipId, trackId: track.id, clipStart });
  };

  const noteOff = (id: string) => {
    const item = held.current.get(id);
    held.current.delete(id);
    if (!item) return;
    const { engine: audio, state: current, dispatch: send } = live.current;
    if (!audio) return;
    const end = Math.max(0, Math.round(audio.getPositionTick() - item.clipStart));
    send({
      type: 'recordNote',
      clipId: item.clipId,
      trackId: item.trackId,
      startTick: item.clipStart,
      note: {
        tick: item.tick,
        duration: Math.max(stepTicks(current.project), end - item.tick),
        pitch: item.pitch,
        velocity: 0.84,
      },
    });
    send({ type: 'selectClip', clipId: item.clipId });
  };

  const playDrum = (row: number) => {
    const { engine: audio, state: current, dispatch: send } = live.current;
    if (!audio) return;
    const track = current.project.tracks.find((item) => item.id === current.selectedTrackId);
    if (!track || track.kind !== 'drum') return;
    const clip = current.project.clips.find((item) => item.kind === 'step' && item.trackId === track.id);
    const sampleId = clip && clip.kind === 'step' ? clip.rows[row]?.sampleId : [FACTORY.kick, FACTORY.snare, FACTORY.hat, FACTORY.clap][row];
    if (sampleId) audio.previewSample(sampleId);
    if (!current.transport.recording || !audio.isPlaying() || !clip || clip.kind !== 'step') return;
    const cycle = stepCycleTicks(clip, current.project);
    let local = audio.getPositionTick() - clip.startTick;
    local = ((local % cycle) + cycle) % cycle;
    send({
      type: 'recordStep',
      clipId: clip.id,
      trackId: track.id,
      startTick: clip.startTick,
      row,
      step: stepIndexAt(clip, current.project, local),
      sampleIds: clip.rows.map((item) => item.sampleId),
    });
  };

  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const tag = target instanceof HTMLElement ? target.tagName : '';
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || typing(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        live.current.onToggle();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        live.current.dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        live.current.dispatch({ type: 'deleteSelected' });
        return;
      }
      const track = live.current.state.project.tracks.find((item) => item.id === live.current.state.selectedTrackId);
      if (track?.kind === 'drum') {
        const row = DRUM_KEYS[event.code];
        if (row !== undefined) playDrum(row);
        return;
      }
      const semi = CHROMA.indexOf(event.code);
      if (semi < 0 || !track) return;
      noteOn(event.code, (track.kind === 'bass' ? 36 : 60) + semi);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (typing(event.target)) return;
      noteOff(event.code);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // Handlers read the latest project through a ref, so the listener is bound once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const enable = async () => {
      const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
      if (!nav.requestMIDIAccess) {
        live.current.dispatch({ type: 'status', text: 'Web MIDI is not available in this browser.' });
        return;
      }
      try {
        const access = await nav.requestMIDIAccess();
        if (cancelled) return;
        const hook = (input: MIDIInput) => {
          input.onmidimessage = (event) => {
            const data = event.data;
            if (!data || data.length < 3) return;
            const status = data[0] ?? 0;
            const note = data[1] ?? 0;
            const velocity = data[2] ?? 0;
            const command = status & 0xf0;
            const track = live.current.state.project.tracks.find((item) => item.id === live.current.state.selectedTrackId);
            if (track?.kind === 'drum') {
              const row = DRUM_NOTES[note];
              if (row !== undefined && command === 0x90 && velocity > 0) playDrum(row);
              return;
            }
            if (command === 0x90 && velocity > 0) noteOn(`midi-${note}`, note);
            if (command === 0x80 || (command === 0x90 && velocity === 0)) noteOff(`midi-${note}`);
          };
        };
        for (const input of access.inputs.values()) hook(input);
        access.onstatechange = () => {
          for (const input of access.inputs.values()) hook(input);
        };
        live.current.dispatch({
          type: 'status',
          text: `MIDI ready. ${access.inputs.size} input${access.inputs.size === 1 ? '' : 's'}.`,
        });
      } catch {
        live.current.dispatch({ type: 'status', text: 'MIDI permission was denied.' });
      }
    };
    (window as unknown as { __cbflEnableMidi?: () => Promise<void> }).__cbflEnableMidi = enable;
    return () => {
      cancelled = true;
    };
  }, []);
}
