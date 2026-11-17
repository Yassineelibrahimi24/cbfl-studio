import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import type { EffectSlot, MidiNote, Project, StepCell } from '../types';
import { barTicks } from '../audio/timeline';
import type { SuggestionDraft } from '../theory/generate';
import { createDefaultProject, ensureVocals, withFriendlyNames } from './defaultProject';
import { clamp, clampBpm, sameJson, uid } from '../util';

export type SnapMode = 'bar' | 'beat' | '16th';

export type Transport = {
  playing: boolean;
  recording: boolean;
  loopOn: boolean;
  loopStartTick: number;
  loopEndTick: number;
  metronome: boolean;
  snap: SnapMode;
};

export type Suggestion = SuggestionDraft;

export type State = {
  project: Project;
  past: Project[];
  future: Project[];
  transport: Transport;
  selectedTrackId: string;
  selectedClipId: string | null;
  selectedNoteIndex: number | null;
  selectedCell: { row: number; step: number } | null;
  suggestion: Suggestion | null;
  theorySeed: number;
  status: string;
  demo: boolean;
};

const UNDO_CAP = 40;

export type Action =
  | { type: 'status'; text: string }
  | { type: 'setTransport'; patch: Partial<Transport> }
  | { type: 'selectTrack'; trackId: string }
  | { type: 'selectClip'; clipId: string | null }
  | { type: 'selectNote'; index: number | null }
  | { type: 'selectCell'; cell: { row: number; step: number } | null }
  | { type: 'edit'; recipe: (project: Project) => void; history: boolean }
  | { type: 'commitSnapshot'; before: Project }
  | { type: 'pushHistory' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; project: Project }
  | { type: 'newSong' }
  | { type: 'suggest'; suggestion: Suggestion }
  | { type: 'reject' }
  | { type: 'accept' }
  | { type: 'toggleStep'; clipId: string; row: number; step: number }
  | { type: 'setCell'; clipId: string; row: number; step: number; patch: Partial<StepCell> }
  | { type: 'setNotes'; clipId: string; notes: MidiNote[]; history: boolean }
  | { type: 'deleteSelected' }
  | { type: 'bumpSeed' }
  | { type: 'recordNote'; clipId: string; trackId: string; startTick: number; note: MidiNote }
  | { type: 'recordStep'; clipId: string; trackId: string; startTick: number; row: number; step: number; sampleIds: string[] };

function finish(state: State): State {
  let selectedTrackId = state.selectedTrackId;
  if (!state.project.tracks.some((track) => track.id === selectedTrackId)) {
    selectedTrackId = state.project.tracks[0]?.id ?? '';
  }
  let selectedClipId = state.selectedClipId;
  if (selectedClipId && !state.project.clips.some((clip) => clip.id === selectedClipId)) selectedClipId = null;
  if (selectedClipId) {
    const clip = state.project.clips.find((item) => item.id === selectedClipId);
    if (clip && clip.trackId !== selectedTrackId) {
      /* keep the clip selection and follow its track when the clip was the thing selected */
    }
  }
  let selectedNoteIndex = state.selectedNoteIndex;
  const clip = state.project.clips.find((item) => item.id === selectedClipId);
  if (!clip || clip.kind !== 'midi' || selectedNoteIndex === null || !clip.notes[selectedNoteIndex]) {
    selectedNoteIndex = null;
  }
  const selectedCell = state.selectedCell;
  if (selectedCell && (!clip || clip.kind !== 'step' || !clip.rows[selectedCell.row]?.cells[selectedCell.step])) {
    return { ...state, selectedTrackId, selectedClipId, selectedNoteIndex, selectedCell: null };
  }
  return { ...state, selectedTrackId, selectedClipId, selectedNoteIndex };
}

function edit(state: State, recipe: (project: Project) => void, history: boolean): State {
  const project = structuredClone(state.project);
  recipe(project);
  project.bpm = clampBpm(project.bpm);
  if (!history) return finish({ ...state, project, demo: false });
  const past = [...state.past, structuredClone(state.project)].slice(-UNDO_CAP);
  return finish({ ...state, project, past, future: [], demo: false });
}

