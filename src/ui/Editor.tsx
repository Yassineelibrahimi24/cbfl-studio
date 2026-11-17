import type { Project } from '../types';
import { FACTORY, TRACK } from '../types';
import { barTicks, clipEndTick } from '../audio/timeline';
import { uid } from '../util';
import { useStore } from '../state/store';
import { HELP, tip, useSetHelp } from './help';
import { PianoRoll } from './PianoRoll';
import { StepGrid } from './StepGrid';

export function Editor() {
  const { state, dispatch } = useStore();
  const setHelp = useSetHelp();
  const track = state.project.tracks.find((item) => item.id === state.selectedTrackId);
  const clip = state.project.clips.find((item) => item.id === state.selectedClipId);

  const addClip = () => {
    if (!track) return;
    const id = uid('clip');
    const onTrack = state.project.clips.filter((clip) => clip.trackId === track.id);
    const start = onTrack.reduce((max, clip) => Math.max(max, clipEndTick(clip, state.project)), 0);
    const overlaps = onTrack.some((clip) => clip.startTick < start + 1 && clipEndTick(clip, state.project) > start);
    dispatch({
      type: 'edit',
      history: true,
      recipe: (draft: Project) => {
        if (track.kind === 'drum') {
          draft.clips.push({
            id,
            trackId: track.id,
            startTick: start,
            kind: 'step',
            steps: 16,
            swing: 0,
            rows: [FACTORY.kick, FACTORY.snare, FACTORY.hat, FACTORY.clap].map((sampleId) => ({
              sampleId,
              cells: Array.from({ length: 16 }, () => ({ on: false, velocity: 0.8, probability: 1 })),
            })),
          });
        } else if (track.kind === 'audio') {
          draft.clips.push({
            id,
            trackId: track.id,
            startTick: start,
            kind: 'audio',
            sampleId: FACTORY.kick,
            durationTicks: barTicks(draft),
          });
        } else {
          draft.clips.push({ id, trackId: track.id, startTick: start, kind: 'midi', notes: [] });
        }
      },
    });
    dispatch({ type: 'selectClip', clipId: id });
    if (overlaps) dispatch({ type: 'status', text: 'This clip overlaps another clip on this track.' });
  };

  return (
    <section className="editor">
      <div className="toolbar">
        <strong>{track?.name ?? 'Editor'}</strong>
        <button className="btn" {...tip(HELP.newClip, setHelp)} onClick={addClip}>New clip</button>
        <button
          className="btn"
          {...tip(HELP.deleteClip, setHelp)}
          onClick={() => {
            if (!state.selectedClipId) return;
            const id = state.selectedClipId;
            dispatch({
              type: 'edit',
              history: true,
              recipe: (draft) => {
                draft.clips = draft.clips.filter((item) => item.id !== id);
              },
            });
          }}
        >Delete clip</button>
        {track?.id === TRACK.vocals ? <span className="hint" {...tip(HELP.audioLane, setHelp)}>This lane plays on top of the beat.</span> : null}
        {track?.kind === 'audio' && track.id !== TRACK.vocals ? <span className="hint" {...tip(HELP.audioLane, setHelp)}>Record or drop a one-shot onto this lane.</span> : null}
        {clip?.kind === 'audio' ? (
          <span className="hint">
            {state.project.samples.find((sample) => sample.id === clip.sampleId)?.name ?? clip.sampleId}
          </span>
        ) : null}
      </div>
      {track?.kind === 'drum' ? <StepGrid /> : null}
      {track && track.kind !== 'drum' && track.kind !== 'audio' ? <PianoRoll /> : null}
      {track?.kind === 'audio' ? (
        <div className="editor-empty" {...tip(HELP.audioLane, setHelp)}>
          {clip?.kind === 'audio'
            ? `This clip uses ${state.project.samples.find((sample) => sample.id === clip.sampleId)?.name ?? 'a sample'}. Drop another sound on it to replace it, or record a new take.`
            : track.id === TRACK.vocals
              ? 'Record a vocal while the beat plays, or add a sound from Sounds.'
              : 'No audio clip yet. Press Record to capture the microphone, or drop a one-shot on the audio lane.'}
        </div>
      ) : null}
    </section>
  );
}
