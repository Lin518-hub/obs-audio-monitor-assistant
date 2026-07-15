export const ATEM_MORANDI_COLORS = [
  '#789B83',
  '#7692A8',
  '#B08072',
  '#9488A3',
  '#AA9568',
  '#6F9691',
  '#AD7F89',
  '#899671',
  '#7C8998',
  '#A28774',
  '#718B9C',
  '#9A7E96'
] as const;

export function defaultATEMInputColor(inputId: number): string {
  const normalized = Number.isFinite(inputId) ? Math.abs(Math.trunc(inputId)) : 1;
  const index = Math.max(0, normalized - 1) % ATEM_MORANDI_COLORS.length;
  return ATEM_MORANDI_COLORS[index];
}
