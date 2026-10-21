/** Visual viewport coordinates are relative to the layout viewport. Use them
 * for a fixed shell, never as a flow margin. Pinch zoom must not re-layout chat. */
export function workspaceViewport(input: {
  innerHeight: number;
  visualHeight?: number;
  offsetTop?: number;
  scale?: number;
}) {
  if (input.scale !== undefined && Math.abs(input.scale - 1) > 0.01)
    return null;
  if (!Number.isFinite(input.innerHeight) || input.innerHeight <= 0)
    return null;
  const measured =
    input.visualHeight !== undefined &&
    Number.isFinite(input.visualHeight) &&
    input.visualHeight > 0
      ? input.visualHeight
      : input.innerHeight;
  const height = Math.round(Math.min(input.innerHeight, measured));
  const offset = Number.isFinite(input.offsetTop) ? input.offsetTop! : 0;
  const top = Math.round(
    Math.max(0, Math.min(offset, input.innerHeight - height)),
  );
  return { height, top };
}
