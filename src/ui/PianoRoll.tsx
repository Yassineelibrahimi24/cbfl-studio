import { useEffect, useRef, useState } from 'react';
import type { MidiClip, MidiNote, Project } from '../types';
import { gridTicks, snapTicks, stepTicks } from '../audio/timeline';
import { noteName, parseKey, pitchClass, scaleSet } from '../theory/music';
import { clamp } from '../util';
import { useStore } from '../state/store';
import { useEngine } from './engineContext';
import { HELP, tip, useSetHelp } from './help';

const ROW_H = 12;
const KEY_W = 52;
const CELL_W = 18;
const ROWS = 24;
const BARS = 8;

type Drag =
  | { mode: 'create'; pitch: number; tick: number; before: Project }
  | { mode: 'move'; index: number; grabTick: number; originTick: number; originPitch: number; before: Project }
  | { mode: 'resize'; index: number; origin: number; before: Project };

export function PianoRoll() {
  const { state, dispatch } = useStore();
  const engine = useEngine();
  const setHelp = useSetHelp();
  const track = state.project.tracks.find((item) => item.id === state.selectedTrackId);
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId && item.kind === 'midi') as MidiClip | undefined;
  const [pitchLo, setPitchLo] = useState(track?.kind === 'bass' ? 28 : 48);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const data = useRef({ state, pitchLo });
  data.current = { state, pitchLo };
  const drag = useRef<Drag | null>(null);
  const notesRef = useRef<MidiNote[]>([]);
  notesRef.current = clip?.notes ?? [];

  useEffect(() => {
    setPitchLo(track?.kind === 'bass' ? 28 : 48);
  }, [track?.id, track?.kind]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      const view = data.current;
      const project = view.state.project;
      const width = KEY_W + BARS * project.timeSignature[0] * 4 * CELL_W;
      const height = ROWS * ROW_H;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, width, height, view.state, view.pitchLo, engine?.getPositionTick() ?? 0, clip?.startTick ?? 0);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, clip?.startTick]);

  if (!clip || !track) {
    return <div className="editor-empty">Select a MIDI clip, or add one, then draw notes. Highlighted rows are in key.</div>;
  }

  const selected = clip.notes[state.selectedNoteIndex ?? -1];

  const locate = (x: number, y: number) => {
    const project = data.current.state.project;
    const step = stepTicks(project);
    const grid = gridTicks(project, data.current.state.transport.snap);
    const pitch = data.current.pitchLo + ROWS - 1 - Math.floor(y / ROW_H);
    const tick = snapTicks(((x - KEY_W) / CELL_W) * step, grid);
    return { pitch: clamp(pitch, 0, 120), tick: Math.max(0, tick), grid };
  };

  const write = (notes: MidiNote[], history: boolean) => {
    notesRef.current = notes;
    dispatch({ type: 'setNotes', clipId: clip.id, notes, history });
  };

  return (
    <div className="piano">
      <div className="toolbar">
        <button className="btn" {...tip(HELP.octave, setHelp)} onClick={() => setPitchLo((value) => clamp(value - 12, 0, 96))}>Oct −</button>
        <button className="btn" {...tip(HELP.octave, setHelp)} onClick={() => setPitchLo((value) => clamp(value + 12, 0, 96))}>Oct +</button>
        <span className="hint">{noteName(pitchLo)}–{noteName(pitchLo + ROWS - 1)}</span>
        <button
          className="btn"
          {...tip(HELP.quantize, setHelp)}
          onClick={() => {
            const grid = gridTicks(state.project, state.transport.snap);
            write(clip.notes.map((note) => ({
              ...note,
              tick: snapTicks(note.tick, grid),
              duration: Math.max(grid, snapTicks(note.duration, grid)),
            })), true);
          }}
        >Quantize</button>
        <button
          className="btn"
          {...tip(HELP.deleteNote, setHelp)}
          onClick={() => dispatch({ type: 'deleteSelected' })}
        >Delete note</button>
        {selected ? (
          <label {...tip(HELP.velocity, setHelp)}>
            Vel {Math.round(selected.velocity * 100)}
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round(selected.velocity * 100)}
              onChange={(event) => {
                const velocity = Number(event.target.value) / 100;
                const notes = clip.notes.map((note, index) => index === state.selectedNoteIndex ? { ...note, velocity } : note);
                write(notes, false);
              }}
            />
          </label>
        ) : null}
        <span className="hint" {...tip(HELP.piano, setHelp)}>Draw, drag, and resize. In-key rows are brighter.</span>
      </div>
      <div className="piano-scroll">
        <canvas
          ref={canvasRef}
          {...tip(HELP.piano, setHelp)}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const { pitch, tick, grid } = locate(x, y);
            if (x < KEY_W) {
              engine?.previewNote(pitch, track.kind === 'bass');
              return;
            }
            const hit = hitNote(clip.notes, x, y, data.current.pitchLo, state.project);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* already released */ }
            if (!hit) {
              const before = structuredClone(state.project);
              const notes = [...clip.notes, { tick, duration: grid, pitch, velocity: 0.8 }];
              drag.current = { mode: 'create', pitch, tick, before };
              write(notes, false);
              dispatch({ type: 'selectNote', index: notes.length - 1 });
              return;
            }
            dispatch({ type: 'selectNote', index: hit.index });
            const before = structuredClone(state.project);
            if (hit.edge) drag.current = { mode: 'resize', index: hit.index, origin: clip.notes[hit.index]?.duration ?? grid, before };
            else drag.current = {
              mode: 'move',
              index: hit.index,
              grabTick: tick,
              originTick: clip.notes[hit.index]?.tick ?? 0,
              originPitch: clip.notes[hit.index]?.pitch ?? pitch,
              before,
            };
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const { pitch, tick, grid } = locate(event.clientX - rect.left, event.clientY - rect.top);
            const notes = notesRef.current.map((note) => ({ ...note }));
            if (current.mode === 'create') {
              const note = notes[notes.length - 1];
              if (!note) return;
              note.pitch = current.pitch;
              note.tick = Math.min(current.tick, tick);
              note.duration = Math.max(grid, Math.abs(tick - current.tick) || grid);
            } else if (current.mode === 'move') {
              const note = notes[current.index];
              if (!note) return;
              note.tick = Math.max(0, current.originTick + (tick - current.grabTick));
              note.pitch = pitch;
            } else {
              const note = notes[current.index];
              if (!note) return;
              note.duration = Math.max(grid, tick - note.tick);
            }
            write(notes, false);
          }}
          onPointerUp={() => {
            const current = drag.current;
            drag.current = null;
            if (current) dispatch({ type: 'commitSnapshot', before: current.before });
          }}
        />
      </div>
    </div>
  );
}

