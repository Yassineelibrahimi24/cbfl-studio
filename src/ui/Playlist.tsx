import { useEffect, useRef, useState } from 'react';
import type { Clip, Project } from '../types';
import { beatTicks, clipEndTick, gridTicks, snapTicks, timelineLengthTicks } from '../audio/timeline';
import type { Project as ProjectType } from '../types';
import { useStore } from '../state/store';
import { useEngine } from './engineContext';
import { HELP, tip, useSetHelp } from './help';
import { trackColor } from './theme';

const RULER = 28;
const ROW = 42;
const PX = 46;

type Drag =
  | { kind: 'clip'; id: string; origin: number; moved: boolean; before: ProjectType }
  | { kind: 'loop-start' | 'loop-end' }
  | { kind: 'seek' };

function xOf(tick: number, project: Project): number {
  return (tick / beatTicks(project)) * PX;
}

function tickOf(x: number, project: Project): number {
  return (x / PX) * beatTicks(project);
}

export function Playlist({ onDropSample }: { onDropSample: (trackId: string, tick: number, sampleId: string, clipId: string | null) => void }) {
  const { state, dispatch } = useStore();
  const engine = useEngine();
  const setHelp = useSetHelp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const data = useRef(state);
  data.current = state;
  const drag = useRef<Drag | null>(null);
  const [guide, setGuide] = useState(() => {
    try {
      return localStorage.getItem('cbfl-guide-dismissed') !== '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      const current = data.current;
      const project = current.project;
      const beats = Math.max(16, timelineLengthTicks(project) / beatTicks(project) + 2);
      const width = Math.ceil(beats * PX);
      const height = RULER + project.tracks.length * ROW;
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
      paint(ctx, width, height, current, engine?.getPositionTick() ?? 0, engine?.isPlaying() ?? false);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  const hit = (x: number, y: number) => {
    const project = data.current.project;
    const transport = data.current.transport;
    if (y < RULER) {
      const startX = xOf(transport.loopStartTick, project);
      const endX = xOf(transport.loopEndTick, project);
      if (Math.abs(x - startX) < 7) return { zone: 'loop-start' as const };
      if (Math.abs(x - endX) < 7) return { zone: 'loop-end' as const };
      return { zone: 'ruler' as const, tick: Math.max(0, tickOf(x, project)) };
    }
    const index = Math.floor((y - RULER) / ROW);
    const track = project.tracks[index];
    if (!track) return { zone: 'none' as const };
    const tick = Math.max(0, tickOf(x, project));
    const clips = project.clips.filter((clip) => clip.trackId === track.id);
    for (let i = clips.length - 1; i >= 0; i--) {
      const clip = clips[i];
      if (!clip) continue;
      const x0 = xOf(clip.startTick, project);
      const x1 = xOf(clipEndTick(clip, project), project);
      const y0 = RULER + index * ROW + 6;
      if (x >= x0 && x <= Math.max(x0 + 8, x1) && y >= y0 && y <= y0 + ROW - 12) {
        return { zone: 'clip' as const, clip, trackId: track.id, tick };
      }
    }
    return { zone: 'lane' as const, trackId: track.id, tick };
  };

  return (
    <section className="playlist" {...tip(HELP.playlist, setHelp)}>
      {guide ? (
        <div className="guide">
          <p>Play the demo. Click Drums and toggle a cell. Open Sounds and add a sample. Then File, Download MP3.</p>
          <button
            className="btn"
            type="button"
            onClick={() => {
              try {
                localStorage.setItem('cbfl-guide-dismissed', '1');
              } catch {
                /* this browser is keeping the guide for the session only */
              }
              setGuide(false);
            }}
          >Got it</button>
        </div>
      ) : null}
      <div className="pl-labels">
        <div className="pl-ruler-gap" {...tip(HELP.ruler, setHelp)} />
        {state.project.tracks.map((track, index) => (
          <div
            key={track.id}
            className={track.id === state.selectedTrackId ? 'pl-label on' : 'pl-label'}
            onClick={() => dispatch({ type: 'selectTrack', trackId: track.id })}
            {...tip(HELP.track, setHelp)}
          >
            <i style={{ background: trackColor(index) }} />
            <input
              value={track.name}
              {...tip(HELP.rename, setHelp)}
              onChange={(event) => {
                const name = event.target.value;
                dispatch({
                  type: 'edit',
                  history: false,
                  recipe: (draft) => {
                    const item = draft.tracks.find((entry) => entry.id === track.id);
                    if (item) item.name = name;
                  },
                });
              }}
              onFocus={(event) => {
                event.currentTarget.dataset.before = JSON.stringify(data.current.project);
              }}
              onBlur={(event) => {
                const raw = event.currentTarget.dataset.before;
                if (!raw) return;
                dispatch({ type: 'commitSnapshot', before: JSON.parse(raw) as Project });
              }}
            />
            <button
              className={track.mute ? 'mini on' : 'mini'}
              {...tip(HELP.mute, setHelp)}
              onClick={(event) => {
                event.stopPropagation();
                dispatch({
                  type: 'edit',
                  history: true,
                  recipe: (draft) => {
                    const item = draft.tracks.find((entry) => entry.id === track.id);
                    if (item) item.mute = !item.mute;
                  },
                });
              }}
            >M</button>
            <button
              className={track.solo ? 'mini solo' : 'mini'}
              {...tip(HELP.solo, setHelp)}
              onClick={(event) => {
                event.stopPropagation();
                dispatch({
                  type: 'edit',
                  history: true,
                  recipe: (draft) => {
                    const item = draft.tracks.find((entry) => entry.id === track.id);
                    if (item) item.solo = !item.solo;
                  },
                });
              }}
            >S</button>
          </div>
        ))}
      </div>
      <div
        className="pl-scroll"
        onDragOver={(event) => {
          if ([...event.dataTransfer.types].includes('application/x-cbfl-sample')) event.preventDefault();
        }}
        onDrop={(event) => {
          const sampleId = event.dataTransfer.getData('application/x-cbfl-sample');
          const canvas = canvasRef.current;
          if (!sampleId || !canvas) return;
          event.preventDefault();
          const rect = canvas.getBoundingClientRect();
          const target = hit(event.clientX - rect.left, event.clientY - rect.top);
          if (target.zone === 'clip') onDropSample(target.trackId, target.tick, sampleId, target.clip.id);
          if (target.zone === 'lane') onDropSample(target.trackId, target.tick, sampleId, null);
        }}
      >
        <canvas
          ref={canvasRef}
          {...tip(HELP.playlist, setHelp)}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const target = hit(event.clientX - rect.left, event.clientY - rect.top);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* already released */ }
            if (target.zone === 'clip') {
              dispatch({ type: 'selectClip', clipId: target.clip.id });
              drag.current = { kind: 'clip', id: target.clip.id, origin: target.clip.startTick, moved: false, before: structuredClone(data.current.project) };
            } else if (target.zone === 'loop-start' || target.zone === 'loop-end') {
              drag.current = { kind: target.zone };
            } else if (target.zone === 'ruler') {
              drag.current = { kind: 'seek' };
              const grid = gridTicks(data.current.project, data.current.transport.snap);
              engine?.seek(snapTicks(target.tick, grid));
            } else if (target.zone === 'lane') {
              dispatch({ type: 'selectTrack', trackId: target.trackId });
            }
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const project = data.current.project;
            const grid = gridTicks(project, data.current.transport.snap);
            const tick = snapTicks(tickOf(event.clientX - rect.left, project), grid);
            if (current.kind === 'clip') {
              current.moved = true;
              dispatch({
                type: 'edit',
                history: false,
                recipe: (draft) => {
                  const clip = draft.clips.find((item) => item.id === current.id);
                  if (clip) clip.startTick = tick;
                },
              });
            } else if (current.kind === 'loop-start') {
              const end = data.current.transport.loopEndTick;
              dispatch({ type: 'setTransport', patch: { loopStartTick: Math.min(tick, end - grid), loopOn: true } });
            } else if (current.kind === 'loop-end') {
              const start = data.current.transport.loopStartTick;
              dispatch({ type: 'setTransport', patch: { loopEndTick: Math.max(tick, start + grid), loopOn: true } });
            } else if (current.kind === 'seek') {
              engine?.seek(tick);
            }
          }}
          onPointerUp={() => {
            const current = drag.current;
            drag.current = null;
            if (current?.kind === 'clip' && current.moved) dispatch({ type: 'commitSnapshot', before: current.before });
          }}
        />
      </div>
    </section>
  );
}

