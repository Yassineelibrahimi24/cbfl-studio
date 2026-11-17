import type { Project } from '../types';
import type { WireEvent } from './events';

export type TransportMsg = {
  loopOn: boolean;
  loopStart: number;
  loopEnd: number;
  metronome: boolean;
};

export type WorkerIn =
  | ({
      type: 'start';
      audioTime: number;
      positionTick: number;
      bpm: number;
      project: Project;
      generation: number;
    } & TransportMsg)
  | { type: 'stop' }
  | ({ type: 'project'; project: Project; bpm: number } & TransportMsg)
  | { type: 'rebase'; audioTime: number; positionTick: number; bpm: number }
  | { type: 'poll'; currentTime: number; generation: number };

export type WorkerOut = {
  type: 'events';
  events: WireEvent[];
  positionTick: number;
  atTime: number;
  generation: number;
};
