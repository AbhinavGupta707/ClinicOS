"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Keep clinical text in the editor until it is saved or explicitly discarded. */
export function useUnsavedNoteGuard() {
  const dirty = useRef(false);
  const [message, setMessage] = useState("");
  const setNoteDirty = useCallback((value: boolean) => {
    dirty.current = value;
    if (!value) setMessage("");
  }, []);
  const allowNavigation = useCallback(() => {
    if (!dirty.current) return true;
    setMessage(
      "Save or explicitly discard the unsaved clinical note before changing patient, visit or page."
    );
    return false;
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    const guardLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      // Opening another tab or moving focus within this page does not replace the editor.
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        anchor.getAttribute("href")?.startsWith("#")
      )
        return;
      if (allowNavigation()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardLink, true);
    };
  }, [allowNavigation]);
  return { setNoteDirty, allowNavigation, message };
}