function paint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: { project: Project; transport: { loopStartTick: number; loopEndTick: number; loopOn: boolean }; selectedClipId: string | null },
  playhead: number,
  playing: boolean,
) {
  const { project } = state;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#12141a';
  ctx.fillRect(0, 0, width, height);
  const beat = beatTicks(project);
  const bar = beat * project.timeSignature[0];
  const beats = width / PX;
  for (let i = 0; i < beats; i++) {
    const x = i * PX;
    const tick = i * beat;
    ctx.strokeStyle = tick % bar === 0 ? '#3a4150' : '#262b36';
    ctx.beginPath();
    ctx.moveTo(x + 0.5, RULER);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
    if (tick % bar === 0) {
      ctx.fillStyle = '#8b93a3';
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(Math.floor(tick / bar) + 1), x + 4, 16);
    }
  }
  project.tracks.forEach((_, index) => {
    const y = RULER + index * ROW;
    ctx.fillStyle = index % 2 === 0 ? '#161922' : '#13161d';
    ctx.fillRect(0, y, width, ROW);
    ctx.strokeStyle = '#2a303b';
    ctx.beginPath();
    ctx.moveTo(0, y + ROW - 0.5);
    ctx.lineTo(width, y + ROW - 0.5);
    ctx.stroke();
  });
  if (state.transport.loopOn) {
    const x0 = xOf(state.transport.loopStartTick, project);
    const x1 = xOf(state.transport.loopEndTick, project);
    ctx.fillStyle = 'rgba(255, 138, 61, 0.13)';
    ctx.fillRect(x0, 0, Math.max(2, x1 - x0), RULER);
    ctx.fillStyle = '#ff8a3d';
    ctx.fillRect(x0, 0, 2, height);
    ctx.fillRect(x1, 0, 2, height);
  }
  project.tracks.forEach((track, index) => {
    const color = trackColor(index);
    for (const clip of project.clips) {
      if (clip.trackId !== track.id) continue;
      const x = xOf(clip.startTick, project);
      const w = Math.max(10, xOf(clipEndTick(clip, project), project) - x);
      const y = RULER + index * ROW + 6;
      const h = ROW - 12;
      ctx.fillStyle = clip.id === state.selectedClipId ? color : hexAlpha(color, 0.78);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = clip.id === state.selectedClipId ? '#fff6ee' : 'rgba(0,0,0,0.35)';
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = '#14120f';
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(clipLabel(clip, project), x + 6, y + 16);
    }
  });
  const px = xOf(playhead, project);
  ctx.fillStyle = playing ? '#ffe1c4' : '#d7dbe4';
  ctx.fillRect(px, 0, 1.5, height);
}

function clipLabel(clip: Clip, project: Project): string {
  if (clip.kind === 'step') return 'Pattern';
  if (clip.kind === 'audio') return project.samples.find((sample) => sample.id === clip.sampleId)?.name ?? 'Audio';
  return `${clip.notes.length} notes`;
}

function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
