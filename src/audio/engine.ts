import { FACTORY, type Project } from '../types';
import { factoryBuffers, makeImpulse } from './samples';
import { buildMixGraph, insertSignature, type MixGraph } from './graph';
import { triggerWire, type BassVoice, type LiveVoice } from './trigger';
import type { TransportMsg, WorkerIn, WorkerOut } from './protocol';
import { secondsPerTick, wrapTick } from './timeline';
import { midiToHz } from '../theory/music';

export type EngineTransport = TransportMsg;

function createContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not available');
  return new Ctor({ latencyHint: 'interactive' });
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly usingWorker = true;
  private worker: Worker;
  private graph: MixGraph | null = null;
  private impulse: AudioBuffer;
  private buffers = new Map<string, AudioBuffer>();
  private project: Project | null = null;
  private transport: EngineTransport | null = null;
  private voices: LiveVoice[] = [];
  private bass = new Map<string, BassVoice>();
  private playingFlag = false;
  private generation = 1;
  private timer = 0;
  private anchorTick = 0;
  private anchorAudio = 0;
  private stoppedTick = 0;
  private signature = '';
  private master = 0.9;
  private outputGate: GainNode;
  private analyser: AnalyserNode;
  private preview: GainNode;
  private levelScratch: Uint8Array<ArrayBuffer>;
  recentKicks: number[] = [];
  private mic: {
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    proc: ScriptProcessorNode;
    mute: GainNode;
    chunks: Float32Array[];
  } | null = null;

  constructor() {
    this.ctx = createContext();
    this.outputGate = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.levelScratch = new Uint8Array(this.analyser.fftSize);
    this.preview = this.ctx.createGain();
    this.preview.gain.value = 0.7;
    this.outputGate.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.preview.connect(this.ctx.destination);
    this.impulse = makeImpulse(this.ctx);
    this.buffers = factoryBuffers(this.ctx);
    this.worker = new Worker(new URL('./scheduler.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerOut>) => this.onWorker(event.data);
    if (import.meta.env.DEV) {
      (window as unknown as { __CBFL?: AudioEngine }).__CBFL = this;
    }
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  isPlaying(): boolean {
    return this.playingFlag;
  }

  getPositionTick(): number {
    if (!this.playingFlag || !this.project || !this.transport) return this.stoppedTick;
    const spt = secondsPerTick(this.project, this.project.bpm);
    const tick = this.anchorTick + (this.ctx.currentTime - this.anchorAudio) / spt;
    return wrapTick(tick, this.transport.loopStart, this.transport.loopEnd, this.transport.loopOn);
  }

  getBuffer(id: string): AudioBuffer | undefined {
    return this.buffers.get(id);
  }

  setBuffer(id: string, buffer: AudioBuffer): void {
    this.buffers.set(id, buffer);
  }

  buffersFor(ids: string[]): Map<string, AudioBuffer> {
    const map = new Map<string, AudioBuffer>();
    for (const id of ids) {
      const buffer = this.buffers.get(id);
      if (buffer) map.set(id, buffer);
    }
    return map;
  }

  allBuffers(): Map<string, AudioBuffer> {
    return new Map(this.buffers);
  }

  ensureFactory(): void {
    const fresh = factoryBuffers(this.ctx);
    for (const [id, buffer] of fresh) {
      if (!this.buffers.has(id)) this.buffers.set(id, buffer);
    }
  }

  async installBlobs(blobs: Map<string, ArrayBuffer>): Promise<void> {
    for (const [id, bytes] of blobs) {
      try {
        const audio = await this.ctx.decodeAudioData(bytes.slice(0));
        this.buffers.set(id, audio);
      } catch {
        /* keep a generated buffer when a blob cannot be decoded */
      }
    }
  }

  setMaster(value: number): void {
    this.master = value;
    if (this.graph) this.graph.output.gain.value = value;
  }

  getLevel(): number {
    this.analyser.getByteTimeDomainData(this.levelScratch);
    let peak = 0;
    for (let i = 0; i < this.levelScratch.length; i++) {
      const v = Math.abs(this.levelScratch[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return peak;
  }

  kickGaps(): number[] {
    const gaps: number[] = [];
    for (let i = 1; i < this.recentKicks.length; i++) gaps.push(this.recentKicks[i] - this.recentKicks[i - 1]);
    return gaps;
  }

  sync(project: Project, transport: EngineTransport): void {
    const previous = this.project;
    let position = this.stoppedTick;
    if (this.playingFlag && previous && this.transport) {
      const spt = secondsPerTick(previous, previous.bpm);
      const tick = this.anchorTick + (this.ctx.currentTime - this.anchorAudio) / spt;
      position = wrapTick(tick, this.transport.loopStart, this.transport.loopEnd, this.transport.loopOn);
    }
    this.project = project;
    this.transport = transport;
    this.ensureGraph(project);
    this.worker.postMessage({
      type: 'project',
      project,
      bpm: project.bpm,
      loopOn: transport.loopOn,
      loopStart: transport.loopStart,
      loopEnd: transport.loopEnd,
      metronome: transport.metronome,
    } satisfies WorkerIn);
    if (this.playingFlag && previous && previous.bpm !== project.bpm) {
      const at = this.ctx.currentTime;
      this.killFuture(at);
      this.anchorTick = position;
      this.anchorAudio = at;
      this.worker.postMessage({ type: 'rebase', positionTick: position, audioTime: at, bpm: project.bpm } satisfies WorkerIn);
    }
  }

  play(project: Project, transport: EngineTransport, fromTick: number): void {
    if (this.playingFlag) return;
    void this.resume();
    this.project = project;
    this.transport = transport;
    this.ensureGraph(project);
    const at = this.ctx.currentTime + 0.05;
    this.outputGate.gain.cancelScheduledValues(this.ctx.currentTime);
    this.outputGate.gain.setValueAtTime(1, this.ctx.currentTime);
    this.playingFlag = true;
    this.generation += 1;
    this.anchorTick = fromTick;
    this.anchorAudio = at;
    this.stoppedTick = fromTick;
    this.recentKicks = [];
    this.worker.postMessage({
      type: 'start',
      audioTime: at,
      positionTick: fromTick,
      bpm: project.bpm,
      project,
      generation: this.generation,
      loopOn: transport.loopOn,
      loopStart: transport.loopStart,
      loopEnd: transport.loopEnd,
      metronome: transport.metronome,
    } satisfies WorkerIn);
    this.poll();
    if (!this.timer) this.timer = window.setInterval(() => this.poll(), 25);
  }

  stop(): number {
    if (!this.playingFlag) return this.stoppedTick;
    const position = this.getPositionTick();
    this.playingFlag = false;
    this.generation += 1;
    this.worker.postMessage({ type: 'stop' } satisfies WorkerIn);
    const at = this.ctx.currentTime;
    this.outputGate.gain.cancelScheduledValues(at);
    this.outputGate.gain.setValueAtTime(0, at);
    this.killVoices(at);
    this.bass.clear();
    this.stoppedTick = position;
    return position;
  }

  seek(tick: number, project?: Project, transport?: EngineTransport): void {
    const next = Math.max(0, tick);
    if (project) this.project = project;
    if (transport) this.transport = transport;
    if (!this.playingFlag || !this.project || !this.transport) {
      this.stoppedTick = next;
      return;
    }
    const at = this.ctx.currentTime + 0.04;
    this.killVoices(this.ctx.currentTime);
    this.bass.clear();
    this.generation += 1;
    this.anchorTick = next;
    this.anchorAudio = at;
    this.worker.postMessage({
      type: 'start',
      audioTime: at,
      positionTick: next,
      bpm: this.project.bpm,
      project: this.project,
      generation: this.generation,
      loopOn: this.transport.loopOn,
      loopStart: this.transport.loopStart,
      loopEnd: this.transport.loopEnd,
      metronome: this.transport.metronome,
    } satisfies WorkerIn);
  }

  previewSample(id: string): void {
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    this.previewBuffer(buffer, id === FACTORY.hat ? 0.45 : 0.8);
  }

  previewBuffer(buffer: AudioBuffer, gainValue = 0.8): void {
    void this.resume();
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = gainValue;
    src.buffer = buffer;
    src.connect(gain);
    gain.connect(this.preview);
    const at = this.ctx.currentTime + 0.01;
    src.start(at);
    src.stop(at + Math.max(0.02, buffer.duration));
  }

  previewNote(pitch: number, mono: boolean): void {
    void this.resume();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const at = this.ctx.currentTime;
    osc.type = mono ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(Math.max(20, midiToHz(pitch)), at);
    const peak = mono ? 0.45 : 0.18;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + (mono ? 0.4 : 0.28));
    osc.connect(gain);
    gain.connect(this.preview);
    osc.start(at);
    osc.stop(at + 0.5);
  }

  async startMic(): Promise<void> {
    await this.resume();
    if (this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const source = this.ctx.createMediaStreamSource(stream);
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    const chunks: Float32Array[] = [];
    proc.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(proc);
    proc.connect(mute);
    mute.connect(this.ctx.destination);
    this.mic = { stream, source, proc, mute, chunks };
  }

  captureMic(): { pcm: Float32Array; sampleRate: number } | null {
    const mic = this.mic;
    if (!mic) return null;
    this.mic = null;
    try { mic.proc.disconnect(); } catch { /* already disconnected */ }
    try { mic.source.disconnect(); } catch { /* already disconnected */ }
    try { mic.mute.disconnect(); } catch { /* already disconnected */ }
    mic.stream.getTracks().forEach((track) => track.stop());
    const length = mic.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const pcm = new Float32Array(length);
    let offset = 0;
    for (const chunk of mic.chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    return { pcm, sampleRate: this.ctx.sampleRate };
  }

  bufferFromPcm(pcm: Float32Array, sampleRate: number): AudioBuffer {
    const buffer = this.ctx.createBuffer(1, Math.max(1, pcm.length), sampleRate);
    const channel = new Float32Array(new ArrayBuffer(pcm.length * 4));
    channel.set(pcm);
    buffer.copyToChannel(channel, 0);
    return buffer;
  }

  dispose(): void {
    this.stop();
    this.captureMic();
    if (this.timer) window.clearInterval(this.timer);
    this.worker.terminate();
    void this.ctx.close();
  }

  private poll(): void {
    if (!this.playingFlag) return;
    this.worker.postMessage({ type: 'poll', currentTime: this.ctx.currentTime, generation: this.generation } satisfies WorkerIn);
  }

  private onWorker(msg: WorkerOut): void {
    if (msg.generation !== this.generation || !this.playingFlag || !this.project || !this.graph) return;
    this.anchorTick = msg.positionTick;
    this.anchorAudio = msg.atTime;
    for (const ev of msg.events) {
      if (ev.audioTime < this.ctx.currentTime - 0.03) continue;
      const voice = triggerWire(this.ctx, this.graph, this.buffers, this.project, ev, this.bass);
      if (voice) this.voices.push(voice);
      if ((ev.kind === 'sample' || ev.kind === 'metro') && (ev.sampleId ?? '').includes('kick')) {
        this.recentKicks.push(ev.audioTime);
        if (this.recentKicks.length > 16) this.recentKicks.shift();
      }
    }
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((voice) => voice.startTime + 8 > now);
  }

  private ensureGraph(project: Project): void {
    const signature = project.tracks.map((track) => `${track.id}:${insertSignature(track)}`).join('|');
    if (!this.graph || signature !== this.signature) {
      this.killVoices(this.ctx.currentTime);
      this.bass.clear();
      if (this.graph) {
        try { this.graph.output.disconnect(); } catch { /* first graph */ }
      }
      this.graph = buildMixGraph(this.ctx, project, this.impulse);
      this.graph.output.gain.value = this.master;
      this.graph.output.connect(this.outputGate);
      this.signature = signature;
      return;
    }
    this.graph.update(project);
  }

  private killVoices(when: number): void {
    for (const voice of this.voices) voice.stop(when);
    this.voices = [];
  }

  private killFuture(when: number): void {
    const keep: LiveVoice[] = [];
    for (const voice of this.voices) {
      if (voice.startTime > when + 0.005) voice.stop(when);
      else keep.push(voice);
    }
    this.voices = keep;
  }
}
