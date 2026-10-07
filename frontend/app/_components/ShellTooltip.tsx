"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ActiveTooltip = { target: HTMLElement; text: string; addedLabel: boolean };

export default function ShellTooltip() {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState<ActiveTooltip | null>(null);

  useEffect(() => {
    let current: ActiveTooltip | null = null;

    const close = () => {
      if (!current) return;
      if (current.addedLabel) current.target.removeAttribute("aria-label");
      current = null;
      setActive(null);
    };
    const open = (node: EventTarget | null) => {
      if (!(node instanceof Element)) return;
      if (current?.target.contains(node)) return;
      const target = node.closest<HTMLElement>("[data-tooltip]");
      if (!target || target.getAttribute("data-tooltip") === "") return;
      if (current?.target === target) return;
      close();
      const text = target.getAttribute("data-tooltip") || "";
      const addedLabel = !target.hasAttribute("aria-label");
      if (addedLabel) target.setAttribute("aria-label", text);
      current = { target, text, addedLabel };
      setActive(current);
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") open(event.target);
    };
    const onPointerOut = (event: PointerEvent) => {
      if (current && !current.target.contains(event.relatedTarget as Node | null)) close();
    };
    const onFocusIn = (event: FocusEvent) => open(event.target);
    const onFocusOut = (event: FocusEvent) => {
      if (current && !current.target.contains(event.relatedTarget as Node | null)) close();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("keydown", onEscape);
    return () => {
      close();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!active || !tooltip) return;
    const shell = active.target.closest<HTMLElement>(
      ".create-campaign-modal, .campaign-detail-shell, .profile-page-shell, .campaign-shell-width, .campaign-shell-width-md, .campaign-shell-width-detail, .campaign-shell-width-expanded",
    );

    const position = () => {
      if (!active.target.isConnected) return;
      const bounds = shell?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth };
      const trigger = active.target.getBoundingClientRect();
      const leftEdge = Math.max(8, bounds.left + 8);
      const rightEdge = Math.min(window.innerWidth - 8, bounds.right - 8);
      tooltip.style.maxWidth = `${Math.max(0, rightEdge - leftEdge) * 0.75}px`;
      const width = tooltip.getBoundingClientRect().width;
      const left = Math.max(leftEdge, Math.min(trigger.left + trigger.width / 2 - width / 2, rightEdge - width));
      const height = tooltip.getBoundingClientRect().height;
      const below = trigger.bottom + 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${below + height <= window.innerHeight - 8 ? below : Math.max(8, trigger.top - height - 8)}px`;
      tooltip.style.visibility = "visible";
    };

    position();
    const observer = new ResizeObserver(position);
    if (shell) observer.observe(shell);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [active]);

  return (
    active ? createPortal(
      <span ref={tooltipRef} className="campaign-shell-tooltip" role="tooltip">{active.text}</span>,
      document.body,
    ) : null
  );
}
