export type FreePackGroup = 'Kick' | 'Snare' | 'Hat' | 'Percussion' | 'Vocal chop';

export type FreePackItem = {
  id: string;
  name: string;
  group: FreePackGroup;
  url: string;
};

export const FREE_PACK_GROUPS: FreePackGroup[] = ['Kick', 'Snare', 'Hat', 'Percussion', 'Vocal chop'];

export const FREE_PACK: FreePackItem[] = [
  { id: 'pack_kick_soft', name: 'Soft kick', group: 'Kick', url: '/packs/cc0/kick-soft.wav' },
  { id: 'pack_kick_punch', name: 'Punch kick', group: 'Kick', url: '/packs/cc0/kick-punch.wav' },
  { id: 'pack_snare_tight', name: 'Tight snare', group: 'Snare', url: '/packs/cc0/snare-tight.wav' },
  { id: 'pack_hat_tick', name: 'Tick hat', group: 'Hat', url: '/packs/cc0/hat-tick.wav' },
  { id: 'pack_rim', name: 'Rim', group: 'Percussion', url: '/packs/cc0/rim.wav' },
  { id: 'pack_vocal_chop', name: 'Vocal chop', group: 'Vocal chop', url: '/packs/cc0/vocal-chop.wav' },
];
