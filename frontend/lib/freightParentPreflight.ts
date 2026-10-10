export async function assertFreightParentPreflight(campaignId: string, participantAddress: string) {
  const response = await fetch("/api/freights/parent-access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaignId, participantAddress }),
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "Could not check parent freight completion");
  }
}
