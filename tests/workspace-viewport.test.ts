import { expect, it } from "vitest";
import { workspaceViewport } from "../src/lib/workspace-viewport";
it("keeps layout and visual-only keyboard resizing in one fixed coordinate system", () => {
  expect(
    workspaceViewport({
      innerHeight: 844,
      visualHeight: 420,
      offsetTop: 80,
      scale: 1,
    }),
  ).toEqual({ height: 420, top: 80 });
  expect(
    workspaceViewport({
      innerHeight: 420,
      visualHeight: 420,
      offsetTop: 80,
      scale: 1,
    }),
  ).toEqual({ height: 420, top: 0 });
  expect(
    workspaceViewport({
      innerHeight: 844,
      visualHeight: 844,
      offsetTop: 80,
      scale: 1,
    }),
  ).toEqual({ height: 844, top: 0 });
});
it("bounds invalid measurements and leaves pinch zoom to the browser", () => {
  expect(
    workspaceViewport({ innerHeight: 844, visualHeight: 999, offsetTop: -12 }),
  ).toEqual({ height: 844, top: 0 });
  expect(workspaceViewport({ innerHeight: 844, visualHeight: 0 })).toEqual({
    height: 844,
    top: 0,
  });
  expect(
    workspaceViewport({ innerHeight: 844, visualHeight: 420, scale: 2 }),
  ).toBeNull();
  expect(workspaceViewport({ innerHeight: 0 })).toBeNull();
});