function applySuggestion(project: Project, suggestion: Suggestion): void {
  const incoming = suggestion.clip;
  if (suggestion.replaceClipId) {
    const index = project.clips.findIndex((clip) => clip.id === suggestion.replaceClipId);
    const prev = project.clips[index];
    if (prev && prev.kind === 'midi' && incoming.kind === 'midi') {
      project.clips[index] = { ...prev, notes: incoming.notes };
      return;
    }
    if (prev && prev.kind === 'step' && incoming.kind === 'step') {
      project.clips[index] = { ...prev, steps: incoming.steps, swing: incoming.swing, rows: incoming.rows };
      return;
    }
    if (prev && prev.kind === 'audio' && incoming.kind === 'audio') {
      project.clips[index] = { ...prev, sampleId: incoming.sampleId, durationTicks: incoming.durationTicks };
      return;
    }
  }
  const clip = { ...incoming, id: uid('clip'), trackId: suggestion.targetTrackId };
  project.clips.push(clip);
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.text };
    case 'setTransport':
      return { ...state, transport: { ...state.transport, ...action.patch } };
    case 'selectTrack': {
      const clipOnTrack = state.project.clips.find((clip) => clip.id === state.selectedClipId)?.trackId === action.trackId;
      const nextClip = clipOnTrack
        ? state.selectedClipId
        : state.project.clips.find((clip) => clip.trackId === action.trackId)?.id ?? null;
      return finish({
        ...state,
        selectedTrackId: action.trackId,
        selectedClipId: nextClip,
        selectedNoteIndex: null,
        selectedCell: null,
      });
    }
    case 'selectClip': {
      const clip = state.project.clips.find((item) => item.id === action.clipId);
      return finish({
        ...state,
        selectedClipId: action.clipId,
        selectedTrackId: clip?.trackId ?? state.selectedTrackId,
        selectedNoteIndex: null,
      });
    }
    case 'selectNote':
      return { ...state, selectedNoteIndex: action.index };
    case 'selectCell':
      return { ...state, selectedCell: action.cell };
    case 'edit':
      return edit(state, action.recipe, action.history);
    case 'commitSnapshot': {
      if (sameJson(action.before, state.project)) return state;
      const past = [...state.past, action.before].slice(-UNDO_CAP);
      return { ...state, past, future: [] };
    }
    case 'pushHistory': {
      const top = state.past[state.past.length - 1];
      if (top && sameJson(top, state.project)) return state;
      return { ...state, past: [...state.past, structuredClone(state.project)].slice(-UNDO_CAP), future: [] };
    }
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return finish({
        ...state,
        project: prev,
        past: state.past.slice(0, -1),
        future: [...state.future, state.project].slice(-UNDO_CAP),
        suggestion: null,
      });
    }
    case 'redo': {
      const next = state.future[state.future.length - 1];
      if (!next) return state;
      return finish({
        ...state,
        project: next,
        future: state.future.slice(0, -1),
        past: [...state.past, state.project].slice(-UNDO_CAP),
        suggestion: null,
      });
    }
    case 'load': {
      const project = withFriendlyNames(ensureVocals({ ...action.project, bpm: clampBpm(action.project.bpm) }));
      return finish({
        ...state,
        project,
        past: [],
        future: [],
        suggestion: null,
        demo: sameJson(project, createDefaultProject()),
        status: 'Reloaded the project from this browser.',
      });
    }
    case 'newSong': {
      const project = createDefaultProject();
      return finish({
        ...state,
        project,
        past: [],
        future: [],
        suggestion: null,
        demo: true,
        selectedTrackId: project.tracks[0]?.id ?? '',
        selectedClipId: project.clips[0]?.id ?? null,
        selectedNoteIndex: null,
        selectedCell: null,
        transport: {
          ...state.transport,
          playing: false,
          recording: false,
          loopOn: true,
          loopStartTick: 0,
          loopEndTick: barTicks(project) * 4,
        },
        status: 'New song. This browser keeps one song.',
      });
    }
    case 'suggest':
      return { ...state, suggestion: action.suggestion, status: 'Suggestion ready. Accept writes it. Reject drops it.' };
    case 'reject':
      return { ...state, suggestion: null, status: 'Suggestion dropped.' };
    case 'accept': {
      if (!state.suggestion) return state;
      const suggestion = state.suggestion;
      const next = edit(state, (project) => applySuggestion(project, suggestion), true);
      return { ...next, suggestion: null, status: 'Suggestion accepted.' };
    }
    case 'toggleStep': {
      const next = edit(state, (project) => {
        const clip = project.clips.find((item) => item.id === action.clipId);
        if (!clip || clip.kind !== 'step') return;
        const cell = clip.rows[action.row]?.cells[action.step];
        if (!cell) return;
        cell.on = !cell.on;
      }, true);
      return { ...next, selectedCell: { row: action.row, step: action.step }, selectedClipId: action.clipId };
    }
    case 'setCell':
      return edit(state, (project) => {
        const clip = project.clips.find((item) => item.id === action.clipId);
        if (!clip || clip.kind !== 'step') return;
        const cell = clip.rows[action.row]?.cells[action.step];
        if (!cell) return;
        if (action.patch.on !== undefined) cell.on = action.patch.on;
        if (action.patch.velocity !== undefined) cell.velocity = clamp(action.patch.velocity, 0.05, 1);
        if (action.patch.probability !== undefined) cell.probability = clamp(action.patch.probability, 0, 1);
      }, false);
    case 'setNotes':
      return edit(state, (project) => {
        const clip = project.clips.find((item) => item.id === action.clipId);
        if (!clip || clip.kind !== 'midi') return;
        clip.notes = action.notes;
      }, action.history);
    case 'deleteSelected': {
      const clip = state.project.clips.find((item) => item.id === state.selectedClipId);
      if (clip?.kind === 'midi' && state.selectedNoteIndex !== null) {
        const index = state.selectedNoteIndex;
        return edit(state, (project) => {
          const target = project.clips.find((item) => item.id === clip.id);
          if (!target || target.kind !== 'midi') return;
          target.notes = target.notes.filter((_, noteIndex) => noteIndex !== index);
        }, true);
      }
      if (clip?.kind === 'step' && state.selectedCell) {
        const cell = state.selectedCell;
        return edit(state, (project) => {
          const target = project.clips.find((item) => item.id === clip.id);
          if (!target || target.kind !== 'step') return;
          const step = target.rows[cell.row]?.cells[cell.step];
          if (step) step.on = false;
        }, true);
      }
      return state;
    }
    case 'bumpSeed':
      return { ...state, theorySeed: state.theorySeed + 1 };
    case 'recordNote':
      return edit(state, (project) => {
        let clip = project.clips.find((item) => item.id === action.clipId);
        if (!clip) {
          clip = { id: action.clipId, trackId: action.trackId, startTick: action.startTick, kind: 'midi', notes: [] };
          project.clips.push(clip);
        }
        if (clip.kind !== 'midi') return;
        clip.notes.push(action.note);
      }, false);
    case 'recordStep':
      return edit(state, (project) => {
        let clip = project.clips.find((item) => item.id === action.clipId);
        if (!clip) {
          clip = {
            id: action.clipId,
            trackId: action.trackId,
            startTick: action.startTick,
            kind: 'step',
            steps: 16,
            swing: 0,
            rows: action.sampleIds.map((sampleId) => ({
              sampleId,
              cells: Array.from({ length: 16 }, () => ({ on: false, velocity: 0.85, probability: 1 })),
            })),
          };
          project.clips.push(clip);
        }
        if (clip.kind !== 'step') return;
        const cell = clip.rows[action.row]?.cells[action.step];
        if (cell) {
          cell.on = true;
          cell.velocity = 0.9;
        }
      }, false);
    default:
      return state;
  }
}

