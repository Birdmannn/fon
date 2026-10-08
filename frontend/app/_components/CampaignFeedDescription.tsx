"use client";

import { useEffect, useRef, useState } from "react";

import CampaignDescriptionContent from "@/app/_components/CampaignDescriptionContent";

type CampaignFeedDescriptionProps = {
  text: string;
  onOpenDetail?: () => void;
};

export default function CampaignFeedDescription({ text, onOpenDetail }: CampaignFeedDescriptionProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const description = descriptionRef.current;
    if (!viewport || !description) return;

    const measure = () => {
      const height = viewport.clientHeight;
      const lineHeight = Number.parseFloat(getComputedStyle(description).lineHeight);
      const lines = Math.floor(height / lineHeight);
      description.style.setProperty("-webkit-line-clamp", String(Math.max(1, lines)));
      description.style.visibility = lines > 0 ? "visible" : "hidden";

      // Measure the complete copy at the same width, independently of the clamp.
      const fullCopy = description.cloneNode(true) as HTMLDivElement;
      Object.assign(fullCopy.style, {
        position: "absolute",
        width: `${viewport.clientWidth}px`,
        height: "auto",
        visibility: "hidden",
        pointerEvents: "none",
        display: "flex",
        WebkitLineClamp: "unset",
      });
      fullCopy.setAttribute("aria-hidden", "true");
      viewport.appendChild(fullCopy);
      const fullHeight = fullCopy.getBoundingClientRect().height;
      fullCopy.remove();
      setTruncated(fullHeight > height + 1);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    void document.fonts.ready.then(() => {
      if (viewport.isConnected) measure();
    });
    return () => observer.disconnect();
  }, [text]);

  return (
    <>
      <div ref={viewportRef} className="campaign-card-description-wrap campaign-card-description-wrap-clamped">
        <div ref={descriptionRef} className="campaign-card-description campaign-card-description-feed campaign-card-description-clamped">
          <CampaignDescriptionContent lines={text ? text.split("\n") : []} />
        </div>
      </div>
      {truncated && onOpenDetail ? (
        <button
          type="button"
          className="campaign-card-read-more"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDetail();
          }}
        >
          Read more...
        </button>
      ) : null}
    </>
  );
}
