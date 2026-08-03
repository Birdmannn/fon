"use client";

import { Plus } from "lucide-react";

import CreateCampaignModalContent, {
  type CreateCampaignModalContentHandle,
  type CreateConstraintStatus,
  type CreateModalStep,
} from "@/app/create/_components/CreateCampaignModalContent";

import type { RefObject } from "react";

type CreateCampaignLauncherProps = {
  createModalContentRef: RefObject<CreateCampaignModalContentHandle | null>;
  createResetSignal: number;
  createStepBackSignal: number;
  fabClassName?: string;
  onConstraintStatusChange: (status: CreateConstraintStatus) => void;
  onDraftListOpenChange: (isOpen: boolean) => void;
  onDraftSelectionRequest: (draftId: string) => void;
  onMountableSelectionRequired: () => void;
  onMountableSelectionStateChange?: (state: { hasMountedHashtag: boolean; formsSelected: boolean }) => void;
  onOpenCreateModal: () => void;
  onPreviewErrorChange: (message: string) => void;
  onPublishSuccess: (txHash: string, randomnessPreimage: string | null) => void;
  onRequestCloseCreateModal: () => void;
  onStepChange: (step: CreateModalStep) => void;
  showCreateModal: boolean;
  isCreateModalClosing: boolean;
  availableFbars?: number;
};

export default function CreateCampaignLauncher({
  createModalContentRef,
  createResetSignal,
  createStepBackSignal,
  fabClassName = "fixed left-8 create-campaign-fab",
  onConstraintStatusChange,
  onDraftListOpenChange,
  onDraftSelectionRequest,
  onMountableSelectionRequired,
  onMountableSelectionStateChange,
  onOpenCreateModal,
  onPreviewErrorChange,
  onPublishSuccess,
  onRequestCloseCreateModal,
  onStepChange,
  showCreateModal,
  isCreateModalClosing,
  availableFbars,
}: CreateCampaignLauncherProps) {
  return (
    <>
      {showCreateModal ? (
        <button
          type="button"
          className={`create-campaign-backdrop ${isCreateModalClosing ? "create-campaign-backdrop-closing" : ""}`}
          aria-label="Close create freight modal"
          onClick={onRequestCloseCreateModal}
        />
      ) : null}

      {showCreateModal ? (
        <div
          className={`create-campaign-modal ${isCreateModalClosing ? "create-campaign-modal-closing" : ""}`}
          role="dialog"
          aria-label="Create freight modal"
          aria-modal="true"
        >
          <CreateCampaignModalContent
            ref={createModalContentRef}
            mode="modal"
            onRequestClose={onRequestCloseCreateModal}
            resetSignal={createResetSignal}
            stepBackSignal={createStepBackSignal}
            onStepChange={onStepChange}
            onConstraintStatusChange={onConstraintStatusChange}
            onPreviewErrorChange={onPreviewErrorChange}
            onDraftListOpenChange={onDraftListOpenChange}
            onDraftSelectionRequest={onDraftSelectionRequest}
            onMountableSelectionRequired={onMountableSelectionRequired}
            onMountableSelectionStateChange={onMountableSelectionStateChange}
            onPublishSuccess={onPublishSuccess}
            availableFbars={availableFbars}
          />
        </div>
      ) : null}

      <button
        type="button"
        aria-label="Open create freight modal"
        className={fabClassName}
        onClick={onOpenCreateModal}
      >
        <Plus size={48} strokeWidth={2} aria-hidden="true" />
      </button>
    </>
  );
}
