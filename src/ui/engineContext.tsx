import { createContext, useContext } from 'react';
import type { AudioEngine } from '../audio/engine';

export const EngineContext = createContext<AudioEngine | null>(null);

export function useEngine(): AudioEngine | null {
  return useContext(EngineContext);
}
