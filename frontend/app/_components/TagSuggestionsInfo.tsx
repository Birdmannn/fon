"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type TagUserSuggestion = {
  username: string;
  handle: string;
  displayName: string;
};

type TagSuggestionsInfoProps = {
  initialQuery: string;
  onContinue: (tag: string) => void;
};

type CommittedTag = {
  id: number;
  value: string;
  label: string;
  kind: "builtin" | "user" | "missing" | null;
};

const BUILT_IN_TAGS = [
  { tag: "approve", explanation: "Users listed after this tag approve commencement." },
  { tag: "claim", explanation: "Users listed after this tag can claim the freight." },
  { tag: "receive", explanation: "Users listed after this tag receive the delivery." },
];
const BUILT_IN_TAG_NAMES = new Set(BUILT_IN_TAGS.map((entry) => entry.tag));

function normalizeTag(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function getTagConstraintError(tags: string[], allowTrailingEmptyOperation = false) {
  const operationGroups: Array<{ operation: string; users: string[] }> = [];
  let activeGroup: { operation: string; users: string[] } | null = null;

  for (const rawTag of tags) {
    const tag = normalizeTag(rawTag).toLowerCase();
    if (!tag) continue;

    if (BUILT_IN_TAG_NAMES.has(tag)) {
      activeGroup = { operation: tag, users: [] };
      operationGroups.push(activeGroup);
      continue;
    }

    if (!activeGroup) continue;
    if (activeGroup.users.includes(tag)) {
      return `Duplicate @${tag} in @${activeGroup.operation}.`;
    }
    activeGroup.users.push(tag);
  }

  for (const operation of BUILT_IN_TAG_NAMES) {
    const matchingGroups = operationGroups.filter((group) => group.operation === operation);
    if (matchingGroups.length < 2) continue;
    const trailingGroup = operationGroups.at(-1);
    if (matchingGroups.some((group) => (
      group.users.length === 0
      && !(allowTrailingEmptyOperation && group === trailingGroup)
    ))) {
      return `@${operation} needs a user.`;
    }

    const seenUsers = new Set<string>();
    for (const group of matchingGroups) {
      for (const user of group.users) {
        if (seenUsers.has(user)) {
          return `@${user} repeats in @${operation}.`;
        }
        seenUsers.add(user);
      }
    }
  }

  return "";
}

export default function TagSuggestionsInfo({ initialQuery, onContinue }: TagSuggestionsInfoProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextTagIdRef = useRef(1);
  const [committedTags, setCommittedTags] = useState<CommittedTag[]>([]);
  const [draftTag, setDraftTag] = useState(() => normalizeTag(initialQuery));
  const [users, setUsers] = useState<TagUserSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [commitError, setCommitError] = useState("");
  const query = draftTag;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      void fetch(`/api/user-profiles/suggestions?query=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(payload?.error ?? "Failed to load users");
          setUsers(Array.isArray(payload?.users) ? payload.users : []);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setUsers([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  const builtIns = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    return BUILT_IN_TAGS.filter((entry) => !normalizedQuery || entry.tag.startsWith(normalizedQuery));
  }, [query]);
  const enteredTags = useMemo(
    () => [...committedTags.map((tag) => tag.value), normalizeTag(draftTag)].filter(Boolean),
    [committedTags, draftTag]
  );
  const tagConstraintError = useMemo(() => getTagConstraintError(enteredTags, true), [enteredTags]);
  const displayedTagError = commitError || tagConstraintError;

  const submit = () => {
    if (displayedTagError) return;
    const submitError = getTagConstraintError(enteredTags);
    if (submitError) {
      setCommitError(submitError);
      return;
    }
    onContinue(enteredTags.map((tag) => `@${tag}`).join(" "));
  };

  const commitTag = (candidate: string, displayLabel?: string) => {
    const value = normalizeTag(candidate);
    if (!value) return;
    const candidateError = getTagConstraintError([...committedTags.map((tag) => tag.value), value], true);
    if (candidateError) {
      setCommitError(candidateError);
      return;
    }

    const id = nextTagIdRef.current;
    nextTagIdRef.current += 1;
    const isBuiltIn = BUILT_IN_TAGS.some((entry) => entry.tag === value.toLowerCase());
    setCommittedTags((current) => [...current, {
      id,
      value,
      label: displayLabel?.trim() || `@${value}`,
      kind: isBuiltIn ? "builtin" : null,
    }]);
    setDraftTag("");
    setCommitError("");
    window.setTimeout(() => inputRef.current?.focus(), 0);

    if (isBuiltIn) return;

    void fetch(`/api/user-profiles/suggestions?query=${encodeURIComponent(value)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        const suggestions = response.ok && Array.isArray(payload?.users)
          ? payload.users as TagUserSuggestion[]
          : [];
        const matchingUser = suggestions.find((user) => normalizeTag(user.handle).toLowerCase() === value.toLowerCase());
        setCommittedTags((current) => current.map((tag) => tag.id === id ? {
          ...tag,
          kind: matchingUser ? "user" : "missing",
          label: matchingUser?.displayName?.trim() || tag.label,
        } : tag));
      })
      .catch(() => {
        setCommittedTags((current) => current.map((tag) => tag.id === id ? { ...tag, kind: "missing" } : tag));
      });
  };

  const selectSuggestion = (suggestion: string, displayLabel?: string) => {
    commitTag(suggestion, displayLabel);
  };

  const commitDraftTag = () => {
    commitTag(draftTag);
  };

  return (
    <form
      id="tag-suggestions-form"
      className="create-info-constraints-copy tag-suggestions-panel"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="tag-suggestions-title-row">
        <p className="mt-3 create-review-section-label text-gray-900">Tags:</p>
        {displayedTagError ? (
          <p className="mt-3 create-review-section-label tag-suggestions-error" role="alert">{displayedTagError}</p>
        ) : null}
      </div>
      <div
        className="create-info-ticket-input tag-suggestions-input-row"
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("input, button")) return;
          event.preventDefault();
          const input = inputRef.current;
          input?.focus();
          const end = input?.value.length ?? 0;
          input?.setSelectionRange(end, end);
        }}
      >
        {committedTags.map((tag) => (
          <span
            className={`tag-suggestions-label ${tag.kind === "builtin" ? "tag-suggestions-label-builtin" : tag.kind === "user" ? "tag-suggestions-label-user" : "tag-suggestions-label-missing"}`}
            key={tag.id}
          >
            <button
              type="button"
              className="tag-suggestions-label-remove"
              aria-label={`Remove @${tag.value}`}
              onClick={() => {
                setCommittedTags((current) => current.filter((entry) => entry.id !== tag.id));
                setCommitError("");
              }}
            >
              <X size={12} strokeWidth={2.5} aria-hidden="true" />
            </button>
            <span>{tag.label}</span>
          </span>
        ))}
        <span className="tag-suggestions-token">
          <span className="tag-suggestions-input-prefix" aria-hidden="true">@</span>
          <input
            ref={inputRef}
            id="tag-suggestion-input"
            value={draftTag}
            size={Math.max(1, draftTag.length)}
            onChange={(event) => {
              setDraftTag(normalizeTag(event.target.value));
              setCommitError("");
            }}
            onKeyDown={(event) => {
              if (event.key === " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                commitDraftTag();
                return;
              }
              if (event.key === "Backspace" && !draftTag && committedTags.length > 0) {
                event.preventDefault();
                setCommittedTags((current) => current.slice(0, -1));
                setCommitError("");
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }
            }}
            className="tag-suggestions-input"
            autoComplete="off"
            aria-label="Search tags and users"
          />
        </span>
      </div>

      <p className="create-review-section-label text-gray-900 tag-suggestions-heading">Suggestions:</p>
      <div className="tag-suggestions-list" role="listbox" aria-label="Tag suggestions">
        {builtIns.map((entry) => (
          <button
            key={entry.tag}
            type="button"
            className={`tag-suggestion-row tag-suggestion-row-built-in${entry.tag === "receive" ? " tag-suggestion-row-unavailable" : ""}`}
            disabled={entry.tag === "receive"}
            onClick={() => selectSuggestion(entry.tag)}
            role="option"
            aria-disabled={entry.tag === "receive"}
            aria-selected={entry.tag !== "receive" && query.toLowerCase() === entry.tag}
          >
            <span className="tag-suggestion-copy">
              <span className="tag-suggestion-label">@{entry.tag}:</span>
              <span className="tag-suggestion-explanation"> {entry.explanation}</span>
            </span>
            {entry.tag === "receive" ? <span className="tag-suggestion-unavailable-status">Not available</span> : null}
          </button>
        ))}
        {users.map((user) => (
          <button
            key={user.username}
            type="button"
            className="tag-suggestion-row tag-suggestion-row-user"
            onClick={() => selectSuggestion(user.handle, user.displayName || user.handle)}
            role="option"
            aria-selected={query.toLowerCase() === user.handle.replace(/^@/, "").toLowerCase()}
          >
            <span className="tag-suggestion-label">{user.handle}:</span>
            <span className="tag-suggestion-explanation"> {user.displayName || "Registered FON user"}</span>
          </button>
        ))}
        {!isLoading && builtIns.length === 0 && users.length === 0 ? (
          <p className="tag-suggestions-empty">No matching suggestions. Continue to use this tag.</p>
        ) : null}
      </div>
    </form>
  );
}
