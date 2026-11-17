import { useEffect, useRef, useState } from 'react';
import { planBeat, writeBeat, type BeatPlan, type DrumVoices, type MoodId } from './theory/compose';
import { FREE_PACK } from './audio/freePack';
import { Beginner } from './ui/Beginner';
import { AudioEngine, type EngineTransport } from './audio/engine';
import { bufferToMp3, bufferToWav, renderProject } from './audio/exportAudio';
import { encodeMidi, metaSidecar } from './audio/midiFile';
import { audioBufferToWav } from './audio/wav';
import { barTicks, gridTicks, secondsPerTick, snapTicks, stepTicks } from './audio/timeline';
import { usePerformance } from './input/usePerformance';
import { loadBundle, saveBlobs, saveProjectRecord } from './storage/idb';
import { StoreProvider, useStore, type State } from './state/store';
import { FACTORY, TRACK } from './types';
import { clampBpm, downloadBytes, slug, uid } from './util';
import { Editor } from './ui/Editor';
import { EngineContext } from './ui/engineContext';
import { HelpBar, HelpProvider } from './ui/help';
import { Mixer } from './ui/Mixer';
import { Playlist } from './ui/Playlist';
import { SidePanel } from './ui/SidePanel';
import { TransportBar } from './ui/TransportBar';

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function transportOf(state: State): EngineTransport {
  return {
    loopOn: state.transport.loopOn,
    loopStart: state.transport.loopStartTick,
    loopEnd: state.transport.loopEndTick,
    metronome: state.transport.metronome,
  };
}

