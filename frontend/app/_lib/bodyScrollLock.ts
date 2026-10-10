let previousOverflow: string | null = null;
const activeLocks = new Set<symbol>();

export function lockBodyScroll(): () => void {
  const lock = Symbol("body-scroll-lock");
  if (activeLocks.size === 0) {
    previousOverflow = document.body.style.overflow;
  }
  activeLocks.add(lock);
  document.body.style.overflow = "hidden";

  return () => {
    if (!activeLocks.delete(lock)) return;
    if (activeLocks.size === 0) {
      document.body.style.overflow = previousOverflow ?? "";
      previousOverflow = null;
    }
  };
}
