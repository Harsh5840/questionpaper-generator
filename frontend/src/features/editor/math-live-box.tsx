"use client";

import { useEffect, useRef } from "react";
import type { MathfieldElement } from "mathlive";

type MathFieldRef = MathfieldElement & HTMLElement & { value: string };

// Module-level reference to the last focused math-field popup box
let activeMathBoxField: MathFieldRef | null = null;

export function getActiveMathBoxField() {
  return activeMathBoxField;
}

export function insertIntoActiveMathBoxField(latex: string) {
  if (!activeMathBoxField) return false;
  try {
    (activeMathBoxField as unknown as { executeCommand: (cmd: unknown) => void }).executeCommand(["insert", latex]);
  } catch {
    activeMathBoxField.value = activeMathBoxField.value + latex;
  }
  return true;
}

interface MathLiveBoxProps {
  autoFocus?: boolean;
  value: string;
  onChange: (latex: string) => void;
}

export function MathLiveBox({ autoFocus = false, value, onChange }: MathLiveBoxProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mathFieldRef = useRef<MathFieldRef | null>(null);
  const onChangeRef = useRef(onChange);
  const cleanupRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let isMounted = true;

    async function mountMathField() {
      await import("mathlive");
      if (!isMounted || !hostRef.current || mathFieldRef.current) return;

      const mathField = document.createElement("math-field") as MathFieldRef;
      mathField.value = value;
      mathField.setAttribute("default-mode", "inline-math");
      mathField.setAttribute("math-virtual-keyboard-policy", "manual");
      mathField.setAttribute("math-mode-space", "\\ ");
      mathField.setAttribute("smart-fence", "true");
      mathField.setAttribute("smart-mode", "true");
      mathField.smartFence = true;
      mathField.smartMode = true;
      mathField.inlineShortcutTimeout = 0;
      mathField.mathModeSpace = "\\ ";

      const handleInput = () => onChangeRef.current(mathField.value);
      const handleFocus = () => { activeMathBoxField = mathField; };
      const handleBlur = () => { if (activeMathBoxField === mathField) activeMathBoxField = null; };
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        activeMathBoxField = mathField;
        document.dispatchEvent(new CustomEvent("qpg:math-box-contextmenu", {
          detail: { x: e.clientX, y: e.clientY },
          bubbles: true,
        }));
      };

      mathField.addEventListener("input", handleInput);
      mathField.addEventListener("focus", handleFocus);
      mathField.addEventListener("blur", handleBlur);
      mathField.addEventListener("contextmenu", handleContextMenu);

      cleanupRef.current = () => {
        mathField.removeEventListener("input", handleInput);
        mathField.removeEventListener("focus", handleFocus);
        mathField.removeEventListener("blur", handleBlur);
        mathField.removeEventListener("contextmenu", handleContextMenu);
        if (activeMathBoxField === mathField) activeMathBoxField = null;
      };

      hostRef.current.appendChild(mathField);
      mathFieldRef.current = mathField;

      if (autoFocus) {
        window.requestAnimationFrame(() => mathField.focus());
      }
    }

    void mountMathField();

    return () => {
      isMounted = false;
      const mathField = mathFieldRef.current;
      if (!mathField) return;

      cleanupRef.current();
      mathField.remove();
      mathFieldRef.current = null;
    };
    // Create the custom element once. Later value updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mathField = mathFieldRef.current;
    if (mathField && mathField.value !== value) {
      mathField.value = value;
    }
  }, [value]);

  return <div ref={hostRef} className="math-live-host" />;
}
