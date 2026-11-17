import { useEffect, useState } from 'react';
import type { Project } from '../types';
import { barTicks, beatTicks, formatPosition } from '../audio/timeline';
import { clamp, clampBpm } from '../util';
import { useStore } from '../state/store';
import { useEngine } from './engineContext';
import { HELP, tip, useSetHelp } from './help';

export function TransportBar({
  onPlay,
  onStop,
  onRecord,
  onSave,
  onReload,
  onExport,
}: {
  onPlay: () => void;
  onStop: () => void;
  onRecord: () => void;
  onSave: () => void;
  onReload: () => void;
  onExport: (kind: 'mix' | 'mp3' | 'stems' | 'midi' | 'meta') => void;
}) {
  const { state, dispatch } = useStore();
  const engine = useEngine();
  const setHelp = useSetHelp();
  const { project, transport } = state;
  const bar = barTicks(project);
  const [pos, setPos] = useState('1.1.1');
  const [level, setLevel] = useState(0);
  const [beatOn, setBeatOn] = useState(false);

  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    const loop = () => {
      const tick = engine?.getPositionTick() ?? 0;
      setPos(formatPosition(tick, project));
      const beat = beatTicks(project);
      const playing = engine?.isPlaying() ?? false;
      setBeatOn(playing && tick % beat < beat * 0.18);
      const peak = engine?.getLevel() ?? 0;
      smooth = Math.max(peak, smooth * 0.82);
      setLevel(smooth);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine, project]);

  const setBpm = (bpm: number, history: boolean) => {
    dispatch({
      type: 'edit',
      history,
      recipe: (draft) => {
        draft.bpm = clampBpm(bpm);
      },
    });
  };

  return (
    <header className="transport">
      <div className="brand" {...tip(HELP.idle, setHelp)}>CBFL</div>
      <button className="btn play" {...tip(HELP.play, setHelp)} onClick={onPlay}>Play</button>
      <button className="btn stop" {...tip(HELP.stop, setHelp)} onClick={onStop}>Stop</button>
      <button className={transport.recording ? 'btn stop' : 'btn'} {...tip(HELP.record, setHelp)} onClick={onRecord}>
        {transport.recording ? 'Recording' : 'Record'}
      </button>
      <label className="field" {...tip(HELP.bpm, setHelp)}>
        BPM
        <input
          type="range"
          min={40}
          max={240}
          value={project.bpm}
          onPointerDown={() => {
            bpmBefore = structuredClone(project);
          }}
          onChange={(event) => setBpm(Number(event.target.value), false)}
          onPointerUp={commitBpm}
          onBlur={commitBpm}
        />
        <input
          className="num"
          type="number"
          min={40}
          max={300}
          value={project.bpm}
          onChange={(event) => setBpm(Number(event.target.value), false)}
          onBlur={commitBpm}
        />
      </label>
      <div className="time" {...tip(HELP.time, setHelp)}>{pos}</div>
      <i className={beatOn ? 'led on' : 'led'} {...tip(HELP.meter, setHelp)} />
      <div className="meter" {...tip(HELP.meter, setHelp)}><span style={{ width: `${Math.min(100, level * 140)}%` }} /></div>
      <label className="check" {...tip(HELP.metronome, setHelp)}>
        <input
          type="checkbox"
          checked={transport.metronome}
          onChange={(event) => dispatch({ type: 'setTransport', patch: { metronome: event.target.checked } })}
        />
        Metro
      </label>
      <label className="check" {...tip(HELP.loop, setHelp)}>
        <input
          type="checkbox"
          checked={transport.loopOn}
          onChange={(event) => dispatch({ type: 'setTransport', patch: { loopOn: event.target.checked } })}
        />
        Loop
      </label>
      <label className="field tiny" {...tip(HELP.loopStart, setHelp)}>
        In
        <input
          className="num"
          type="number"
          min={1}
          value={Math.round(transport.loopStartTick / bar) + 1}
          onChange={(event) => {
            const start = (Math.max(1, Number(event.target.value)) - 1) * bar;
            dispatch({ type: 'setTransport', patch: { loopStartTick: start } });
          }}
        />
      </label>
      <label className="field tiny" {...tip(HELP.loopEnd, setHelp)}>
        Out
        <input
          className="num"
          type="number"
          min={2}
          value={Math.max(1, Math.round(transport.loopEndTick / bar))}
          onChange={(event) => {
            const end = Math.max(1, Number(event.target.value)) * bar;
            dispatch({ type: 'setTransport', patch: { loopEndTick: Math.max(end, transport.loopStartTick + bar) } });
          }}
        />
      </label>
      <label className="field" {...tip(HELP.snap, setHelp)}>
        Snap
        <select
          value={transport.snap}
          onChange={(event) => dispatch({ type: 'setTransport', patch: { snap: event.target.value as 'bar' | 'beat' | '16th' } })}
        >
          <option value="bar">Bar</option>
          <option value="beat">Beat</option>
          <option value="16th">1/16</option>
        </select>
      </label>
      <label className="field" {...tip(HELP.key, setHelp)}>
        Key
        <input
          className="key"
          defaultValue={project.key}
          key={project.key}
          onBlur={(event) => {
            const value = event.target.value.trim() || 'A minor';
            dispatch({ type: 'edit', history: true, recipe: (draft) => { draft.key = value; } });
          }}
        />
      </label>
      <label className="field tiny" {...tip(HELP.signature, setHelp)}>
        Sig
        <input
          className="num"
          type="number"
          min={1}
          max={12}
          value={project.timeSignature[0]}
          onChange={(event) => {
            const num = clamp(Math.round(Number(event.target.value)), 1, 12);
            dispatch({ type: 'edit', history: true, recipe: (draft) => { draft.timeSignature = [num, draft.timeSignature[1]]; } });
          }}
        />
        <select
          value={project.timeSignature[1]}
          onChange={(event) => {
            const den = Number(event.target.value);
            dispatch({ type: 'edit', history: true, recipe: (draft) => { draft.timeSignature = [draft.timeSignature[0], den]; } });
          }}
        >
          <option value={2}>2</option>
          <option value={4}>4</option>
          <option value={8}>8</option>
        </select>
      </label>
      <button className="btn" {...tip(HELP.undo, setHelp)} onClick={() => dispatch({ type: 'undo' })}>Undo</button>
      <button className="btn" {...tip(HELP.redo, setHelp)} onClick={() => dispatch({ type: 'redo' })}>Redo</button>
      <details className="menu">
        <summary {...tip(HELP.save, setHelp)}>File</summary>
        <button {...tip(HELP.save, setHelp)} onClick={onSave}>Save</button>
        <button {...tip(HELP.reload, setHelp)} onClick={onReload}>Reload</button>
        <button {...tip(HELP.exportMix, setHelp)} onClick={() => onExport('mix')}>Export mix WAV</button>
        <button {...tip(HELP.exportMp3, setHelp)} onClick={() => onExport('mp3')}>Download MP3</button>
        <button {...tip(HELP.exportStems, setHelp)} onClick={() => onExport('stems')}>Export stems</button>
        <button {...tip(HELP.exportMidi, setHelp)} onClick={() => onExport('midi')}>Export MIDI</button>
        <button {...tip(HELP.exportMeta, setHelp)} onClick={() => onExport('meta')}>Export project.meta.json</button>
      </details>
      <span className="status">{state.status}</span>
    </header>
  );

  function commitBpm() {
    if (!bpmBefore) return;
    dispatch({ type: 'commitSnapshot', before: bpmBefore });
    bpmBefore = null;
  }
}

let bpmBefore: Project | null = null;
