"use client";

import { useCallback, useRef, useState } from "react";

type UseInfoModalStateArgs = {
  animationMs: number;
  onResetState: () => void;
};

export function useInfoModalState({ animationMs, onResetState }: UseInfoModalStateArgs) {
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isInfoModalClosing, setIsInfoModalClosing] = useState(false);
  const [infoModalInteraction, setInfoModalInteraction] = useState<"hover" | "click">("hover");
  const infoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submissionSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearInfoCloseTimer = useCallback(() => {
    if (infoCloseTimerRef.current) {
      clearTimeout(infoCloseTimerRef.current);
      infoCloseTimerRef.current = null;
    }
  }, []);

  const clearInfoHideTimer = useCallback(() => {
    if (infoHideTimerRef.current) {
      clearTimeout(infoHideTimerRef.current);
      infoHideTimerRef.current = null;
    }
  }, []);

  const clearSubmissionSuccessTimer = useCallback(() => {
    if (submissionSuccessTimerRef.current) {
      clearTimeout(submissionSuccessTimerRef.current);
      submissionSuccessTimerRef.current = null;
    }
  }, []);

  const showInfoModalForInteraction = useCallback((interaction: "hover" | "click") => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    onResetState();
    setInfoModalInteraction(interaction);
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, onResetState]);

  const openInfoModalFromHover = useCallback((preventHoverOpen: boolean) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();

    if (preventHoverOpen) {
      return;
    }

    if (showInfoModal && infoModalInteraction === "click" && !isInfoModalClosing) {
      return;
    }

    showInfoModalForInteraction("hover");
  }, [clearInfoCloseTimer, clearInfoHideTimer, infoModalInteraction, isInfoModalClosing, showInfoModal, showInfoModalForInteraction]);

  const keepInfoModalOpen = useCallback(() => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer]);

  const closeInfoModal = useCallback((onBeforeHide?: () => void) => {
    clearInfoCloseTimer();
    clearSubmissionSuccessTimer();

    if (!showInfoModal || isInfoModalClosing) return;

    setIsInfoModalClosing(true);
    clearInfoHideTimer();
    infoHideTimerRef.current = setTimeout(() => {
      onBeforeHide?.();
      setShowInfoModal(false);
      setIsInfoModalClosing(false);
      setInfoModalInteraction("hover");
      onResetState();
      infoHideTimerRef.current = null;
    }, animationMs);
  }, [animationMs, clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, isInfoModalClosing, onResetState, showInfoModal]);

  const scheduleCloseInfoModal = useCallback((preventAutoClose: boolean, onBeforeHide?: () => void) => {
    if (preventAutoClose) {
      return;
    }

    clearInfoCloseTimer();
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal(onBeforeHide);
    }, 120);
  }, [clearInfoCloseTimer, closeInfoModal]);

  const toggleInfoModal = useCallback((preventToggleClose: boolean) => {
    if (preventToggleClose) {
      return;
    }

    if (showInfoModal && !isInfoModalClosing) {
      closeInfoModal();
      return;
    }

    showInfoModalForInteraction("click");
  }, [closeInfoModal, isInfoModalClosing, showInfoModal, showInfoModalForInteraction]);

  return {
    clearInfoCloseTimer,
    clearInfoHideTimer,
    clearSubmissionSuccessTimer,
    closeInfoModal,
    infoCloseTimerRef,
    infoHideTimerRef,
    infoModalInteraction,
    isInfoModalClosing,
    openInfoModalFromHover,
    scheduleCloseInfoModal,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
    showInfoModal,
    showInfoModalForInteraction,
    submissionSuccessTimerRef,
    toggleInfoModal,
    keepInfoModalOpen,
  };
}
