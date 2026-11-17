import type { Project } from '../types';
import { collectEvents, shouldPlay, type SchedEvent, type WireEvent } from './events';
import { secondsPerTick, wrapTick } from './timeline';

export type ClockStart = {
  audioTime: number;
  positionTick: number;
  bpm: number;
  project: Project;
  loopOn: boolean;
  loopStart: number;
  loopEnd: number;
  metronome: boolean;
};

const LOOKAHEAD = 0.1;

export class NoteCursor {
  playing = false;
  bpm = 120;
  project: Project | null = null;
  loopOn = false;
  loopStart = 0;
  loopEnd = 0;
  metronome = false;
  cursorTick = 0;
  cursorAudio = 0;

  start(opts: ClockStart): void {
    this.playing = true;
    this.bpm = opts.bpm;
    this.project = opts.project;
    this.loopOn = opts.loopOn && opts.loopEnd > opts.loopStart;
    this.loopStart = opts.loopStart;
    this.loopEnd = opts.loopEnd;
    this.metronome = opts.metronome;
    this.cursorTick = opts.positionTick;
    this.cursorAudio = opts.audioTime;
  }

  stop(): void {
    this.playing = false;
  }

  setProject(project: Project, bpm: number, loopOn: boolean, loopStart: number, loopEnd: number, metronome: boolean): void {
    this.project = project;
    this.bpm = bpm;
    this.loopOn = loopOn && loopEnd > loopStart;
    this.loopStart = loopStart;
    this.loopEnd = loopEnd;
    this.metronome = metronome;
  }

  rebase(positionTick: number, audioTime: number, bpm: number): void {
    this.bpm = bpm;
    this.cursorTick = positionTick;
    this.cursorAudio = audioTime;
  }

  poll(currentTime: number, random: () => number = Math.random): { events: WireEvent[]; positionTick: number } {
    const events: WireEvent[] = [];
    const project = this.project;
    if (!this.playing || !project) {
      return { events, positionTick: this.cursorTick };
    }
    const spt = secondsPerTick(project, this.bpm);
    const horizon = currentTime + LOOKAHEAD;
    let guard = 0;
    while (this.cursorAudio < horizon && guard++ < 48) {
      const beat = project.ticksPerBeat > 0 ? (60 / this.bpm) : 0.5;
      const windowTicks = Math.max(1, (beat / spt) * 4);
      let windowEnd = this.cursorTick + windowTicks;
      if (this.loopOn) windowEnd = Math.min(windowEnd, this.loopEnd);
      if (windowEnd <= this.cursorTick + 1e-9) {
        if (this.loopOn) {
          this.cursorTick = this.loopStart;
          continue;
        }
        break;
      }
      const found = collectEvents(project, this.cursorTick, windowEnd, this.metronome);
      if (found.length === 0) {
        const jumpTicks = windowEnd - this.cursorTick;
        const jumpAudio = jumpTicks * spt;
        if (this.cursorAudio + jumpAudio > horizon) {
          const remain = horizon - this.cursorAudio;
          this.cursorTick += remain / spt;
          this.cursorAudio = horizon;
          break;
        }
        this.cursorAudio += jumpAudio;
        this.cursorTick = windowEnd;
        if (this.loopOn && this.cursorTick >= this.loopEnd - 1e-6) this.cursorTick = this.loopStart;
        continue;
      }
      const took = this.consume(found, horizon, spt, random, events);
      if (!took) break;
    }
    return { events, positionTick: this.positionAt(currentTime, spt) };
  }

  private consume(found: SchedEvent[], horizon: number, spt: number, random: () => number, out: WireEvent[]): boolean {
    let took = false;
    for (const ev of found) {
      const audioTime = this.cursorAudio + (ev.tick - this.cursorTick) * spt;
      if (audioTime >= horizon) break;
      took = true;
      if (shouldPlay(ev.probability, random)) {
        out.push({
          kind: ev.kind,
          audioTime,
          tick: ev.tick,
          trackId: ev.trackId,
          sampleId: ev.sampleId,
          pitch: ev.pitch,
          durationTicks: ev.durationTicks,
          velocity: ev.velocity,
          mono: ev.mono,
        });
      }
      this.cursorAudio = audioTime;
      this.cursorTick = ev.tick;
    }
    if (!took) return false;
    this.cursorTick += 1e-3;
    this.cursorAudio += 1e-3 * spt;
    if (this.loopOn && this.cursorTick >= this.loopEnd) {
      this.cursorTick = this.loopStart + (this.cursorTick - this.loopEnd);
    }
    return true;
  }

  positionAt(audioTime: number, spt = this.project ? secondsPerTick(this.project, this.bpm) : 0.001): number {
    const tick = this.cursorTick + (audioTime - this.cursorAudio) / spt;
    return wrapTick(tick, this.loopStart, this.loopEnd, this.loopOn);
  }
}
