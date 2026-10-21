const SLOT_SIZE = 16;

export function composerBracesGeometry(hostSize: number): {
  size: number; left: number; top: number;
} {
  const size = Math.min(12, Math.max(0, hostSize));
  return { size, left: SLOT_SIZE - size, top: (SLOT_SIZE - size) / 2 };
}
