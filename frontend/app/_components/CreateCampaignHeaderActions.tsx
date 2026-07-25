"use client";

import { ArrowDown, ArrowLeft, ArrowUp, RotateCcw } from "lucide-react";

import type { CreateModalStep } from "@/app/create/_components/CreateCampaignModalContent";

type CreateCampaignHeaderActionsProps = {
  createModalStep: CreateModalStep;
  isCreateDraftListOpen: boolean;
  isCreateModalClosing: boolean;
  onReset: () => void;
  onSecondaryAction: () => void;
};

export default function CreateCampaignHeaderActions({
  createModalStep,
  isCreateDraftListOpen,
  isCreateModalClosing,
  onReset,
  onSecondaryAction,
}: CreateCampaignHeaderActionsProps) {
  const createTopActionTooltip = createModalStep === "review" ? "Back" : isCreateDraftListOpen ? "Hide drafts" : "Load drafts";
  const createTopActionLabel = createModalStep === "review" ? "Back to compose step" : isCreateDraftListOpen ? "Hide saved drafts" : "Load saved drafts";

  return (
    <div
      className={`create-modal-top-actions ${isCreateModalClosing ? "create-modal-top-actions-closing" : ""}`}
      role="group"
      aria-label="Create modal controls"
    >
      <button
        type="button"
        className="create-modal-action-btn"
        data-tooltip="Reset form"
        onClick={onReset}
        aria-label="Reset create campaign form"
      >
        <RotateCcw className="campaign-action-icon" size={22} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="create-modal-action-btn"
        data-tooltip={createTopActionTooltip}
        onClick={onSecondaryAction}
        aria-label={createTopActionLabel}
      >
        {createModalStep === "review" ? (
          <ArrowLeft className="campaign-action-icon" size={22} strokeWidth={2} aria-hidden="true" />
        ) : (
          <span className={`create-modal-toggle-icon-wrap ${isCreateDraftListOpen ? "create-modal-toggle-icon-wrap-open" : ""}`}>
            <ArrowDown className="campaign-action-icon create-modal-toggle-icon create-modal-toggle-icon-down" size={26} strokeWidth={2} aria-hidden="true" />
            <ArrowUp className="campaign-action-icon create-modal-toggle-icon create-modal-toggle-icon-up" size={26} strokeWidth={2} aria-hidden="true" />
          </span>
        )}
      </button>
    </div>
  );
}
