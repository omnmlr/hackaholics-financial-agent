"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Camera, ImagePlus, Plus } from "lucide-react";

/** Native pickers supply images to the existing reviewed workflow. Capture is
 * a mobile picker hint, never a separate camera/permission/upload pipeline. */
export function AttachmentMenu({
  disabled,
  input,
  select,
}: {
  disabled: boolean;
  input: RefObject<HTMLInputElement | null>;
  select: (file: File | undefined) => void;
}) {
  const [open, setOpen] = useState(false),
    [cameraAvailable, setCameraAvailable] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function show() {
    const mobile =
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setCameraAvailable(mobile && "capture" in document.createElement("input"));
    setOpen(true);
  }
  function choose(capture: boolean) {
    if (disabled) return;
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    (capture ? camera : input).current?.click();
  }
  return (
    <div
      ref={root}
      className="agus-attachment"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open) {
          if (["ArrowDown", "ArrowUp"].includes(event.key) && !disabled) {
            event.preventDefault();
            show();
          }
          return;
        }
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
          }
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const items = [
            ...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ??
              []),
          ];
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (current +
                    (event.key === "ArrowUp" ? -1 : 1) +
                    items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        className="agus-icon-button agus-attachment-trigger"
        aria-label="Add attachment"
        title="Add an image"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <Plus size={20} />
      </button>
      {open && (
        <div
          ref={menu}
          id={`${id}-menu`}
          className="agus-attachment-menu"
          role="menu"
          aria-labelledby={`${id}-trigger`}
        >
          <p role="presentation">ADD AN IMAGE</p>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => choose(false)}
          >
            <ImagePlus size={19} />
            <span>
              Choose image<small>Photos &amp; screenshots</small>
            </span>
          </button>
          {cameraAvailable && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => choose(true)}
            >
              <Camera size={19} />
              <span>
                Take photo<small>Use your device camera</small>
              </span>
            </button>
          )}
        </div>
      )}
      <input
        ref={input}
        hidden
        type="file"
        className="agus-sr-only"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Select payment image"
        disabled={disabled}
        tabIndex={-1}
        onChange={(event) => {
          if (!disabled) select(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={camera}
        hidden
        type="file"
        className="agus-sr-only"
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
        aria-label="Take payment photo"
        disabled={disabled}
        tabIndex={-1}
        onChange={(event) => {
          if (!disabled) select(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