function Shell() {
  const { state, dispatch } = useStore();
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const engineRef = useRef<AudioEngine | null>(null);
  const blobsDirty = useRef(true);
  const recordTick = useRef(0);
  const recordTrackId = useRef<string | null>(null);
  const busy = useRef(false);
  const beatRef = useRef<BeatPlan | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [mood, setMood] = useState<MoodId>('chill');
  const [made, setMade] = useState(false);
  const [voice, setVoice] = useState(false);

  useEffect(() => {
    const next = new AudioEngine();
    engineRef.current = next;
    setEngine(next);
    let cancel = false;
    void (async () => {
      try {
        const saved = await loadBundle();
        if (cancel) return;
        if (saved) {
          dispatch({ type: 'load', project: { ...saved.project, bpm: clampBpm(saved.project.bpm) } });
          await next.installBlobs(saved.blobs);
        }
      } catch {
        if (!cancel) dispatch({ type: 'status', text: 'Storage is unavailable. This session stays in memory.' });
      } finally {
        next.ensureFactory();
        if (!cancel) setReady(true);
      }
    })();
    return () => {
      cancel = true;
      next.dispose();
    };
  }, [dispatch]);

  useEffect(() => {
    const live = engineRef.current;
    if (!live) return;
    live.sync(state.project, transportOf(state));
  }, [engine, state.project, state.transport.loopOn, state.transport.loopStartTick, state.transport.loopEndTick, state.transport.metronome]);

  useEffect(() => {
    if (!ready || !engine) return;
    const timer = window.setTimeout(() => {
      void persist(stateRef.current, engine, blobsDirty);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [ready, engine, state.project]);

  const play = () => {
    const live = engineRef.current;
    const current = stateRef.current;
    if (!live || live.isPlaying()) return;
    live.play(current.project, transportOf(current), live.getPositionTick());
    dispatch({ type: 'setTransport', patch: { playing: true } });
  };

  const stop = () => {
    const live = engineRef.current;
    if (!live) return;
    const pcm = live.captureMic();
    if (live.isPlaying()) {
      live.stop();
      dispatch({ type: 'setTransport', patch: { playing: false, recording: false } });
    } else {
      live.seek(stateRef.current.transport.loopStartTick);
    }
    if (!pcm || pcm.pcm.length < 256) return;
    const id = uid('rec');
    const buffer = live.bufferFromPcm(pcm.pcm, pcm.sampleRate);
    live.setBuffer(id, buffer);
    const project = stateRef.current.project;
    const ticks = Math.max(stepTicks(project), Math.round(pcm.pcm.length / pcm.sampleRate / secondsPerTick(project, project.bpm)));
    const recorded = project.tracks.find((item) => item.id === recordTrackId.current);
    const vocal = recorded?.id === TRACK.vocals;
    const audioTrack = recorded?.kind === 'audio'
      ? recorded.id
      : project.tracks.find((item) => item.kind === 'audio' && item.id !== TRACK.vocals)?.id ?? stateRef.current.selectedTrackId;
    const prefix = vocal ? 'Vocal' : 'Take';
    dispatch({
      type: 'edit',
      history: true,
      recipe: (draft) => {
        const count = draft.samples.filter((sample) => sample.name.startsWith(prefix)).length + 1;
        draft.samples.push({ id, name: `${prefix} ${count}` });
        draft.clips.push({
          id: uid('clip'),
          trackId: audioTrack,
          startTick: Math.max(0, Math.round(recordTick.current)),
          kind: 'audio',
          sampleId: id,
          durationTicks: ticks,
        });
      },
    });
    blobsDirty.current = true;
    dispatch({
      type: 'status',
      text: vocal ? 'Recorded a vocal on the Vocals lane.' : 'Recorded a clip onto the audio track.',
    });
  };

  const toggle = () => {
    if (engineRef.current?.isPlaying()) stop();
    else play();
  };

  usePerformance(engine, state, dispatch, toggle);

  const record = async () => {
    const live = engineRef.current;
    const current = stateRef.current;
    if (!live) return;
    if (current.transport.recording) {
      stop();
      return;
    }
    const track = current.project.tracks.find((item) => item.id === current.selectedTrackId);
    if (track?.kind === 'audio') {
      try {
        await live.startMic();
      } catch {
        dispatch({ type: 'status', text: 'Microphone permission is needed to record.' });
        return;
      }
    } else {
      dispatch({ type: 'pushHistory' });
    }
    recordTrackId.current = track?.id ?? null;
    recordTick.current = live.getPositionTick();
    dispatch({ type: 'setTransport', patch: { recording: true } });
    if (!live.isPlaying()) play();
    const vocal = track?.id === TRACK.vocals;
    dispatch({
      type: 'status',
      text: vocal
        ? 'Recording the vocal on top of the beat. Press Stop to keep it.'
        : track?.kind === 'audio'
          ? 'Recording the microphone. Press Stop to keep the take.'
          : 'Recording into the selected track. Press Stop when the take is done.',
    });
  };

  const addSample = async (bytes: ArrayBuffer, rawName: string) => {
    const live = engineRef.current;
    if (!live) return;
    if (bytes.byteLength > 4 * 1024 * 1024) {
      dispatch({ type: 'status', text: 'That file is over 4 MB. Choose a shorter one-shot.' });
      return;
    }
    let buffer: AudioBuffer;
    try {
      buffer = await live.ctx.decodeAudioData(bytes.slice(0));
    } catch {
      dispatch({ type: 'status', text: 'Could not decode that sound.' });
      return;
    }
    if (buffer.duration > 15) {
      dispatch({ type: 'status', text: 'That sound is longer than 15 seconds. Use a shorter one-shot.' });
      return;
    }
    const current = stateRef.current;
    const selected = current.project.tracks.find((item) => item.id === current.selectedTrackId);
    const onVocals = selected?.id === TRACK.vocals;
    const id = uid('smp');
    const clipId = uid('clip');
    const name = uniqueSampleName(current.project, rawName);
    const ticks = Math.max(
      stepTicks(current.project),
      Math.round(buffer.duration / secondsPerTick(current.project, current.project.bpm)),
    );
    const start = snapTicks(live.getPositionTick(), gridTicks(current.project, current.transport.snap));
    live.setBuffer(id, buffer);
    blobsDirty.current = true;
    dispatch({
      type: 'edit',
      history: true,
      recipe: (draft) => {
        draft.samples.push({ id, name });
        if (!onVocals) return;
        draft.clips.push({
          id: clipId,
          trackId: TRACK.vocals,
          startTick: start,
          kind: 'audio',
          sampleId: id,
          durationTicks: ticks,
        });
      },
    });
    if (onVocals) dispatch({ type: 'selectClip', clipId });
    dispatch({
      type: 'status',
      text: onVocals
        ? `Added ${name} on the Vocals lane.`
        : `Added ${name}. Drag it onto a drum row, the Audio lane, or Vocals.`,
    });
  };

  const hear = (project: State['project']) => {
    const live = engineRef.current;
    if (!live) return;
    if (live.isPlaying()) live.stop();
    const transport = { ...transportOf(stateRef.current), loopOn: true, loopStart: 0, loopEnd: barTicks(project) * 4 };
    dispatch({ type: 'setTransport', patch: { playing: true, loopOn: true, loopStartTick: 0, loopEndTick: transport.loopEnd } });
    live.play(project, transport, 0);
  };

  const installVoices = async (moodId: MoodId): Promise<DrumVoices> => {
    const punch = moodId === 'hard' || moodId === 'bouncy';
    const wanted = [
      punch ? 'pack_kick_punch' : 'pack_kick_soft',
      'pack_snare_tight',
      'pack_hat_tick',
      'pack_rim',
    ];
    const live = engineRef.current;
    const voices: DrumVoices = {
      kick: FACTORY.kick,
      snare: FACTORY.snare,
      hat: FACTORY.hat,
      perc: FACTORY.clap,
    };
    if (!live) return voices;
    const keys: (keyof DrumVoices)[] = ['kick', 'snare', 'hat', 'perc'];
    for (let i = 0; i < wanted.length; i++) {
      const id = wanted[i] ?? '';
      const item = FREE_PACK.find((sample) => sample.id === id);
      const key = keys[i];
      if (!item || !key) continue;
      try {
        if (!live.getBuffer(id)) {
          const response = await fetch(item.url);
          if (!response.ok) continue;
          const audio = await live.ctx.decodeAudioData((await response.arrayBuffer()).slice(0));
          live.setBuffer(id, audio);
          blobsDirty.current = true;
        }
        voices[key] = id;
      } catch {
        /* keep the built-in drum if this file cannot be decoded */
      }
    }
    return voices;
  };

  const commitBeat = (part: 'all' | 'drums' | 'bass' | 'melody', plan: BeatPlan, voices: DrumVoices) => {
    const next = structuredClone(stateRef.current.project);
    writeBeat(next, plan, part, voices);
    beatRef.current = plan;
    dispatch({
      type: 'edit',
      history: true,
      recipe: (draft) => {
        draft.bpm = next.bpm;
        draft.key = next.key;
        draft.clips = next.clips;
        draft.samples = next.samples;
        draft.tracks = next.tracks;
      },
    });
    setMade(true);
    hear(next);
  };

  const makeBeat = async () => {
    const seed = stateRef.current.theorySeed;
    dispatch({ type: 'bumpSeed' });
    const plan = planBeat(mood, seed);
    const voices = await installVoices(mood);
    commitBeat('all', plan, voices);
    setVoice(false);
    dispatch({ type: 'status', text: `Here's your ${mood} beat. It is already in time.` });
  };

  const changeRhythm = async () => {
    const current = beatRef.current ?? planBeat(mood, stateRef.current.theorySeed);
    const plan = { ...current, seed: current.seed + 1, mood };
    const voices = await installVoices(plan.mood);
    commitBeat('drums', plan, voices);
    dispatch({ type: 'status', text: 'New rhythm. The rest of the beat stayed.' });
  };

  const followBass = async () => {
    const plan = beatRef.current ?? planBeat(mood, stateRef.current.theorySeed);
    const voices = await installVoices(plan.mood);
    commitBeat('bass', plan, voices);
    dispatch({ type: 'status', text: 'The low notes now follow the chords, and they stay off the kick.' });
  };

  const simplerTune = async () => {
    const plan = beatRef.current ?? planBeat(mood, stateRef.current.theorySeed);
    const voices = await installVoices(plan.mood);
    commitBeat('melody', plan, voices);
    dispatch({ type: 'status', text: 'Simpler tune. One note in each bar.' });
  };

  const addVoice = () => {
    setVoice(true);
    dispatch({ type: 'selectTrack', trackId: TRACK.vocals });
    dispatch({ type: 'status', text: 'My voice is selected. Record on top of the beat.' });
  };

  const newSong = () => {
    const ok = window.confirm('Start a new song? This browser keeps one song, so download an MP3 first if you want to keep this one.');
    if (!ok) return;
    const live = engineRef.current;
    if (live?.isPlaying()) live.stop();
    dispatch({ type: 'setTransport', patch: { playing: false, recording: false } });
    beatRef.current = null;
    setMade(false);
    setVoice(false);
    setAdvanced(false);
    dispatch({ type: 'newSong' });
  };

  const save = async () => {
    const live = engineRef.current;
    if (!live) return;
    blobsDirty.current = true;
    await persist(stateRef.current, live, blobsDirty);
    dispatch({ type: 'status', text: 'Saved the project in this browser.' });
  };

  const reload = async () => {
    const live = engineRef.current;
    if (!live) return;
    const saved = await loadBundle();
    if (!saved) {
      dispatch({ type: 'status', text: 'Nothing is stored in this browser yet.' });
      return;
    }
    await live.installBlobs(saved.blobs);
    live.ensureFactory();
    dispatch({ type: 'load', project: { ...saved.project, bpm: clampBpm(saved.project.bpm) } });
  };

  const onExport = async (kind: 'mix' | 'mp3' | 'stems' | 'midi' | 'meta') => {
    const live = engineRef.current;
    if (!live || busy.current) return;
    const project = stateRef.current.project;
    if (kind === 'midi') {
      downloadBytes(encodeMidi(project), 'cbfl-song.mid', 'audio/midi');
      dispatch({ type: 'status', text: 'Exported MIDI Type 1.' });
      return;
    }
    if (kind === 'meta') {
      downloadBytes(new TextEncoder().encode(metaSidecar(project)), 'project.meta.json', 'application/json');
      dispatch({ type: 'status', text: 'Exported project.meta.json. Set the same tempo in FL. The WAV has no BPM.' });
      return;
    }
    busy.current = true;
    dispatch({ type: 'status', text: kind === 'stems' ? 'Rendering stems…' : 'Rendering the stereo mix…' });
    try {
      const buffers = live.allBuffers();
      if (kind === 'mix' || kind === 'mp3') {
        const audio = await renderProject(project, buffers, null);
        if (kind === 'mp3') {
          dispatch({ type: 'status', text: 'Encoding MP3 in this browser…' });
          await new Promise((resolve) => window.setTimeout(resolve, 20));
          const name = `cbfl-mix-${project.bpm}bpm.mp3`;
          downloadBytes(bufferToMp3(audio), name, 'audio/mpeg');
          dispatch({ type: 'status', text: `Downloaded ${name} to this computer.` });
        } else {
          downloadBytes(new Uint8Array(bufferToWav(audio)), 'cbfl-mix.wav', 'audio/wav');
          dispatch({ type: 'status', text: 'Exported a stereo WAV. It carries no tempo — use project.meta.json.' });
        }
      } else {
        for (const track of project.tracks) {
          const audio = await renderProject(project, buffers, track.id);
          downloadBytes(new Uint8Array(bufferToWav(audio)), `cbfl-stem-${slug(track.name)}.wav`, 'audio/wav');
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
        dispatch({ type: 'status', text: 'Exported one WAV stem per track. Tempo lives in project.meta.json.' });
      }
    } catch (error) {
      dispatch({ type: 'status', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      busy.current = false;
    }
  };

  const onDropSample = (trackId: string, tick: number, sampleId: string, clipId: string | null) => {
    const live = engineRef.current;
    const current = stateRef.current;
    const track = current.project.tracks.find((item) => item.id === trackId);
    if (!live || !track) return;
    if (track.kind !== 'audio') {
      dispatch({ type: 'status', text: 'Drop a sound on a drum row, the Audio lane, or Vocals.' });
      return;
    }
    const buffer = live.getBuffer(sampleId);
    const durationTicks = buffer
      ? Math.max(stepTicks(current.project), Math.round(buffer.duration / secondsPerTick(current.project, current.project.bpm)))
      : stepTicks(current.project) * 4;
    const start = snapTicks(tick, gridTicks(current.project, current.transport.snap));
    dispatch({
      type: 'edit',
      history: true,
      recipe: (draft) => {
        if (clipId) {
          const clip = draft.clips.find((item) => item.id === clipId && item.kind === 'audio');
          if (clip && clip.kind === 'audio') {
            clip.sampleId = sampleId;
            clip.durationTicks = durationTicks;
            return;
          }
        }
        draft.clips.push({
          id: uid('clip'),
          trackId,
          startTick: start,
          kind: 'audio',
          sampleId,
          durationTicks,
        });
      },
    });
    dispatch({
      type: 'status',
      text: track.id === TRACK.vocals ? 'Placed the sound on the Vocals lane.' : 'Placed the one-shot on the audio lane.',
    });
  };

  if (!ready || !engine) {
    return <div className="boot">Starting CBFL…</div>;
  }

  return (
    <EngineContext.Provider value={engine}>
      <HelpProvider>
        <div className={advanced ? 'app' : 'app simple'}>
          <TransportBar onPlay={play} onStop={stop} onRecord={() => void record()} onSave={() => void save()} onReload={() => void reload()} onNewSong={newSong} onExport={(kind) => void onExport(kind)} onSimple={advanced ? () => setAdvanced(false) : null} simple={!advanced} />
          <Playlist onDropSample={onDropSample} />
          <SidePanel onEnableMidi={() => void (window as unknown as { __cbflEnableMidi?: () => Promise<void> }).__cbflEnableMidi?.()} onImportSample={(bytes, name) => addSample(bytes, name)} />
          {advanced ? null : (
            <Beginner
              mood={mood}
              setMood={setMood}
              ready={made}
              voice={voice}
              onMake={() => void makeBeat()}
              onRhythm={() => void changeRhythm()}
              onBass={() => void followBass()}
              onSimpler={() => void simplerTune()}
              onVoice={addVoice}
              onRecord={() => void record()}
              onAdvanced={() => setAdvanced(true)}
            />
          )}
          <Editor />
          <Mixer />
          <HelpBar />
        </div>
      </HelpProvider>
    </EngineContext.Provider>
  );
}

function uniqueSampleName(project: State['project'], raw: string): string {
  const base = raw.trim().replace(/\.[^.]+$/, '') || 'Sound';
  const names = new Set(project.samples.map((sample) => sample.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

async function persist(state: State, engine: AudioEngine, dirty: { current: boolean }): Promise<void> {
  await saveProjectRecord(state.project);
  if (!dirty.current) return;
  const blobs = new Map<string, ArrayBuffer>();
  for (const sample of state.project.samples) {
    const buffer = engine.getBuffer(sample.id);
    if (buffer) blobs.set(sample.id, audioBufferToWav(buffer));
  }
  await saveBlobs(blobs);
  dirty.current = false;
}
