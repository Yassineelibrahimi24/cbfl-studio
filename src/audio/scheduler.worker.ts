import { NoteCursor } from './clock';
import type { WorkerIn, WorkerOut } from './protocol';

const clock = new NoteCursor();

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const msg = event.data;
  if (msg.type === 'start') {
    clock.start(msg);
    return;
  }
  if (msg.type === 'stop') {
    clock.stop();
    return;
  }
  if (msg.type === 'project') {
    clock.setProject(msg.project, msg.bpm, msg.loopOn, msg.loopStart, msg.loopEnd, msg.metronome);
    return;
  }
  if (msg.type === 'rebase') {
    clock.rebase(msg.positionTick, msg.audioTime, msg.bpm);
    return;
  }
  if (msg.type === 'poll') {
    const result = clock.poll(msg.currentTime);
    const out: WorkerOut = {
      type: 'events',
      events: result.events,
      positionTick: result.positionTick,
      atTime: msg.currentTime,
      generation: msg.generation,
    };
    self.postMessage(out);
  }
};
