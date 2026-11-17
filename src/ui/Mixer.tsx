import { useEffect, useRef, useState } from 'react';
import type { EffectSlot, Project } from '../types';
import { clamp } from '../util';
import { defaultEffect, useStore } from '../state/store';
import { useEngine } from './engineContext';
import { HELP, tip, useSetHelp } from './help';
import { trackColor } from './theme';

export function Mixer() {
  const { state, dispatch } = useStore();
  const engine = useEngine();
  const setHelp = useSetHelp();
  const [master, setMaster] = useState(0.85);
  const [level, setLevel] = useState(0);
  const before = useRef<Project | null>(null);
  const track = state.project.tracks.find((item) => item.id === state.selectedTrackId) ?? state.project.tracks[0];

  useEffect(() => {
    engine?.setMaster(master);
  }, [engine, master]);

  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    const loop = () => {
      const peak = engine?.getLevel() ?? 0;
      smooth = Math.max(peak, smooth * 0.8);
      setLevel(smooth);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  const begin = () => {
    before.current = structuredClone(state.project);
  };
  const end = () => {
    if (before.current) dispatch({ type: 'commitSnapshot', before: before.current });
    before.current = null;
  };

  return (
    <section className="mixer">
      <div className="strips">
        {state.project.tracks.map((item, index) => (
          <div
            key={item.id}
            className={item.id === track?.id ? 'strip on' : 'strip'}
            onClick={() => dispatch({ type: 'selectTrack', trackId: item.id })}
          >
            <div className="strip-name" style={{ color: trackColor(index) }} {...tip(HELP.track, setHelp)}>{item.name}</div>
            <input
              className="pan"
              type="range"
              min={-100}
              max={100}
              value={Math.round(item.pan * 100)}
              {...tip(HELP.pan, setHelp)}
              onPointerDown={begin}
              onChange={(event) => patch(item.id, { pan: Number(event.target.value) / 100 })}
              onPointerUp={end}
            />
            <input
              className="fader"
              type="range"
              min={0}
              max={100}
              value={Math.round(item.volume * 100)}
              {...tip(HELP.volume, setHelp)}
              onPointerDown={begin}
              onChange={(event) => patch(item.id, { volume: Number(event.target.value) / 100 })}
              onPointerUp={end}
            />
            <div className="ms">
              <button className={item.mute ? 'mini on' : 'mini'} {...tip(HELP.mute, setHelp)} onClick={(event) => { event.stopPropagation(); toggle(item.id, 'mute'); }}>M</button>
              <button className={item.solo ? 'mini solo' : 'mini'} {...tip(HELP.solo, setHelp)} onClick={(event) => { event.stopPropagation(); toggle(item.id, 'solo'); }}>S</button>
            </div>
            <label {...tip(HELP.send1, setHelp)}>R
              <input type="range" min={0} max={100} value={Math.round(item.sends[0] * 100)} onPointerDown={begin} onPointerUp={end} onChange={(event) => patchSend(item.id, 0, Number(event.target.value) / 100)} />
            </label>
            <label {...tip(HELP.send2, setHelp)}>D
              <input type="range" min={0} max={100} value={Math.round(item.sends[1] * 100)} onPointerDown={begin} onPointerUp={end} onChange={(event) => patchSend(item.id, 1, Number(event.target.value) / 100)} />
            </label>
          </div>
        ))}
        <div className="strip master">
          <div className="strip-name">Master</div>
          <div className="meter tall" {...tip(HELP.meter, setHelp)}><span style={{ height: `${Math.min(100, level * 140)}%` }} /></div>
          <input
            className="fader"
            type="range"
            min={0}
            max={100}
            value={Math.round(master * 100)}
            {...tip(HELP.master, setHelp)}
            onChange={(event) => setMaster(Number(event.target.value) / 100)}
          />
        </div>
      </div>
      {track ? (
        <div className="fx">
          <header>{track.name} inserts</header>
          {track.effects.map((slot, index) => (
            <EffectEditor
              key={`${slot.type}-${index}`}
              slot={slot}
              tracks={state.project.tracks.map((item) => ({ id: item.id, name: item.name }))}
              onBegin={begin}
              onEnd={end}
              onChange={(next) => {
                dispatch({
                  type: 'edit',
                  history: false,
                  recipe: (draft) => {
                    const item = draft.tracks.find((entry) => entry.id === track.id);
                    if (item) item.effects[index] = next;
                  },
                });
              }}
              onRemove={() => {
                dispatch({
                  type: 'edit',
                  history: true,
                  recipe: (draft) => {
                    const item = draft.tracks.find((entry) => entry.id === track.id);
                    if (item) item.effects.splice(index, 1);
                  },
                });
              }}
            />
          ))}
          <label {...tip(HELP.addFx, setHelp)}>
            Add
            <select
              value=""
              onChange={(event) => {
                const type = event.target.value as EffectSlot['type'];
                if (!type) return;
                const source = state.project.tracks.find((item) => item.kind === 'drum')?.id ?? track.id;
                dispatch({
                  type: 'edit',
                  history: true,
                  recipe: (draft) => {
                    const item = draft.tracks.find((entry) => entry.id === track.id);
                    if (item) item.effects.push(defaultEffect(type, source));
                  },
                });
                event.target.value = '';
              }}
            >
              <option value="">effect…</option>
              <option value="eq">EQ</option>
              <option value="compressor">Compressor</option>
              <option value="reverb">Reverb</option>
              <option value="delay">Delay</option>
              <option value="saturation">Saturation</option>
              <option value="sidechain">Sidechain duck</option>
            </select>
          </label>
        </div>
      ) : null}
    </section>
  );

  function patch(id: string, values: { volume?: number; pan?: number }) {
    dispatch({
      type: 'edit',
      history: false,
      recipe: (draft) => {
        const item = draft.tracks.find((entry) => entry.id === id);
        if (!item) return;
        if (values.volume !== undefined) item.volume = clamp(values.volume, 0, 1.25);
        if (values.pan !== undefined) item.pan = clamp(values.pan, -1, 1);
      },
    });
  }

  function patchSend(id: string, index: 0 | 1, value: number) {
    dispatch({
      type: 'edit',
      history: false,
      recipe: (draft) => {
        const item = draft.tracks.find((entry) => entry.id === id);
        if (!item) return;
        const sends: [number, number] = [item.sends[0], item.sends[1]];
        sends[index] = clamp(value, 0, 1);
        item.sends = sends;
      },
    });
  }

  function toggle(id: string, field: 'mute' | 'solo') {
    dispatch({
      type: 'edit',
      history: true,
      recipe: (draft) => {
        const item = draft.tracks.find((entry) => entry.id === id);
        if (item) item[field] = !item[field];
      },
    });
  }
}

function EffectEditor({
  slot,
  tracks,
  onChange,
  onRemove,
  onBegin,
  onEnd,
}: {
  slot: EffectSlot;
  tracks: { id: string; name: string }[];
  onChange: (slot: EffectSlot) => void;
  onRemove: () => void;
  onBegin: () => void;
  onEnd: () => void;
}) {
  const setHelp = useSetHelp();
  return (
    <div className="fx-slot">
      <strong>{slot.type}</strong>
      {slot.type === 'eq' ? (
        <>
          <Slider help={HELP.eq} label="Low" min={-12} max={12} value={slot.low} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(low) => onChange({ ...slot, low })} />
          <Slider help={HELP.eq} label="Mid" min={-12} max={12} value={slot.mid} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(mid) => onChange({ ...slot, mid })} />
          <Slider help={HELP.eq} label="High" min={-12} max={12} value={slot.high} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(high) => onChange({ ...slot, high })} />
        </>
      ) : null}
      {slot.type === 'compressor' ? (
        <>
          <Slider help={HELP.comp} label="Thr" min={-40} max={0} value={slot.threshold} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(threshold) => onChange({ ...slot, threshold })} />
          <Slider help={HELP.comp} label="Ratio" min={1} max={12} value={slot.ratio} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(ratio) => onChange({ ...slot, ratio })} />
        </>
      ) : null}
      {slot.type === 'reverb' ? (
        <Slider help={HELP.reverb} label="Mix" min={0} max={100} value={slot.mix * 100} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(mix) => onChange({ ...slot, mix: mix / 100 })} />
      ) : null}
      {slot.type === 'delay' ? (
        <>
          <Slider help={HELP.delay} label="Time" min={1} max={100} value={slot.time * 100} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(time) => onChange({ ...slot, time: time / 100 })} />
          <Slider help={HELP.delay} label="Fb" min={0} max={85} value={slot.feedback * 100} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(feedback) => onChange({ ...slot, feedback: feedback / 100 })} />
          <Slider help={HELP.delay} label="Mix" min={0} max={100} value={slot.mix * 100} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(mix) => onChange({ ...slot, mix: mix / 100 })} />
        </>
      ) : null}
      {slot.type === 'saturation' ? (
        <Slider help={HELP.drive} label="Drive" min={0} max={100} value={slot.drive * 100} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(drive) => onChange({ ...slot, drive: drive / 100 })} />
      ) : null}
      {slot.type === 'sidechain' ? (
        <>
          <label {...tip(HELP.sidechain, setHelp)}>
            From
            <select value={slot.sourceTrackId} onChange={(event) => onChange({ ...slot, sourceTrackId: event.target.value })}>
              {tracks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <Slider help={HELP.sidechain} label="Duck" min={0} max={100} value={slot.amount * 100} setHelp={setHelp} onBegin={onBegin} onEnd={onEnd} onChange={(amount) => onChange({ ...slot, amount: amount / 100 })} />
        </>
      ) : null}
      <button className="mini" {...tip(HELP.removeFx, setHelp)} onClick={onRemove}>×</button>
    </div>
  );
}

function Slider({
  label,
  help,
  min,
  max,
  value,
  onChange,
  onBegin,
  onEnd,
  setHelp,
}: {
  label: string;
  help: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  onBegin: () => void;
  onEnd: () => void;
  setHelp: (text: string) => void;
}) {
  return (
    <label {...tip(help, setHelp)}>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        value={Math.round(value)}
        onPointerDown={onBegin}
        onPointerUp={onEnd}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
