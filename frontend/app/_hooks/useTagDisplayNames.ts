"use client";

import { useEffect, useState } from "react";
import type { TagDisplayProfile } from "@/lib/freightTags";

const cache = new Map<string, { expiresAt: number; profile: Promise<TagDisplayProfile | null> }>();

function loadProfiles(handles: string[]) {
  const missing = handles.filter((handle) => !cache.has(handle) || cache.get(handle)!.expiresAt <= Date.now());
  for (let start = 0; start < missing.length; start += 100) {
    const batch = missing.slice(start, start + 100);
    const result = fetch(`/api/user-profiles/tag-labels?handles=${encodeURIComponent(batch.join(","))}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load tag names");
        const payload = await response.json();
        return (payload.profiles ?? {}) as Record<string, TagDisplayProfile>;
      });
    for (const handle of batch) {
      const profile: Promise<TagDisplayProfile | null> = result.then((profiles) => profiles[handle] ?? null).catch((error) => {
        if (cache.get(handle)?.profile === profile) cache.delete(handle);
        throw error;
      });
      cache.set(handle, { expiresAt: Date.now() + 60_000, profile });
    }
  }
  return Promise.all(handles.map(async (handle) => [handle, await cache.get(handle)!.profile] as const));
}

export function useTagDisplayNames(handles: string[]) {
  const [profiles, setProfiles] = useState<Record<string, TagDisplayProfile | null>>({});
  const key = JSON.stringify([...new Set(handles)].sort());
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_000;
    const requested = JSON.parse(key) as string[];
    if (!requested.length) return;
    const load = () => {
      void loadProfiles(requested).then((entries) => {
        if (!cancelled) setProfiles(Object.fromEntries(entries));
      }).catch(() => {
        if (cancelled) return;
        retryTimer = setTimeout(load, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      });
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [key]);
  return profiles;
}
