import { useMemo, useState } from 'react';
import type { Clip } from '../types';
import { noteName } from '../theory/music';
import { critiqueProject } from '../theory/critique';
import { suggestBass, suggestChords, suggestDrums, suggestMelody, suggestVariation } from '../theory/generate';
import { useStore } from '../state/store';
import { useEngine } from './engineContext';
import { HELP, tip, useSetHelp } from './help';

export function SidePanel({ onEnableMidi }: { onEnableMidi: () => void }) {
  const { state, dispatch } = useStore();
  const engine = useEngine();
  const setHelp = useSetHelp();
  const [tab, setTab] = useState<'theory' | 'critique' | 'samples'>('theory');
  const critiques = useMemo(() => critiqueProject(state.project), [state.project]);

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

  return (
    <aside className="side">
      <div className="tabs">
        <button className={tab === 'theory' ? 'tab on' : 'tab'} onClick={() => setTab('theory')} {...tip(HELP.chords, setHelp)}>Theory</button>
        <button className={tab === 'critique' ? 'tab on' : 'tab'} onClick={() => setTab('critique')} {...tip(HELP.critique, setHelp)}>Critique</button>
        <button className={tab === 'samples' ? 'tab on' : 'tab'} onClick={() => setTab('samples')} {...tip(HELP.sample, setHelp)}>Samples</button>
      </div>
      {tab === 'theory' ? (
        <div className="panel">
          <p className="hint" {...tip(HELP.accept, setHelp)}>Suggestions stay here until you accept them.</p>
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
          <ul className="critique">
            {critiques.map((item) => (
              <li key={item.id} className={item.severity}>{item.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {tab === 'samples' ? (
        <div className="panel samples">
          {state.project.samples.map((sample) => (
            <button
              key={sample.id}
              className="sample"
              draggable
              {...tip(HELP.sample, setHelp)}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-cbfl-sample', sample.id);
                event.dataTransfer.setData('text/plain', sample.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => engine?.previewSample(sample.id)}
            >
              {sample.name}
            </button>
          ))}
          <p className="hint">These one-shots are synthesized in the app. Drag one onto a drum row or the audio lane.</p>
        </div>
      ) : null}
    </aside>
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
