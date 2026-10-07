"use client";

import { connect, signChallenge } from "@joyid/ckb";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  SquareCheckBig,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type PrincipleState = {
  principleId: string;
  displayLabel?: string;
  fulfilled: boolean;
  detail?: string;
  updatedAt?: string;
};

type ApiState = {
  state: {
    externalUserId: string;
    participantAddress: string;
    checked: string[];
    submittedText: string;
    updatedAt: string;
  };
  principleStates: PrincipleState[];
  allFulfilled?: boolean;
  mountableInstanceId?: string;
};

type FlowLog = {
  id: string;
  timestamp: string;
  kind: "auth" | "request" | "response" | "webhook" | "poll" | "evaluation" | "registration";
  direction: "inbound" | "outbound" | "internal";
  method?: string;
  source: string;
  target: string;
  status?: number;
  summary: string;
  request?: unknown;
  response?: unknown;
};

function isApiState(value: ApiState | { error?: string }): value is ApiState {
  return "state" in value && "principleStates" in value;
}

const checkboxes = [
  { id: "profile", label: "Profile connected", description: "The wallet has completed the starter identity step." },
  { id: "terms", label: "Terms accepted", description: "The wallet accepted the sample freight terms." },
  { id: "email", label: "Email confirmed", description: "The wallet toggled the pretend email confirmation." },
  { id: "launch", label: "Launch task done", description: "The wallet completed the launch-day demo task." },
];

function compactAddress(address: string) {
  return address.length > 20 ? `${address.slice(0, 10)}...${address.slice(-8)}` : address;
}

function formatPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function highlightedJson(value: unknown) {
  const json = formatPayload(value);
  const pattern = /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const parts: Array<string | React.ReactElement> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(json)) !== null) {
    if (match.index > cursor) parts.push(json.slice(cursor, match.index));
    const token = match[0];
    const rest = json.slice(match.index + token.length);
    const tokenType = token.startsWith('"')
      ? /^\s*:/.test(rest) ? "key" : "string"
      : token === "true" || token === "false"
        ? "boolean"
        : token === "null" ? "null" : "number";
    parts.push(<span className={`json-${tokenType}`} key={`${match.index}-${tokenType}`}>{token}</span>);
    cursor = match.index + token.length;
  }
  if (cursor < json.length) parts.push(json.slice(cursor));
  return parts;
}

