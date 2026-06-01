"use client";

import { useEffect, useRef } from "react";
import type { MathfieldElement } from "mathlive";

type MathFieldRef = MathfieldElement & HTMLElement & { value: string };

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

      mathField.addEventListener("input", handleInput);
      cleanupRef.current = () => mathField.removeEventListener("input", handleInput);
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