function initialState(): State {
  const project = createDefaultProject();
  return {
    project,
    past: [],
    future: [],
    transport: {
      playing: false,
      recording: false,
      loopOn: true,
      loopStartTick: 0,
      loopEndTick: barTicks(project) * 4,
      metronome: false,
      snap: '16th',
    },
    selectedTrackId: project.tracks[0]?.id ?? '',
    selectedClipId: project.clips[0]?.id ?? null,
    selectedNoteIndex: null,
    selectedCell: null,
    suggestion: null,
    theorySeed: 1,
    status: 'Demo beat. Play it, then change any lane.',
    demo: true,
  };
}

const Ctx = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): { state: State; dispatch: Dispatch<Action> } {
  const value = useContext(Ctx);
  if (!value) throw new Error('Store missing');
  return value;
}

export function defaultEffect(type: EffectSlot['type'], sourceTrackId: string): EffectSlot {
  switch (type) {
    case 'eq':
      return { type: 'eq', low: 0, mid: 0, high: 0 };
    case 'compressor':
      return { type: 'compressor', threshold: -18, ratio: 2 };
    case 'reverb':
      return { type: 'reverb', mix: 0.25, impulseId: 'impulse' };
    case 'delay':
      return { type: 'delay', time: 0.3, feedback: 0.3, mix: 0.2 };
    case 'saturation':
      return { type: 'saturation', drive: 0.25 };
    case 'sidechain':
      return { type: 'sidechain', sourceTrackId, amount: 0.65 };
  }
}
