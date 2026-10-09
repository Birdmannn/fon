"use client";

import { RefreshCw, Search } from "lucide-react";
import { useLayoutEffect, useRef, type RefObject } from "react";

import ThreeDotLoader from "@/app/_components/ThreeDotLoader";

type CampaignFeedHeaderBarProps = {
  isLoading?: boolean;
  isRefreshing: boolean;
  isSearchOpen: boolean;
  onRefresh: () => void;
  onSearchClick: () => void;
  onSearchQueryChange: (value: string) => void;
  onShowPendingCampaigns: () => void;
  pendingBadgeLabel: string | null;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
};

export default function CampaignFeedHeaderBar({
  isLoading = false,
  isRefreshing,
  isSearchOpen,
  onRefresh,
  onSearchClick,
  onSearchQueryChange,
  onShowPendingCampaigns,
  pendingBadgeLabel,
  searchInputRef,
  searchQuery,
}: CampaignFeedHeaderBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const shell = bar?.parentElement;
    const header = shell?.querySelector<HTMLElement>(".campaign-shell-header");
    if (!bar || !shell || !header) return;

    const updateOffset = () => {
      const headerBottom = header.getBoundingClientRect().bottom;
      bar.style.setProperty("--campaign-feed-sticky-top", `${headerBottom}px`);
      shell.style.setProperty("--campaign-feed-scroll-offset", `${headerBottom + bar.offsetHeight + 4}px`);
    };

    const observer = new ResizeObserver(updateOffset);
    observer.observe(header);
    observer.observe(bar);
    window.addEventListener("resize", updateOffset);
    updateOffset();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
      shell.style.removeProperty("--campaign-feed-scroll-offset");
    };
  }, []);

  return (
    <div ref={barRef} className="campaign-header-bar campaign-header-bar-sticky">
      <div className="campaign-heading-block">
        <div className="campaign-heading-row">
          <h2 className="text-lg sm:text-xl font-semibold">Freights</h2>
          {pendingBadgeLabel && (
            <button
              type="button"
              className="campaign-refresh-badge"
              onClick={onShowPendingCampaigns}
              aria-label={`Show ${pendingBadgeLabel} new freights`}
            >
              {pendingBadgeLabel}
            </button>
          )}
        </div>
        {isLoading ? <ThreeDotLoader inline label="Loading freights" /> : null}
      </div>
      <div className="campaign-header-actions">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="campaign-action-btn"
          data-tooltip="Refresh freights"
        >
          <span className={`campaign-refresh-icon-wrap ${isRefreshing ? "refreshing" : ""}`}>
            <RefreshCw className="campaign-action-icon" size={24} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
        <div className={`campaign-search-wrapper ${isSearchOpen ? "active" : ""}`}>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search freights..."
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="campaign-search-input"
          />
        </div>
        <button
          onClick={onSearchClick}
          className="campaign-action-btn"
          data-tooltip="Search freights"
        >
          <Search className="campaign-action-icon" size={24} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
