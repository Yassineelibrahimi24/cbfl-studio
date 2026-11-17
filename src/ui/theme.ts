export const TRACK_COLORS = ['#e15a3a', '#f0a202', '#4aa3ff', '#8b7cff', '#2fbf8a', '#ff7ab2'];

export function trackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length] ?? '#e15a3a';
}