function hitNote(notes: MidiNote[], x: number, y: number, pitchLo: number, project: Project): { index: number; edge: boolean } | null {
  const step = stepTicks(project);
  const pitchHi = pitchLo + ROWS - 1;
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    if (!note || note.pitch < pitchLo || note.pitch > pitchHi) continue;
    const left = KEY_W + (note.tick / step) * CELL_W;
    const right = left + Math.max(8, (note.duration / step) * CELL_W);
    const top = (pitchHi - note.pitch) * ROW_H;
    if (x >= left && x <= right && y >= top && y <= top + ROW_H) {
      return { index: i, edge: x > right - 8 };
    }
  }
  return null;
}

function paint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: { project: Project; selectedNoteIndex: number | null; selectedClipId: string | null },
  pitchLo: number,
  playhead: number,
  clipStart: number,
) {
  const project = state.project;
  const clip = project.clips.find((item) => item.id === state.selectedClipId && item.kind === 'midi');
  const key = parseKey(project.key);
  const scale = scaleSet(key);
  const pitchHi = pitchLo + ROWS - 1;
  const step = stepTicks(project);
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < ROWS; i++) {
    const pitch = pitchHi - i;
    const pc = pitchClass(pitch);
    const inKey = scale.has(pc);
    const root = pc === key.root;
    ctx.fillStyle = root ? '#3a2e1d' : inKey ? '#232833' : '#15181e';
    ctx.fillRect(KEY_W, i * ROW_H, width - KEY_W, ROW_H);
    ctx.fillStyle = root ? '#6a5432' : inKey ? '#2c3340' : '#1c2028';
    ctx.fillRect(0, i * ROW_H, KEY_W, ROW_H - 1);
    if (pc === 0 || root) {
      ctx.fillStyle = '#c5cad3';
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(noteName(pitch), 4, i * ROW_H + 9);
    }
    ctx.strokeStyle = '#101218';
    ctx.beginPath();
    ctx.moveTo(KEY_W, i * ROW_H + ROW_H - 0.5);
    ctx.lineTo(width, i * ROW_H + ROW_H - 0.5);
    ctx.stroke();
  }
  const cells = BARS * project.timeSignature[0] * 4;
  for (let i = 0; i <= cells; i++) {
    const x = KEY_W + i * CELL_W;
    const barLine = i % (project.timeSignature[0] * 4) === 0;
    ctx.strokeStyle = barLine ? '#3c4454' : i % 4 === 0 ? '#2a3140' : '#222733';
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  if (clip && clip.kind === 'midi') {
    clip.notes.forEach((note, index) => {
      if (note.pitch < pitchLo || note.pitch > pitchHi) return;
      const x = KEY_W + (note.tick / step) * CELL_W;
      const w = Math.max(6, (note.duration / step) * CELL_W - 1);
      const y = (pitchHi - note.pitch) * ROW_H + 1;
      ctx.fillStyle = index === state.selectedNoteIndex ? '#ffb07a' : `rgba(255, 138, 61, ${0.45 + note.velocity * 0.55})`;
      ctx.fillRect(x, y, w, ROW_H - 2);
    });
  }
  const local = playhead - clipStart;
  if (local >= 0) {
    ctx.fillStyle = '#f4f7fb';
    ctx.fillRect(KEY_W + (local / step) * CELL_W, 0, 1.5, height);
  }
}