function PayloadPanel({
  label,
  tone,
  value,
  copied,
  onCopy,
}: {
  label: "Request" | "Response";
  tone: "request" | "response";
  value: unknown;
  copied: boolean;
  onCopy: () => void;
}) {
  const formatted = formatPayload(value);
  return (
    <div className={`payload-panel ${tone}`}>
      <div className="payload-heading">
        <span><Braces size={14} aria-hidden="true" /> {label}</span>
        <span className="payload-tools">
          <span>{formatted.length.toLocaleString()} chars</span>
          <button type="button" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()} payload`} title={`Copy ${label.toLowerCase()} payload`}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>
        </span>
      </div>
      <pre><code>{highlightedJson(value)}</code></pre>
    </div>
  );
}

function DirectionIcon({ direction }: Pick<FlowLog, "direction">) {
  if (direction === "inbound") return <ArrowDownLeft size={16} aria-hidden="true" />;
  if (direction === "outbound") return <ArrowUpRight size={16} aria-hidden="true" />;
  return <ArrowLeftRight size={16} aria-hidden="true" />;
}

function describeLogRoute(log: FlowLog) {
  const fonSource = log.source === "FON" || log.source === "FON/client";
  const fonTarget = log.target === "FON" || log.target === "FON/client" || /^https?:\/\//.test(log.target);

  if (fonSource) {
    return { label: `${log.source === "FON/client" ? "FON or client" : "FON"} → Demo app`, tone: "fon-inbound" };
  }
  if (fonTarget) {
    return { label: `Demo app → ${log.target === "FON/client" ? "FON or client" : "FON"}`, tone: "fon-outbound" };
  }
  if (log.source === "JoyID") {
    return { label: "JoyID → Demo app", tone: "external-inbound" };
  }
  if (log.direction === "inbound") {
    return { label: "Wallet → Demo app", tone: "external-inbound" };
  }
  if (log.target === "browser" || /^(ckb|ckt)/i.test(log.target)) {
    return { label: "Demo app → Wallet", tone: "internal" };
  }
  return { label: "Inside demo app", tone: "internal" };
}

export default function Home() {
  const [walletAddress, setWalletAddress] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [submittedText, setSubmittedText] = useState("");
  const [principleStates, setPrincipleStates] = useState<PrincipleState[]>([]);
  const [mountableInstanceId, setMountableInstanceId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<FlowLog[]>([]);
  const [logsError, setLogsError] = useState("");
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState("");

  const allFulfilled = useMemo(
    () => principleStates.length > 0 && principleStates.every((state) => state.fulfilled),
    [principleStates],
  );

  const applyApiState = useCallback((payload: ApiState) => {
    setChecked(payload.state.checked);
    setSubmittedText(payload.state.submittedText);
    setPrincipleStates(payload.principleStates);
    setMountableInstanceId(payload.mountableInstanceId ?? "");
  }, []);

  const loadLogs = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLogsLoading(true);
    try {
      const response = await fetch("/api/logs", { cache: "no-store" });
      const payload = await response.json() as { logs?: FlowLog[]; error?: string };
      if (!response.ok || !Array.isArray(payload.logs)) throw new Error(payload.error || "Failed to load flow logs");
      setLogs(payload.logs);
      setLogsError("");
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : "Failed to load flow logs");
    } finally {
      if (showLoading) setIsLogsLoading(false);
    }
  }, []);

  const loadParticipantState = useCallback(async (instanceId = "") => {
    const query = instanceId ? `?mountableInstanceId=${encodeURIComponent(instanceId)}` : "";
    const response = await fetch(`/api/participant-state${query}`, { cache: "no-store" });
    const payload = await response.json() as ApiState | { error?: string };
    if (!response.ok || !isApiState(payload)) {
      throw new Error("error" in payload ? payload.error : "Failed to load wallet activity");
    }
    applyApiState(payload);
  }, [applyApiState]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/joyid", { cache: "no-store" });
        const payload = await response.json() as { authenticated?: boolean; address?: string | null };
        if (active && payload.authenticated && payload.address) {
          setWalletAddress(payload.address);
          await loadParticipantState();
        }
      } catch {
        if (active) setMessage("Could not restore the JoyID session.");
      }
    })();
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadLogs, loadParticipantState]);

  async function syncState(nextChecked: string[], nextSubmittedText = submittedText) {
    if (!walletAddress) return;
    setIsLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/participant-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked: nextChecked, submittedText: nextSubmittedText, mountableInstanceId }),
      });
      const payload = await response.json() as ApiState | { error?: string };
      if (!response.ok || !isApiState(payload)) {
        throw new Error("error" in payload ? payload.error : "Failed to update participant state");
      }
      applyApiState(payload);
      setMessage(payload.allFulfilled ? "All selected principles are fulfilled." : "Some selected principles are still pending.");
      await loadLogs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update demo state");
    } finally {
      setIsLoading(false);
    }
  }

  async function connectJoyId() {
    setIsConnecting(true);
    setMessage("");
    try {
      const network = process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
      const credential = await connect({
        name: "FON Checkbox Demo",
        logo: `${window.location.origin}/logo.png`,
        network,
      });
      const challengeResponse = await fetch("/api/auth/joyid/challenge", { method: "POST" });
      const challengePayload = await challengeResponse.json() as { challengeId?: string; challenge?: string; error?: string };
      if (!challengeResponse.ok || !challengePayload.challengeId || !challengePayload.challenge) {
        throw new Error(challengePayload.error || "Could not start JoyID verification");
      }
      const proof = await signChallenge(challengePayload.challenge, credential.address, {
        name: "FON Checkbox Demo",
        logo: `${window.location.origin}/logo.png`,
        network,
      });
      const response = await fetch("/api/auth/joyid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: credential.address,
          challengeId: challengePayload.challengeId,
          challenge: proof.challenge,
          pubkey: proof.pubkey,
          keyType: proof.keyType,
          alg: proof.alg,
          message: proof.message,
          signature: proof.signature,
        }),
      });
      const payload = await response.json() as { authenticated?: boolean; address?: string; error?: string };
      if (!response.ok || !payload.authenticated || !payload.address) throw new Error(payload.error || "JoyID login failed");
      setWalletAddress(payload.address);
      await loadParticipantState();
      setMessage("JoyID wallet connected.");
      await loadLogs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JoyID login failed");
    } finally {
      setIsConnecting(false);
    }
  }

  async function disconnectJoyId() {
    setIsLoading(true);
    try {
      await fetch("/api/auth/joyid", { method: "DELETE" });
      setWalletAddress("");
      setChecked([]);
      setSubmittedText("");
      setPrincipleStates([]);
      setMountableInstanceId("");
      setMessage("JoyID wallet disconnected.");
      await loadLogs();
    } finally {
      setIsLoading(false);
    }
  }

  async function clearLogs() {
    setIsLogsLoading(true);
    try {
      await fetch("/api/logs", { method: "DELETE" });
      setLogs([]);
      setLogsError("");
    } finally {
      setIsLogsLoading(false);
    }
  }

  async function copyPayload(id: string, value: unknown) {
    await navigator.clipboard.writeText(formatPayload(value));
    setCopiedPayload(id);
    window.setTimeout(() => setCopiedPayload((current) => current === id ? "" : current), 1600);
  }

  function toggleCheckbox(id: string) {
    const nextChecked = checked.includes(id) ? checked.filter((entry) => entry !== id) : [...checked, id];
    setChecked(nextChecked);
    void syncState(nextChecked);
  }

  return (
    <main className="demo-shell">
      <section className="demo-topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><SquareCheckBig size={20} aria-hidden="true" /></div>
          <div><p className="eyebrow">FON mounted app</p><h1>Checkbox Demo</h1></div>
        </div>
        <a className="manifest-link" href="/api/manifest">Manifest <ChevronRight size={16} aria-hidden="true" /></a>
      </section>

      <section className="workbench">
        <div className="login-panel">
          <div>
            <p className="panel-label">Wallet</p>
            <button type="button" className="wallet-button" disabled={isConnecting || isLoading} onClick={() => walletAddress ? void disconnectJoyId() : void connectJoyId()}>
              {isConnecting || isLoading
                ? <Loader2 className="spin" size={16} aria-hidden="true" />
                : walletAddress ? <LogOut size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
              {walletAddress ? "Disconnect" : "Connect JoyID"}
            </button>
          </div>
          <div className="session-strip">
            <span className={walletAddress ? "connection-dot connected" : "connection-dot"} aria-hidden="true" />
            <span>{walletAddress ? "Connected" : "Not connected"}</span>
            <code title={walletAddress || undefined}>{walletAddress ? compactAddress(walletAddress) : "No wallet"}</code>
          </div>
        </div>

        <div className="content-grid">
          <section className="task-surface" aria-label="Demo checkboxes">
            <div className="section-heading">
              <div><p className="eyebrow">Participant actions</p><h2>Check the demo tasks</h2></div>
              <button className="icon-button" type="button" onClick={() => void loadParticipantState(mountableInstanceId)} disabled={!walletAddress || isLoading} aria-label="Refresh evaluation" title="Refresh evaluation">
                {isLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
              </button>
            </div>
            <div className="checkbox-list">
              {checkboxes.map((checkbox) => {
                const isChecked = checked.includes(checkbox.id);
                return (
                  <label className="checkbox-card" key={checkbox.id}>
                    <input type="checkbox" checked={isChecked} disabled={!walletAddress || isLoading} onChange={() => toggleCheckbox(checkbox.id)} />
                    <span className="visual-box" aria-hidden="true">{isChecked ? <Check size={16} /> : null}</span>
                    <span><strong>{checkbox.label}</strong><small>{checkbox.description}</small></span>
                  </label>
                );
              })}
            </div>
            <form className="exact-text-form" onSubmit={(event) => { event.preventDefault(); void syncState(checked, submittedText); }}>
              <label htmlFor="exact-text">Exact text principle</label>
              <div className="login-row">
                <input id="exact-text" type="text" value={submittedText} disabled={!walletAddress || isLoading} onChange={(event) => setSubmittedText(event.target.value)} placeholder="Type the creator's exact text" />
                <button type="submit" disabled={!walletAddress || isLoading}>Check text</button>
              </div>
            </form>
          </section>

          <section className="principle-surface" aria-label="Principle evaluation">
            <div className="section-heading">
              <div><p className="eyebrow">SDK evaluation</p><h2>Selected principles</h2></div>
              <span className={allFulfilled ? "status-pill fulfilled" : "status-pill"}>{allFulfilled ? "Fulfilled" : "Pending"}</span>
            </div>
            <div className="principle-list">
              {principleStates.length === 0 ? <div className="empty-state">Connect JoyID to evaluate the demo principles.</div> : principleStates.map((state) => (
                <article className="principle-row" key={state.principleId}>
                  <div className={state.fulfilled ? "result-dot fulfilled" : "result-dot"} />
                  <div><strong>{state.displayLabel || state.principleId}</strong><small>{state.detail || "No detail returned"}</small></div>
                </article>
              ))}
            </div>
            {message ? <p className="message-line">{message}</p> : null}
          </section>
        </div>

        <section className="logs-surface" aria-label="Request and webhook logs">
          <div className="section-heading">
            <div><p className="eyebrow">Live integration trace</p><h2>Logs <span className="log-count">{logs.length}</span></h2></div>
            <div className="log-actions">
              <button className="icon-button" type="button" onClick={() => void loadLogs(true)} disabled={isLogsLoading} aria-label="Refresh logs" title="Refresh logs">
                {isLogsLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
              </button>
              <button className="icon-button" type="button" onClick={() => void clearLogs()} disabled={isLogsLoading || logs.length === 0} aria-label="Clear logs" title="Clear logs"><Trash2 size={18} aria-hidden="true" /></button>
            </div>
          </div>
          {logsError ? <p className="log-error">{logsError}</p> : null}
          <div className="flow-log-list">
            {logs.length === 0 ? <div className="empty-state log-empty">Requests, responses, polls, and webhooks will appear here.</div> : logs.map((log) => {
              const route = describeLogRoute(log);
              return <details className={`flow-log-row direction-${log.direction}`} key={log.id}>
                <summary>
                  <span className={`direction-icon ${log.direction}`}><DirectionIcon direction={log.direction} /></span>
                  <span className="log-main">
                    <span className="log-meta">
                      <span className={`log-route ${route.tone}`}>{route.label}</span>
                      <span className={`log-kind ${log.kind}`}>{log.kind}</span>
                      {log.method ? <span>{log.method}</span> : null}
                      {log.status ? <span className={log.status >= 400 ? "log-status failed" : "log-status"}>{log.status}</span> : null}
                      <time dateTime={log.timestamp}>{new Date(log.timestamp).toLocaleTimeString()}</time>
                    </span>
                    <strong>{log.summary}</strong>
                    <small>{log.source} <ChevronRight size={13} aria-hidden="true" /> {log.target}</small>
                  </span>
                  <ChevronRight className="disclosure-chevron" size={18} aria-hidden="true" />
                </summary>
                {log.request !== undefined || log.response !== undefined ? (
                  <div className="log-payloads">
                    {log.request !== undefined ? (
                      <PayloadPanel
                        label="Request"
                        tone="request"
                        value={log.request}
                        copied={copiedPayload === `${log.id}-request`}
                        onCopy={() => void copyPayload(`${log.id}-request`, log.request)}
                      />
                    ) : null}
                    {log.response !== undefined ? (
                      <PayloadPanel
                        label="Response"
                        tone="response"
                        value={log.response}
                        copied={copiedPayload === `${log.id}-response`}
                        onCopy={() => void copyPayload(`${log.id}-response`, log.response)}
                      />
                    ) : null}
                  </div>
                ) : <p className="no-payload">No payload recorded.</p>}
              </details>
            })}
          </div>
        </section>
      </section>
    </main>
  );
}
