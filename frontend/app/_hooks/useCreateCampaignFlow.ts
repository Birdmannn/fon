"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CREATE_MODAL_RESUME_MAX_AGE_MS,
  CREATE_MODAL_RESUME_STORAGE_KEY,
  type CreateCampaignModalContentHandle,
  type CreateConstraintStatus,
  type CreateModalStep,
} from "@/app/create/_components/CreateCampaignModalContent";
import { normalizeAppMountableConfig } from "@/app/_lib/appMountable";
import type { AppMountableConfig, RegisteredMountableApp } from "@/app/_types/appMountable";
import type { LockMountableRule } from "@/app/_types/lockMountable";
import type { MountableJsonObject, MountableJsonValue } from "@/lib/fonMountablesSdk";

type UseCreateCampaignFlowArgs<TMode extends string> = {
  animationMs: number;
  createErrorInfoModalMode: TMode;
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

type MountableSelectionState = {
  hasMountedHashtag: boolean;
  formsSelected: boolean;
  lockSelected: boolean;
  appMountablesSelected: number;
};

type MountableSetupStep = {
  key: string;
  label: string;
  mode: "mountables-forms" | "mountables-lock" | "mountables-apps";
  appId?: string;
};

export function useCreateCampaignFlow<TMode extends string>({
  animationMs,
  createErrorInfoModalMode,
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
  const createErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeInfoModalRef = useRef(closeInfoModal);
  closeInfoModalRef.current = closeInfoModal;
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
  const [selectedMountableAppIds, setSelectedMountableAppIds] = useState<string[]>([]);
  const [isMountableAppsLoading, setIsMountableAppsLoading] = useState(false);
  const [mountableAppsError, setMountableAppsError] = useState("");
  const [selectedMountableAppId, setSelectedMountableAppId] = useState("");
  const [selectedMountablePrincipleIds, setSelectedMountablePrincipleIds] = useState<string[]>([]);
  const [selectedMountablePrincipleParams, setSelectedMountablePrincipleParams] = useState<Record<string, MountableJsonObject>>({});
  const [isVerifyingMountableApp, setIsVerifyingMountableApp] = useState(false);
  const [mountableFormLinks, setMountableFormLinks] = useState<string[]>([""]);
  const [mountableLockFbars, setMountableLockFbars] = useState("");
  const [mountableLockRule, setMountableLockRule] = useState<LockMountableRule>("block_below");
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

  const handleCreateErrorChange = useCallback((message: string) => {
    setPreviewError(message);
    if (!message) return;

    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer?.();
    if (createErrorTimerRef.current) clearTimeout(createErrorTimerRef.current);
    setInfoModalMode(createErrorInfoModalMode);
    setInfoModalInteraction?.("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    createErrorTimerRef.current = setTimeout(() => {
      closeInfoModalRef.current();
      createErrorTimerRef.current = null;
    }, 3000);
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, createErrorInfoModalMode, setInfoModalInteraction, setInfoModalMode, setIsInfoModalClosing, setShowInfoModal]);

  useEffect(() => () => {
    if (createErrorTimerRef.current) clearTimeout(createErrorTimerRef.current);
  }, []);

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
    setSelectedMountableAppIds([...new Set(nextAppMountables.map((entry) => entry.appId).filter(Boolean))]);
    setSelectedMountableAppId("");
    setSelectedMountablePrincipleIds([]);
    setSelectedMountablePrincipleParams({});
    setMountableFormLinks([nextFormsMountable?.formUrl ?? ""]);
    setMountableLockFbars(nextLockMountable?.minimumFbars ?? "");
    setMountableLockRule(nextLockMountable?.rule ?? "block_below");
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
    const existingConfig = createModalContentRef.current?.getAppMountableConfigs().find((entry) => entry.appId === appId);
    const existingSelections = existingConfig?.enabled ? existingConfig.selectedPrinciples : [];
    setSelectedMountablePrincipleIds(existingSelections.map((principle) => principle.principleId));
    setSelectedMountablePrincipleParams(Object.fromEntries((selectedApp?.principles ?? []).map((principle) => {
      const existing = existingSelections.find((entry) => entry.principleId === principle.principleId);
      return [principle.principleId, { ...principle.paramsDefaults, ...(existing?.params ?? {}) }];
    })));
    setMountableAppsError("");
    setMountablesPromptError("");
  }, [registeredMountableApps]);

  const handleToggleMountableAppSelection = useCallback((appId: string) => {
    if (!appId) {
      return;
    }

    if (!selectedMountableAppIds.includes(appId)) {
      const selectedApp = registeredMountableApps.find((entry) => entry.appId === appId);
      const currentConfigs = createModalContentRef.current?.getAppMountableConfigs() ?? [];
      if (selectedApp && !currentConfigs.some((entry) => entry.appId === appId)) {
        const pendingConfig = normalizeAppMountableConfig({
          enabled: false,
          appId: selectedApp.appId,
          appName: selectedApp.appName,
          description: selectedApp.description,
          sdkVersion: selectedApp.sdkVersion,
          appUrl: selectedApp.appUrl,
          logoUrl: selectedApp.logoUrl,
          iconUrl: selectedApp.iconUrl,
          principles: selectedApp.principles,
          config: selectedApp.configDefaults,
          status: "pending",
        });
        createModalContentRef.current?.setAppMountableConfigs([...currentConfigs, pendingConfig]);
      }
      setSelectedMountableAppIds((current) => [...current, appId]);
      setMountablesPromptError("");
      return;
    }

    const nextConfigs = (createModalContentRef.current?.getAppMountableConfigs() ?? [])
      .filter((entry) => entry.appId !== appId);
    const nextEnabledConfigs = nextConfigs.filter((entry) => entry.enabled);

    createModalContentRef.current?.setAppMountableConfigs(nextConfigs);
    setMountedAppConfigs(nextEnabledConfigs);
    setAppsMountableSelected(nextEnabledConfigs.length > 0);
    setAppMountablesSelected(nextEnabledConfigs.length);
    setSelectedMountableAppIds((current) => current.filter((entry) => entry !== appId));
    if (selectedMountableAppId === appId) {
      setSelectedMountableAppId("");
      setSelectedMountablePrincipleIds([]);
      setSelectedMountablePrincipleParams({});
    }
    setMountablesPromptError("");
  }, [registeredMountableApps, selectedMountableAppId, selectedMountableAppIds]);

  const handleToggleSelectedMountablePrinciple = useCallback((principleId: string) => {
    const definition = registeredMountableApps
      .find((entry) => entry.appId === selectedMountableAppId)
      ?.principles.find((entry) => entry.principleId === principleId);
    setSelectedMountablePrincipleParams((params) => ({
      ...params,
      [principleId]: { ...(definition?.paramsDefaults ?? {}), ...(params[principleId] ?? {}) },
    }));
    setSelectedMountablePrincipleIds((current) => current.includes(principleId)
      ? current.filter((entry) => entry !== principleId)
      : [...current, principleId]);
    setMountablesPromptError("");
  }, [registeredMountableApps, selectedMountableAppId]);

  const handleUpdateSelectedMountablePrincipleParam = useCallback((principleId: string, paramKey: string, value: MountableJsonValue) => {
    setSelectedMountablePrincipleParams((current) => ({
      ...current,
      [principleId]: {
        ...(current[principleId] ?? {}),
        [paramKey]: value,
      },
    }));
    setMountablesPromptError("");
  }, []);

  const handleRemoveMountedAppConfig = useCallback((mountableInstanceId: string) => {
    const currentConfigs = createModalContentRef.current?.getAppMountableConfigs() ?? [];
    const removedConfig = currentConfigs.find((entry) => entry.mountableInstanceId === mountableInstanceId);
    const nextConfigs = currentConfigs.filter((entry) => entry.mountableInstanceId !== mountableInstanceId);
    const nextEnabledConfigs = nextConfigs.filter((entry) => entry.enabled);

    createModalContentRef.current?.setAppMountableConfigs(nextConfigs);
    setMountedAppConfigs(nextEnabledConfigs);
    setAppsMountableSelected(nextEnabledConfigs.length > 0);
    setAppMountablesSelected(nextEnabledConfigs.length);
    if (removedConfig?.appId) {
      setSelectedMountableAppIds((current) => current.filter((entry) => entry !== removedConfig.appId));
    }
    setMountablesPromptError("");
  }, []);

  const handleMountableSelectionStateChange = useCallback((state: MountableSelectionState) => {
    const nextAppMountables = createModalContentRef.current?.getAppMountableConfigs() ?? [];
    const nextEnabledAppMountables = nextAppMountables.filter((entry) => entry.enabled);

    setFormsMountableSelected(state.formsSelected);
    setLockMountableSelected(state.lockSelected);
    setAppsMountableSelected(state.appMountablesSelected > 0);
    setAppMountablesSelected(state.appMountablesSelected);
    setMountedAppConfigs((current) => (
      current.length === nextEnabledAppMountables.length
      && current.every((entry, index) => entry === nextEnabledAppMountables[index])
        ? current
        : nextEnabledAppMountables
    ));
    if (!state.hasMountedHashtag && state.appMountablesSelected === 0) {
      setMountablesPromptError("");
    }
  }, []);

  const handleVerifySelectedMountableApp = useCallback(async () => {
    if (!selectedMountableAppId) {
      throw new Error("Choose an app to mount.");
    }

    if (selectedMountablePrincipleIds.length === 0) {
      throw new Error("Select at least one principle for this app.");
    }

    const selectedApp = registeredMountableApps.find((entry) => entry.appId === selectedMountableAppId);
    if (!selectedApp) {
      throw new Error("Selected app is no longer available. Refresh the mountables list.");
    }

    for (const principleId of selectedMountablePrincipleIds) {
      const principle = selectedApp.principles.find((entry) => entry.principleId === principleId);
      if (!principle) continue;
      const params = { ...principle.paramsDefaults, ...(selectedMountablePrincipleParams[principleId] ?? {}) };
      for (const definition of principle.paramsSchema) {
        const value = params[definition.paramKey];
        if (definition.required && (value === null || value === undefined || (typeof value === "string" && !value.trim()))) {
          throw new Error(`${definition.title} is required for ${principle.title}.`);
        }
      }
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
          selectedPrincipleIds: selectedMountablePrincipleIds,
          selectedPrinciples: selectedMountablePrincipleIds.map((principleId) => ({
            principleId,
            params: selectedMountablePrincipleParams[principleId] ?? {},
            required: true,
          })),
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
        ...currentConfigs.filter((entry) => entry.appId !== verifiedMountable.appId),
        verifiedMountable,
      ];
      const nextEnabledConfigs = nextConfigs.filter((entry) => entry.enabled);

      createModalContentRef.current?.setAppMountableConfigs(nextConfigs);
      setMountedAppConfigs(nextEnabledConfigs);
      setAppsMountableSelected(nextEnabledConfigs.length > 0);
      setAppMountablesSelected(nextEnabledConfigs.length);
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
  }, [registeredMountableApps, selectedMountableAppId, selectedMountablePrincipleIds, selectedMountablePrincipleParams]);

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

  const mountableSetupSteps = useMemo<MountableSetupStep[]>(() => [
    ...(formsMountableSelected ? [{ key: "forms", label: "Forms", mode: "mountables-forms" as const }] : []),
    ...(lockMountableSelected ? [{ key: "lock", label: "Lock", mode: "mountables-lock" as const }] : []),
    ...selectedMountableAppIds.map((appId) => {
      const app = registeredMountableApps.find((entry) => entry.appId === appId);
      return {
        key: `app:${appId}`,
        label: app?.appName?.trim() || appId,
        mode: "mountables-apps" as const,
        appId,
      };
    }),
  ].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })), [formsMountableSelected, lockMountableSelected, registeredMountableApps, selectedMountableAppIds]);

  const openMountableSetupStep = useCallback((step: (typeof mountableSetupSteps)[number]) => {
    if (step.appId) {
      handleSelectMountableAppId(step.appId);
    }
    transitionMountablesModal(step.mode as Extract<TMode, string>);
    setMountablesPromptError("");
  }, [handleSelectMountableAppId, transitionMountablesModal]);

  const beginMountableSetup = useCallback(() => {
    const firstStep = mountableSetupSteps[0];
    if (!firstStep) {
      setMountablesPromptError("Select a mountable to continue.");
      return false;
    }
    openMountableSetupStep(firstStep);
    return true;
  }, [mountableSetupSteps, openMountableSetupStep]);

  const advanceMountableSetup = useCallback((currentKey: string) => {
    const currentIndex = mountableSetupSteps.findIndex((step) => step.key === currentKey);
    const nextStep = currentIndex >= 0 ? mountableSetupSteps[currentIndex + 1] : undefined;
    if (!nextStep) {
      return false;
    }
    openMountableSetupStep(nextStep);
    return true;
  }, [mountableSetupSteps, openMountableSetupStep]);

  const goBackMountableSetup = useCallback((currentKey: string) => {
    const currentIndex = mountableSetupSteps.findIndex((step) => step.key === currentKey);
    const previousStep = currentIndex > 0 ? mountableSetupSteps[currentIndex - 1] : undefined;
    if (previousStep) {
      openMountableSetupStep(previousStep);
      return;
    }
    transitionMountablesModal("mountables" as Extract<TMode, string>);
    setMountablesPromptError("");
  }, [mountableSetupSteps, openMountableSetupStep, transitionMountablesModal]);

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
    setPreviewError("");
    setSelectedMountableAppIds([]);
    setSelectedMountableAppId("");
    setSelectedMountablePrincipleIds([]);
    setSelectedMountablePrincipleParams({});
    setIsVerifyingMountableApp(false);
  }, [initialInfoModalMode, setInfoModalMode]);

  return {
    advanceMountableSetup,
    appsMountableSelected,
    appMountablesSelected,
    beginMountableSetup,
    constraintStatus,
    createModalContentRef,
    createModalStep,
    createResetSignal,
    createStepBackSignal,
    finalizeCloseCreateModal,
    formsMountableSelected,
    handleCreateTopRightAction,
    handleCreateErrorChange,
    handleDraftSelectionRequest,
    handleMountableSelectionStateChange,
    handleRemoveMountedAppConfig,
    handleSaveDraftChoice,
    handleSelectMountableAppId,
    handleToggleSelectedMountablePrinciple,
    handleUpdateSelectedMountablePrincipleParam,
    handleToggleMountableAppSelection,
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
    mountableAppsError,
    mountableFormLinks,
    mountableLockFbars,
    mountableLockRule,
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
    selectedMountableAppIds,
    selectedMountablePrincipleIds,
    selectedMountablePrincipleParams,
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
    setMountableAppsError,
    setMountableFormLinks,
    setMountableLockFbars,
    setMountableLockRule,
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
    goBackMountableSetup,
  };
}
