"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CREATE_MODAL_RESUME_MAX_AGE_MS,
  CREATE_MODAL_RESUME_STORAGE_KEY,
  type CreateCampaignModalContentHandle,
  type CreateConstraintStatus,
  type CreateModalStep,
} from "@/app/create/_components/CreateCampaignModalContent";
import { normalizeAppMountableConfig } from "@/app/_lib/appMountable";
import type { AppMountableConfig, RegisteredMountableApp } from "@/app/_types/appMountable";

type UseCreateCampaignFlowArgs<TMode extends string> = {
  animationMs: number;
  initialInfoModalMode: TMode;
  openWallet: () => void;
  signer: unknown;
  clearInfoCloseTimer: () => void;
  clearInfoHideTimer: () => void;
  clearSubmissionSuccessTimer?: () => void;
  closeInfoModal: (onBeforeHide?: () => void) => void;
  setInfoModalMode: (mode: TMode) => void;
  setInfoModalInteraction?: (interaction: "hover" | "click") => void;
  setIsInfoModalClosing: (closing: boolean) => void;
  setShowInfoModal: (show: boolean) => void;
};

export function useCreateCampaignFlow<TMode extends string>({
  animationMs,
  initialInfoModalMode,
  openWallet,
  signer,
  clearInfoCloseTimer,
  clearInfoHideTimer,
  clearSubmissionSuccessTimer,
  closeInfoModal,
  setInfoModalMode,
  setInfoModalInteraction,
  setIsInfoModalClosing,
  setShowInfoModal,
}: UseCreateCampaignFlowArgs<TMode>) {
  const createHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createModalContentRef = useRef<CreateCampaignModalContentHandle>(null);

  const [saveDraftPromptError, setSaveDraftPromptError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreateModalClosing, setIsCreateModalClosing] = useState(false);
  const [createResetSignal, setCreateResetSignal] = useState(0);
  const [createStepBackSignal, setCreateStepBackSignal] = useState(0);
  const [createModalStep, setCreateModalStep] = useState<CreateModalStep>("compose");
  const [constraintStatus, setConstraintStatus] = useState<CreateConstraintStatus>({
    titlePassed: false,
    bodyPassed: false,
    firstHashtagPassed: false,
    additionalHashtagsPassed: true,
  });
  const [previewError, setPreviewError] = useState("");
  const [formsMountableSelected, setFormsMountableSelected] = useState(false);
  const [lockMountableSelected, setLockMountableSelected] = useState(false);
  const [appsMountableSelected, setAppsMountableSelected] = useState(false);
  const [appMountablesSelected, setAppMountablesSelected] = useState(0);
  const [mountedAppConfigs, setMountedAppConfigs] = useState<AppMountableConfig[]>([]);
  const [registeredMountableApps, setRegisteredMountableApps] = useState<RegisteredMountableApp[]>([]);
  const [isMountableAppsLoading, setIsMountableAppsLoading] = useState(false);
  const [mountableAppsError, setMountableAppsError] = useState("");
  const [selectedMountableAppId, setSelectedMountableAppId] = useState("");
  const [mountableAppInstallToken, setMountableAppInstallToken] = useState("");
  const [selectedMountablePrincipleIds, setSelectedMountablePrincipleIds] = useState<string[]>([]);
  const [isVerifyingMountableApp, setIsVerifyingMountableApp] = useState(false);
  const [mountableFormLinks, setMountableFormLinks] = useState<string[]>([""]);
  const [mountableLockFbars, setMountableLockFbars] = useState("");
  const [mountableFormValidationState, setMountableFormValidationState] = useState<"idle" | "validating" | "valid" | "invalid">("idle");
  const [mountableLockValidationState, setMountableLockValidationState] = useState<"idle" | "valid" | "invalid">("idle");
  const [isMountableFormFocused, setIsMountableFormFocused] = useState(false);
  const [isMountableLockFocused, setIsMountableLockFocused] = useState(false);
  const [isMountablesContinuing, setIsMountablesContinuing] = useState(false);
  const [mountablesPromptError, setMountablesPromptError] = useState("");
  const [isCreateDraftListOpen, setIsCreateDraftListOpen] = useState(false);
  const [pendingDraftSelectionId, setPendingDraftSelectionId] = useState<string | null>(null);
  const [pendingCloseAfterWalletConnect, setPendingCloseAfterWalletConnect] = useState(false);
  const [submissionSuccessTxHash, setSubmissionSuccessTxHash] = useState("");
  const [submissionSuccessPreimage, setSubmissionSuccessPreimage] = useState<string | null>(null);
  const [shouldResumeCreateModal, setShouldResumeCreateModal] = useState(false);

  const clearCreateHideTimer = useCallback(() => {
    if (createHideTimerRef.current) {
      clearTimeout(createHideTimerRef.current);
      createHideTimerRef.current = null;
    }
  }, []);

  const showCreateInfoModal = useCallback((mode: TMode) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setInfoModalMode(mode);
    setInfoModalInteraction?.("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, setInfoModalInteraction, setInfoModalMode, setIsInfoModalClosing, setShowInfoModal]);

  const openSaveDraftConfirmModal = useCallback(() => {
    setSaveDraftPromptError("");
    showCreateInfoModal("save-draft-confirm" as TMode);
  }, [showCreateInfoModal]);

  const loadRegisteredMountableApps = useCallback(async () => {
    setIsMountableAppsLoading(true);
    setMountableAppsError("");

    try {
      const response = await fetch("/api/mountables/apps", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        apps?: RegisteredMountableApp[];
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load mountable apps");
      }

      const nextApps = Array.isArray(payload?.apps) ? payload.apps : [];
      setRegisteredMountableApps(nextApps);
      return nextApps;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load mountable apps";
      setRegisteredMountableApps([]);
      setMountableAppsError(message);
      return [] as RegisteredMountableApp[];
    } finally {
      setIsMountableAppsLoading(false);
    }
  }, []);

  const openMountablesModal = useCallback(() => {
    const nextFormsMountable = createModalContentRef.current?.getFormsMountableConfig();
    const nextLockMountable = createModalContentRef.current?.getLockMountableConfig();
    const nextAppMountables = createModalContentRef.current?.getAppMountableConfigs() ?? [];
    const nextEnabledAppMountables = nextAppMountables.filter((entry) => entry.enabled);

    setFormsMountableSelected(Boolean(nextFormsMountable?.enabled));
    setLockMountableSelected(Boolean(nextLockMountable?.enabled));
    setAppsMountableSelected(nextEnabledAppMountables.length > 0);
    setAppMountablesSelected(nextEnabledAppMountables.length);
    setMountedAppConfigs(nextEnabledAppMountables);
    setSelectedMountableAppId("");
    setMountableAppInstallToken("");
    setSelectedMountablePrincipleIds([]);
    setMountableFormLinks([nextFormsMountable?.formUrl ?? ""]);
    setMountableLockFbars(nextLockMountable?.minimumFbars ?? "");
    setMountableFormValidationState("idle");
    setMountableLockValidationState("idle");
    setIsMountableFormFocused(false);
    setIsMountableLockFocused(false);
    setMountablesPromptError("");
    setMountableAppsError("");
    void loadRegisteredMountableApps();
    showCreateInfoModal("mountables" as TMode);
  }, [loadRegisteredMountableApps, showCreateInfoModal]);

  const handleSelectMountableAppId = useCallback((appId: string) => {
    setSelectedMountableAppId(appId);
    const selectedApp = registeredMountableApps.find((entry) => entry.appId === appId);
    setSelectedMountablePrincipleIds(selectedApp?.principles?.map((principle) => principle.principleId) ?? []);
    setMountableAppInstallToken("");
    setMountableAppsError("");
    setMountablesPromptError("");
  }, [registeredMountableApps]);

  const handleToggleSelectedMountablePrinciple = useCallback((principleId: string) => {
    setSelectedMountablePrincipleIds((current) => current.includes(principleId)
      ? current.filter((entry) => entry !== principleId)
      : [...current, principleId]);
    setMountablesPromptError("");
  }, []);

  const handleRemoveMountedAppConfig = useCallback((mountableInstanceId: string) => {
    const nextConfigs = (createModalContentRef.current?.getAppMountableConfigs() ?? [])
      .filter((entry) => entry.mountableInstanceId !== mountableInstanceId);
    const nextEnabledConfigs = nextConfigs.filter((entry) => entry.enabled);

    createModalContentRef.current?.setAppMountableConfigs(nextConfigs);
    setMountedAppConfigs(nextEnabledConfigs);
    setAppsMountableSelected(nextEnabledConfigs.length > 0);
    setAppMountablesSelected(nextEnabledConfigs.length);
    setMountablesPromptError("");
  }, []);

  const handleVerifySelectedMountableApp = useCallback(async () => {
    if (!selectedMountableAppId) {
      throw new Error("Choose an app to mount.");
    }

    if (!mountableAppInstallToken.trim()) {
      throw new Error("Enter the install token for this app.");
    }

    if (selectedMountablePrincipleIds.length === 0) {
      throw new Error("Select at least one principle for this app.");
    }

    const selectedApp = registeredMountableApps.find((entry) => entry.appId === selectedMountableAppId);
    if (!selectedApp) {
      throw new Error("Selected app is no longer available. Refresh the mountables list.");
    }

    setIsVerifyingMountableApp(true);
    setMountableAppsError("");
    setMountablesPromptError("");

    try {
      const response = await fetch("/api/mountables/apps/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appId: selectedMountableAppId,
          installToken: mountableAppInstallToken,
          selectedPrincipleIds: selectedMountablePrincipleIds,
          config: selectedApp.configDefaults,
          campaign: createModalContentRef.current?.getAppMountableCampaignContext() ?? null,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        appMountable?: AppMountableConfig;
        error?: string;
      } | null;
      if (!response.ok || !payload?.appMountable) {
        throw new Error(payload?.error ?? "Failed to verify mountable app");
      }

      const verifiedMountable = normalizeAppMountableConfig(payload.appMountable);
      if (!verifiedMountable.enabled || !verifiedMountable.appId) {
        throw new Error("Verified mountable app payload was incomplete");
      }

      const currentConfigs = createModalContentRef.current?.getAppMountableConfigs() ?? [];
      const nextConfigs = [
        ...currentConfigs.filter((entry) => entry.mountableInstanceId !== verifiedMountable.mountableInstanceId),
        verifiedMountable,
      ];
      const nextEnabledConfigs = nextConfigs.filter((entry) => entry.enabled);

      createModalContentRef.current?.setAppMountableConfigs(nextConfigs);
      setMountedAppConfigs(nextEnabledConfigs);
      setAppsMountableSelected(nextEnabledConfigs.length > 0);
      setAppMountablesSelected(nextEnabledConfigs.length);
      setSelectedMountableAppId("");
      setMountableAppInstallToken("");
      setSelectedMountablePrincipleIds([]);
      setMountablesPromptError("");
      setMountableAppsError("");
      return verifiedMountable;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify mountable app";
      setMountablesPromptError(message);
      throw error;
    } finally {
      setIsVerifyingMountableApp(false);
    }
  }, [mountableAppInstallToken, registeredMountableApps, selectedMountableAppId, selectedMountablePrincipleIds]);

  const transitionMountablesModal = useCallback((nextMode: Extract<TMode, string>) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setIsInfoModalClosing(true);
    window.setTimeout(() => {
      setInfoModalMode(nextMode);
      setIsInfoModalClosing(false);
      setShowInfoModal(true);
    }, Math.max(120, animationMs - 500));
  }, [animationMs, clearInfoCloseTimer, clearInfoHideTimer, setInfoModalMode, setIsInfoModalClosing, setShowInfoModal]);

  const finalizeCloseCreateModal = useCallback(() => {
    if (!showCreateModal || isCreateModalClosing) {
      return;
    }

    setIsCreateModalClosing(true);
    clearCreateHideTimer();
    createHideTimerRef.current = setTimeout(() => {
      setShowCreateModal(false);
      setIsCreateModalClosing(false);
      setCreateModalStep("compose");
      setPreviewError("");
      setSaveDraftPromptError("");
      setIsCreateDraftListOpen(false);
      createHideTimerRef.current = null;
    }, animationMs);
  }, [animationMs, clearCreateHideTimer, isCreateModalClosing, showCreateModal]);

  const openSubmissionSuccessInfoModal = useCallback((txHash: string, randomnessPreimage: string | null = null) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer?.();
    setSubmissionSuccessTxHash(txHash);
    setSubmissionSuccessPreimage(randomnessPreimage);
    setInfoModalMode("submission-success" as TMode);
    setInfoModalInteraction?.("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, setInfoModalInteraction, setInfoModalMode, setIsInfoModalClosing, setShowInfoModal]);

  const openCreateModal = useCallback(() => {
    clearCreateHideTimer();
    setIsCreateModalClosing(false);
    setCreateModalStep("compose");
    setPreviewError("");
    setSaveDraftPromptError("");
    setIsCreateDraftListOpen(false);
    setShowCreateModal(true);
  }, [clearCreateHideTimer]);

  useEffect(() => {
    if (!shouldResumeCreateModal || !showCreateModal) {
      return;
    }

    setShouldResumeCreateModal(false);
  }, [shouldResumeCreateModal, showCreateModal]);

  const requestCloseCreateModal = useCallback(() => {
    setPendingDraftSelectionId(null);
    setPendingCloseAfterWalletConnect(false);
    if (createModalContentRef.current?.hasDraftableChanges()) {
      openSaveDraftConfirmModal();
      return;
    }

    finalizeCloseCreateModal();
  }, [finalizeCloseCreateModal, openSaveDraftConfirmModal]);

  const handleDraftSelectionRequest = useCallback((draftId: string) => {
    setPendingCloseAfterWalletConnect(false);
    setPendingDraftSelectionId(draftId);
    if (createModalContentRef.current?.hasDraftableChanges()) {
      openSaveDraftConfirmModal();
      return;
    }

    createModalContentRef.current?.applyDraftSelection(draftId);
  }, [openSaveDraftConfirmModal]);

  const handleSaveDraftChoice = useCallback(async (shouldSave: boolean) => {
    try {
      if (!shouldSave) {
        if (pendingDraftSelectionId) {
          createModalContentRef.current?.applyDraftSelection(pendingDraftSelectionId);
          setPendingDraftSelectionId(null);
          closeInfoModal();
          return;
        }

        setPendingDraftSelectionId(null);
        setPendingCloseAfterWalletConnect(false);
        closeInfoModal();
        finalizeCloseCreateModal();
        return;
      }

      try {
        await createModalContentRef.current?.saveDraftFromClose();
      } catch (error) {
        if (error instanceof Error && error.message === "Connect wallet to manage drafts") {
          setPendingCloseAfterWalletConnect(!pendingDraftSelectionId);
          openWallet();
          return;
        }
        throw error;
      }

      if (pendingDraftSelectionId) {
        createModalContentRef.current?.applyDraftSelection(pendingDraftSelectionId);
        setPendingDraftSelectionId(null);
        closeInfoModal();
        return;
      }

      createModalContentRef.current?.discardDraftSession();
      setPendingCloseAfterWalletConnect(false);
      closeInfoModal();
      finalizeCloseCreateModal();
    } catch (error) {
      setSaveDraftPromptError(error instanceof Error ? error.message : "Failed to save draft");
    }
  }, [closeInfoModal, finalizeCloseCreateModal, openWallet, pendingDraftSelectionId]);

  const resetCreateModal = useCallback(() => {
    setCreateModalStep("compose");
    setPreviewError("");
    setCreateResetSignal((current) => current + 1);
  }, []);

  const handleCreateTopRightAction = useCallback(() => {
    if (createModalStep === "review") {
      setCreateStepBackSignal((current) => current + 1);
      setCreateModalStep("compose");
      setPreviewError("");
      return;
    }

    void createModalContentRef.current?.toggleDraftList().catch(() => undefined);
  }, [createModalStep]);

  useEffect(() => {
    return () => {
      clearCreateHideTimer();
    };
  }, [clearCreateHideTimer]);

  useEffect(() => {
    if (!pendingCloseAfterWalletConnect || !signer) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await createModalContentRef.current?.saveDraftFromClose();
        if (cancelled) {
          return;
        }
        createModalContentRef.current?.discardDraftSession();
        setPendingCloseAfterWalletConnect(false);
        closeInfoModal();
        finalizeCloseCreateModal();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSaveDraftPromptError(error instanceof Error ? error.message : "Failed to save draft");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [closeInfoModal, finalizeCloseCreateModal, pendingCloseAfterWalletConnect, signer]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const hasGoogleLinkCode = Boolean(url.searchParams.get("google_link_code")?.trim());
    if (!hasGoogleLinkCode) {
      return;
    }

    const storedValue = window.sessionStorage.getItem(CREATE_MODAL_RESUME_STORAGE_KEY);
    if (!storedValue) {
      return;
    }

    try {
      const parsed = JSON.parse(storedValue) as {
        savedAt?: number;
        path?: string;
      };
      const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : Number.NaN;
      const path = typeof parsed.path === "string" ? parsed.path : "";
      const sanitizedUrl = new URL(window.location.href);
      sanitizedUrl.searchParams.delete("google_link_code");
      const currentPath = `${sanitizedUrl.pathname}${sanitizedUrl.search}${sanitizedUrl.hash}`;
      const isExpired = !Number.isFinite(savedAt) || Date.now() - savedAt > CREATE_MODAL_RESUME_MAX_AGE_MS;
      if (isExpired || path !== currentPath) {
        return;
      }

      setShouldResumeCreateModal(true);
      clearCreateHideTimer();
      setIsCreateModalClosing(false);
      setCreateModalStep("compose");
      setPreviewError("");
      setSaveDraftPromptError("");
      setIsCreateDraftListOpen(false);
      setShowCreateModal(true);
    } catch {
      // Ignore malformed resume state; the modal can still be opened manually.
    }
  }, [clearCreateHideTimer]);

  useEffect(() => {
    if (!showCreateModal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showCreateModal]);

  const resetCreateInfoModalState = useCallback(() => {
    setInfoModalMode(initialInfoModalMode);
    setSaveDraftPromptError("");
    setSubmissionSuccessTxHash("");
    setSubmissionSuccessPreimage(null);
    setMountablesPromptError("");
    setMountableAppsError("");
    setSelectedMountableAppId("");
    setMountableAppInstallToken("");
    setSelectedMountablePrincipleIds([]);
    setIsVerifyingMountableApp(false);
  }, [initialInfoModalMode, setInfoModalMode]);

  return {
    appsMountableSelected,
    appMountablesSelected,
    constraintStatus,
    createModalContentRef,
    createModalStep,
    createResetSignal,
    createStepBackSignal,
    finalizeCloseCreateModal,
    formsMountableSelected,
    handleCreateTopRightAction,
    handleDraftSelectionRequest,
    handleRemoveMountedAppConfig,
    handleSaveDraftChoice,
    handleSelectMountableAppId,
    handleToggleSelectedMountablePrinciple,
    handleVerifySelectedMountableApp,
    isCreateDraftListOpen,
    isCreateModalClosing,
    isMountableAppsLoading,
    isMountableFormFocused,
    isMountableLockFocused,
    isMountablesContinuing,
    isVerifyingMountableApp,
    lockMountableSelected,
    mountedAppConfigs,
    mountableAppInstallToken,
    mountableAppsError,
    mountableFormLinks,
    mountableLockFbars,
    mountableFormValidationState,
    mountableLockValidationState,
    mountablesPromptError,
    openCreateModal,
    openMountablesModal,
    openSubmissionSuccessInfoModal,
    previewError,
    registeredMountableApps,
    requestCloseCreateModal,
    resetCreateInfoModalState,
    resetCreateModal,
    saveDraftPromptError,
    selectedMountableAppId,
    selectedMountablePrincipleIds,
    setAppMountablesSelected,
    setAppsMountableSelected,
    setConstraintStatus,
    setCreateModalStep,
    setFormsMountableSelected,
    setIsCreateDraftListOpen,
    setIsMountableFormFocused,
    setIsMountableLockFocused,
    setIsMountablesContinuing,
    setLockMountableSelected,
    setMountedAppConfigs,
    setMountableAppInstallToken,
    setMountableAppsError,
    setMountableFormLinks,
    setMountableLockFbars,
    setMountableFormValidationState,
    setMountableLockValidationState,
    setMountablesPromptError,
    setPreviewError,
    setSaveDraftPromptError,
    setSelectedMountableAppId,
    setSelectedMountablePrincipleIds,
    setSubmissionSuccessPreimage,
    setSubmissionSuccessTxHash,
    showCreateModal,
    submissionSuccessPreimage,
    submissionSuccessTxHash,
    transitionMountablesModal,
  };
}
