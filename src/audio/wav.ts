function writeStr(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function floatTo16(x: number): number {
  const s = Math.max(-1, Math.min(1, x));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const count = Math.max(1, channels.length);
  const n = channels[0]?.length ?? 0;
  const block = count * 2;
  const dataSize = n * block;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * block, true);
  view.setUint16(32, block, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < count; c++) {
      view.setInt16(offset, floatTo16(channels[c]?.[i] ?? 0), true);
      offset += 2;
    }
  }
  return buffer;
}

export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return encodeWav(channels, buffer.sampleRate);
}

export function wavHasTempoChunk(bytes: ArrayBuffer): boolean {
  const text = new TextDecoder('latin1').decode(new Uint8Array(bytes));
  return text.includes('bext') || text.includes('acid') || text.includes('smpl') || text.includes('BPM');
}
