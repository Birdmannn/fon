import { RefreshCw, Search } from "lucide-react";
import type { RefObject } from "react";

type CampaignFeedHeaderBarProps = {
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
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
      <div className="flex items-center gap-2 justify-end">
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
