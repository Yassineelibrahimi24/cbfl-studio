import { useEffect, useRef, useState } from 'react';
import type { Project, StepClip } from '../types';
import { stepCycleTicks, stepIndexAt } from '../audio/timeline';
import { clamp } from '../util';
import { useStore } from '../state/store';
import { useEngine } from './engineContext';
import { HELP, tip, useSetHelp } from './help';

export function StepGrid() {
  const { state, dispatch } = useStore();
  const engine = useEngine();
  const setHelp = useSetHelp();
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId && item.kind === 'step') as StepClip | undefined;
  const [playStep, setPlayStep] = useState(-1);
  const before = useRef<Project | null>(null);
  const drag = useRef<{ row: number; step: number; y: number; vel: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!clip) return;
    let frame = 0;
    const loop = () => {
      const tick = engine?.getPositionTick() ?? 0;
      const cycle = stepCycleTicks(clip, state.project);
      let local = tick - clip.startTick;
      local = ((local % cycle) + cycle) % cycle;
      const index = engine?.isPlaying() ? stepIndexAt(clip, state.project, local) : -1;
      setPlayStep((prev) => (prev === index ? prev : index));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [clip, engine, state.project]);

  if (!clip) {
    return <div className="editor-empty">No pattern on this track. Add a clip, then toggle steps.</div>;
  }

  const selected = state.selectedCell;

  return (
    <div className="stepgrid">
      <div className="toolbar">
        <label {...tip(HELP.swing, setHelp)}>
          Swing {Math.round(clip.swing * 100)}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(clip.swing * 100)}
            onPointerDown={() => { before.current = structuredClone(state.project); }}
            onChange={(event) => {
              const swing = Number(event.target.value) / 100;
              dispatch({
                type: 'edit',
                history: false,
                recipe: (draft) => {
                  const item = draft.clips.find((clipItem) => clipItem.id === clip.id);
                  if (item && item.kind === 'step') item.swing = swing;
                },
              });
            }}
            onPointerUp={() => {
              if (before.current) dispatch({ type: 'commitSnapshot', before: before.current });
              before.current = null;
            }}
          />
        </label>
        <span className="hint" {...tip(HELP.step, setHelp)}>16ths · drag a cell for velocity</span>
      </div>
      {clip.rows.map((row, rowIndex) => (
        <div
          key={`${row.sampleId}-${rowIndex}`}
          className="steprow"
          onDragOver={(event) => {
            if ([...event.dataTransfer.types].includes('application/x-cbfl-sample')) event.preventDefault();
          }}
          onDrop={(event) => {
            const sampleId = event.dataTransfer.getData('application/x-cbfl-sample');
            if (!sampleId) return;
            event.preventDefault();
            dispatch({
              type: 'edit',
              history: true,
              recipe: (draft) => {
                const item = draft.clips.find((clipItem) => clipItem.id === clip.id);
                if (!item || item.kind !== 'step') return;
                const target = item.rows[rowIndex];
                if (target) target.sampleId = sampleId;
              },
            });
          }}
        >
          <button
            className="rowname"
            {...tip(HELP.row, setHelp)}
            onClick={() => engine?.previewSample(row.sampleId)}
          >
            {state.project.samples.find((sample) => sample.id === row.sampleId)?.name ?? row.sampleId}
          </button>
          <div className="cells">
            {row.cells.map((cell, step) => (
              <button
                key={step}
                className={[
                  'cell',
                  cell.on ? 'on' : '',
                  playStep === step ? 'now' : '',
                  selected?.row === rowIndex && selected.step === step ? 'sel' : '',
                  step % 4 === 0 ? 'down' : '',
                ].filter(Boolean).join(' ')}
                style={{ ['--vel' as string]: cell.on ? String(0.35 + cell.velocity * 0.65) : '0.2' }}
                {...tip(HELP.step, setHelp)}
                onPointerDown={(event) => {
                  try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* already released */ }
                  drag.current = { row: rowIndex, step, y: event.clientY, vel: cell.velocity, moved: false };
                  before.current = structuredClone(state.project);
                  dispatch({ type: 'selectCell', cell: { row: rowIndex, step } });
                }}
                onPointerMove={(event) => {
                  const current = drag.current;
                  if (!current || current.row !== rowIndex || current.step !== step) return;
                  const dy = current.y - event.clientY;
                  if (Math.abs(dy) < 4) return;
                  current.moved = true;
                  dispatch({
                    type: 'setCell',
                    clipId: clip.id,
                    row: rowIndex,
                    step,
                    patch: { on: true, velocity: clamp(current.vel + dy / 90, 0.05, 1) },
                  });
                }}
                onPointerUp={() => {
                  const current = drag.current;
                  drag.current = null;
                  if (!current) return;
                  if (!current.moved) {
                    dispatch({ type: 'toggleStep', clipId: clip.id, row: rowIndex, step });
                    before.current = null;
                    return;
                  }
                  if (before.current) dispatch({ type: 'commitSnapshot', before: before.current });
                  before.current = null;
                }}
              >
                {cell.probability < 0.999 ? <i /> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
      {selected && clip.rows[selected.row]?.cells[selected.step] ? (
        <div className="cell-edit">
          <label {...tip(HELP.velocity, setHelp)}>
            Velocity {Math.round((clip.rows[selected.row]?.cells[selected.step]?.velocity ?? 0) * 100)}
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round((clip.rows[selected.row]?.cells[selected.step]?.velocity ?? 0.8) * 100)}
              onPointerDown={() => { before.current = structuredClone(state.project); }}
              onChange={(event) => dispatch({
                type: 'setCell',
                clipId: clip.id,
                row: selected.row,
                step: selected.step,
                patch: { velocity: Number(event.target.value) / 100 },
              })}
              onPointerUp={() => {
                if (before.current) dispatch({ type: 'commitSnapshot', before: before.current });
                before.current = null;
              }}
            />
          </label>
          <label {...tip(HELP.probability, setHelp)}>
            Probability {Math.round((clip.rows[selected.row]?.cells[selected.step]?.probability ?? 1) * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((clip.rows[selected.row]?.cells[selected.step]?.probability ?? 1) * 100)}
              onPointerDown={() => { before.current = structuredClone(state.project); }}
              onChange={(event) => dispatch({
                type: 'setCell',
                clipId: clip.id,
                row: selected.row,
                step: selected.step,
                patch: { probability: Number(event.target.value) / 100 },
              })}
              onPointerUp={() => {
                if (before.current) dispatch({ type: 'commitSnapshot', before: before.current });
                before.current = null;
              }}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
