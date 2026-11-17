import { useMemo, useRef, useState } from 'react';
import type { Clip } from '../types';
import { FACTORY } from '../types';
import { FREE_PACK, FREE_PACK_GROUPS, type FreePackItem } from '../audio/freePack';
import { noteName } from '../theory/music';
import { critiqueProject } from '../theory/critique';
import { suggestBass, suggestChords, suggestDrums, suggestMelody, suggestVariation } from '../theory/generate';
import { useStore } from '../state/store';
import { useEngine } from './engineContext';
import { HELP, tip, useSetHelp } from './help';

const BUILTIN = new Set<string>([FACTORY.kick, FACTORY.snare, FACTORY.hat, FACTORY.clap]);

export function SidePanel({ onEnableMidi, onImportSample }: { onEnableMidi: () => void; onImportSample: (bytes: ArrayBuffer, name: string) => Promise<void> }) {
  const { state, dispatch } = useStore();
  const engine = useEngine();
  const setHelp = useSetHelp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'theory' | 'critique' | 'samples'>('theory');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const critiques = useMemo(() => critiqueProject(state.project), [state.project]);
  const builtin = state.project.samples.filter((sample) => BUILTIN.has(sample.id));
  const mine = state.project.samples.filter((sample) => !BUILTIN.has(sample.id));

  const suggest = (kind: 'chords' | 'melody' | 'bass' | 'drums' | 'variation') => {
    const seed = state.theorySeed;
    dispatch({ type: 'bumpSeed' });
    const project = state.project;
    let draft = null;
    if (kind === 'chords') draft = suggestChords(project, seed);
    if (kind === 'melody') draft = suggestMelody(project, seed);
    if (kind === 'bass') draft = suggestBass(project, seed);
    if (kind === 'drums') draft = suggestDrums(project, seed);
    if (kind === 'variation') {
      const clip = project.clips.find((item) => item.id === state.selectedClipId);
      draft = clip ? suggestVariation(project, clip, seed) : null;
    }
    if (!draft) {
      dispatch({ type: 'status', text: kind === 'variation' ? 'Select a MIDI or step clip to vary.' : 'No track is available for that tool.' });
      return;
    }
    dispatch({ type: 'suggest', suggestion: draft });
  };

  const addBytes = async (bytes: ArrayBuffer, name: string) => {
    setBusy(true);
    try {
      await onImportSample(bytes, name);
    } finally {
      setBusy(false);
    }
  };

  const addPack = async (item: FreePackItem) => {
    if (state.project.samples.some((sample) => sample.name === item.name)) return;
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error('missing');
      await addBytes(await res.arrayBuffer(), item.name);
    } catch {
      dispatch({ type: 'status', text: 'Could not add that free-pack sound.' });
    }
  };

  const previewPack = async (item: FreePackItem) => {
    if (!engine) return;
    try {
      await engine.resume();
      const res = await fetch(item.url);
      if (!res.ok) throw new Error('missing');
      const bytes = await res.arrayBuffer();
      const audio = await engine.ctx.decodeAudioData(bytes.slice(0));
      engine.previewBuffer(audio);
    } catch {
      dispatch({ type: 'status', text: 'Could not preview that sound.' });
    }
  };

  const addFromComputer = async (file: File) => {
    await addBytes(await file.arrayBuffer(), file.name);
  };

  const addFromLink = async () => {
    const raw = link.trim();
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      dispatch({ type: 'status', text: 'That link is not a full web address.' });
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      dispatch({ type: 'status', text: 'Use an http or https link to a wav, mp3, or ogg file.' });
      return;
    }
    const leaf = decodeURIComponent(url.pathname.split('/').pop() || 'Link');
    try {
      const res = await fetch(url.href);
      if (!res.ok) throw new Error('status');
      await addBytes(await res.arrayBuffer(), leaf);
      setLink('');
    } catch {
      dispatch({ type: 'status', text: 'This site does not allow the browser to fetch it. Use Add from computer.' });
    }
  };

  return (
    <aside className="side">
      <div className="tabs">
        <button className={tab === 'theory' ? 'tab on' : 'tab'} onClick={() => setTab('theory')} {...tip(HELP.ideas, setHelp)}>Ideas</button>
        <button className={tab === 'critique' ? 'tab on' : 'tab'} onClick={() => setTab('critique')} {...tip(HELP.critique, setHelp)}>Check</button>
        <button className={tab === 'samples' ? 'tab on' : 'tab'} onClick={() => setTab('samples')} {...tip(HELP.sounds, setHelp)}>Sounds</button>
      </div>
      {tab === 'theory' ? (
        <div className="panel">
          <p className="hint" {...tip(HELP.accept, setHelp)}>This is a draft. Accept is what writes it.</p>
          <div className="tool-row">
            <button className="btn" {...tip(HELP.chords, setHelp)} onClick={() => suggest('chords')}>Chords</button>
            <button className="btn" {...tip(HELP.melody, setHelp)} onClick={() => suggest('melody')}>Melody</button>
            <button className="btn" {...tip(HELP.bass, setHelp)} onClick={() => suggest('bass')}>Bass</button>
            <button className="btn" {...tip(HELP.drums, setHelp)} onClick={() => suggest('drums')}>Drums</button>
            <button className="btn" {...tip(HELP.vary, setHelp)} onClick={() => suggest('variation')}>Vary</button>
          </div>
          {state.suggestion ? (
            <article className="suggestion">
              <header>
                <strong>{state.suggestion.title}</strong>
                <span>seed {state.suggestion.seed}</span>
              </header>
              <p>{state.suggestion.detail}</p>
              <Preview clip={state.suggestion.clip} />
              <div className="tool-row">
                <button className="btn play" {...tip(HELP.accept, setHelp)} onClick={() => dispatch({ type: 'accept' })}>Accept</button>
                <button className="btn" {...tip(HELP.reject, setHelp)} onClick={() => dispatch({ type: 'reject' })}>Reject</button>
              </div>
            </article>
          ) : (
            <p className="hint">No suggestion yet. Seed {state.theorySeed}.</p>
          )}
          <button className="btn" {...tip(HELP.midiIn, setHelp)} onClick={onEnableMidi}>Enable MIDI input</button>
          <p className="hint" {...tip(HELP.keys, setHelp)}>Keys: Z S X D C V G B H N J M play a chromatic row. On drums, Z X C V are kick, snare, hat, clap.</p>
        </div>
      ) : null}
      {tab === 'critique' ? (
        <div className="panel" {...tip(HELP.critique, setHelp)}>
          <p className="hint">These lines are notes, not a grade. Gold means outside the key, or the kick and 808 hit together. Blue means an empty bar, or nothing to flag.</p>
          <ul className="critique">
            {critiques.map((item) => (
              <li key={item.id} className={item.severity}>{item.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {tab === 'samples' ? (
        <div className="panel sounds">
          <p className="hint">Drag a sound onto a drum row, the Audio lane, or Vocals.</p>
          <section>
            <h3>Built-in</h3>
            <div className="sample-grid">
              {builtin.map((sample) => (
                <SampleButton key={sample.id} id={sample.id} name={sample.name} />
              ))}
            </div>
          </section>
          <section>
            <h3>My sounds</h3>
            {mine.length === 0 ? <p className="hint">Nothing added yet. Add one from the free pack or from your computer.</p> : null}
            <div className="sample-grid">
              {mine.map((sample) => (
                <SampleButton key={sample.id} id={sample.id} name={sample.name} />
              ))}
            </div>
          </section>
          <section>
            <h3>Free pack</h3>
            {FREE_PACK_GROUPS.map((group) => (
              <div key={group} className="pack-group">
                <h4>{group}</h4>
                {FREE_PACK.filter((item) => item.group === group).map((item) => {
                  const added = state.project.samples.some((sample) => sample.name === item.name);
                  return (
                    <div key={item.id} className="pack-row">
                      <button className="btn" type="button" disabled={busy} {...tip(HELP.sample, setHelp)} onClick={() => void previewPack(item)}>Play</button>
                      <span>{item.name}</span>
                      <button className="btn" type="button" disabled={busy || added} onClick={() => void addPack(item)}>{added ? 'Added' : 'Add'}</button>
                    </div>
                  );
                })}
              </div>
            ))}
            <p className="hint">These one-shots are CC0. You can copy and use them. A link only works when that site lets the browser fetch the file.</p>
          </section>
          <input
            ref={fileRef}
            className="file-input"
            type="file"
            accept="audio/wav,audio/wave,audio/mpeg,audio/ogg,.wav,.mp3,.ogg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void addFromComputer(file);
            }}
          />
          <button className="btn" type="button" disabled={busy} {...tip(HELP.addSample, setHelp)} onClick={() => fileRef.current?.click()}>Add from computer</button>
          <form
            className="link-row"
            onSubmit={(event) => {
              event.preventDefault();
              void addFromLink();
            }}
          >
            <input
              value={link}
              placeholder="https://…/sound.wav"
              {...tip(HELP.addLink, setHelp)}
              onChange={(event) => setLink(event.target.value)}
            />
            <button className="btn" type="submit" disabled={busy || link.trim() === ''} {...tip(HELP.addLink, setHelp)}>Add from link</button>
          </form>
        </div>
      ) : null}
    </aside>
  );
}

function SampleButton({ id, name }: { id: string; name: string }) {
  const engine = useEngine();
  const setHelp = useSetHelp();
  return (
    <button
      className="sample"
      draggable
      {...tip(HELP.sample, setHelp)}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-cbfl-sample', id);
        event.dataTransfer.setData('text/plain', id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => engine?.previewSample(id)}
    >
      {name}
    </button>
  );
}

function Preview({ clip }: { clip: Clip }) {
  if (clip.kind === 'step') {
    return (
      <div className="preview-steps">
        {clip.rows.map((row, index) => (
          <div key={index} className="preview-row">
            {row.cells.map((cell, step) => (
              <i key={step} className={cell.on ? 'on' : ''} />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (clip.kind === 'midi') {
    const names = clip.notes.slice(0, 12).map((note) => noteName(note.pitch));
    return <p className="preview-notes">{names.join(' · ') || 'Empty clip'}{clip.notes.length > 12 ? ' …' : ''}</p>;
  }
  return <p className="preview-notes">{clip.sampleId}</p>;
}
