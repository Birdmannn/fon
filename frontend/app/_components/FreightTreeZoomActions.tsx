"use client";

import { ZoomIn, ZoomOut } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

type Props = {
  isClosing: boolean;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
};

export default function FreightTreeZoomActions({ isClosing, zoom, setZoom }: Props) {
  return (
    <div className={`create-modal-top-actions campaign-freight-tree-zoom-actions ${isClosing ? "create-modal-top-actions-closing" : ""}`} role="group" aria-label="Freight tree zoom controls">
      <button type="button" className="create-modal-action-btn" onClick={() => setZoom((current) => Math.min(2, current + 0.25))}
        disabled={isClosing || zoom >= 2} aria-label="Zoom in freight tree" data-tooltip="Zoom in">
        <ZoomIn size={22} strokeWidth={2} aria-hidden="true" />
      </button>
      <button type="button" className="create-modal-action-btn" onClick={() => setZoom((current) => Math.max(0.5, current - 0.25))}
        disabled={isClosing || zoom <= 0.5} aria-label="Zoom out freight tree" data-tooltip="Zoom out">
        <ZoomOut size={22} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
