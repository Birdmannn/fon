"use client";

import { Check, ChevronRight, Loader2, LogIn, RefreshCw, SquareCheckBig } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

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
    updatedAt: string;
  };
  principleStates: PrincipleState[];
  allFulfilled?: boolean;
};

function isApiState(value: ApiState | { error?: string }): value is ApiState {
  return "state" in value && "principleStates" in value;
}

const checkboxes = [
  {
    id: "profile",
    label: "Profile connected",
    description: "The user has completed the starter identity step.",
  },
  {
    id: "terms",
    label: "Terms accepted",
    description: "The user accepted the sample freight terms.",
  },
  {
    id: "email",
    label: "Email confirmed",
    description: "The user toggled the pretend email confirmation.",
  },
  {
    id: "launch",
    label: "Launch task done",
    description: "The user completed the launch-day demo task.",
  },
];

function buildDemoAddress(handle: string) {
  return `demo:${handle.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "participant"}`;
}

export default function Home() {
  const [handleInput, setHandleInput] = useState("demo-creator");
  const [activeHandle, setActiveHandle] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [principleStates, setPrincipleStates] = useState<PrincipleState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  const participantAddress = useMemo(
    () => buildDemoAddress(activeHandle || handleInput),
    [activeHandle, handleInput],
  );

  const allFulfilled = principleStates.length > 0 && principleStates.every((state: PrincipleState) => state.fulfilled);

  async function syncState(nextChecked: string[], handle = activeHandle) {
    if (!handle) {
      return;
    }

    setIsLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/participant-state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          externalUserId: handle,
          participantAddress: buildDemoAddress(handle),
          checked: nextChecked,
        }),
      });
      const payload = await response.json() as ApiState | { error?: string };
      if (!response.ok || !isApiState(payload)) {
        throw new Error("error" in payload ? payload.error : "Failed to update participant state");
      }

      setChecked(payload.state.checked);
      setPrincipleStates(payload.principleStates);
      setMessage(payload.allFulfilled === true ? "All selected principles are fulfilled." : "Some selected principles are still pending.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update demo state");
    } finally {
      setIsLoading(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const handle = handleInput.trim() || "demo-creator";
    setActiveHandle(handle);
    await syncState(checked, handle);
  }

  function toggleCheckbox(id: string) {
    const nextChecked = checked.includes(id)
      ? checked.filter((entry: string) => entry !== id)
      : [...checked, id];
    setChecked(nextChecked);
    void syncState(nextChecked);
  }

  return (
    <main className="demo-shell">
      <section className="demo-topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <SquareCheckBig size={20} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">FON mounted app</p>
            <h1>Checkbox Demo</h1>
          </div>
        </div>
        <a className="manifest-link" href="/api/manifest">
          Manifest
          <ChevronRight size={16} aria-hidden="true" />
        </a>
      </section>

      <section className="workbench">
        <div className="login-panel">
          <form onSubmit={login}>
            <label htmlFor="handle">Demo login</label>
            <div className="login-row">
              <input
                id="handle"
                value={handleInput}
                onChange={(event) => setHandleInput(event.target.value)}
                placeholder="participant-handle"
              />
              <button type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
                Login
              </button>
            </div>
          </form>
          <div className="session-strip">
            <span>{activeHandle ? activeHandle : "Not logged in"}</span>
            <code>{participantAddress}</code>
          </div>
        </div>

        <div className="content-grid">
          <section className="task-surface" aria-label="Demo checkboxes">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Participant actions</p>
                <h2>Check the demo tasks</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => syncState(checked)} disabled={!activeHandle || isLoading} aria-label="Refresh evaluation">
                {isLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}
              </button>
            </div>

            <div className="checkbox-list">
              {checkboxes.map((checkbox) => {
                const isChecked = checked.includes(checkbox.id);
                return (
                  <label className="checkbox-card" key={checkbox.id}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!activeHandle || isLoading}
                      onChange={() => toggleCheckbox(checkbox.id)}
                    />
                    <span className="visual-box" aria-hidden="true">
                      {isChecked ? <Check size={16} /> : null}
                    </span>
                    <span>
                      <strong>{checkbox.label}</strong>
                      <small>{checkbox.description}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="principle-surface" aria-label="Principle evaluation">
            <div className="section-heading">
              <div>
                <p className="eyebrow">SDK evaluation</p>
                <h2>Selected principles</h2>
              </div>
              <span className={allFulfilled ? "status-pill fulfilled" : "status-pill"}>
                {allFulfilled ? "Fulfilled" : "Pending"}
              </span>
            </div>

            <div className="principle-list">
              {principleStates.length === 0 ? (
                <div className="empty-state">Login to evaluate the demo principles.</div>
              ) : principleStates.map((state: PrincipleState) => (
                <article className="principle-row" key={state.principleId}>
                  <div className={state.fulfilled ? "result-dot fulfilled" : "result-dot"} />
                  <div>
                    <strong>{state.displayLabel || state.principleId}</strong>
                    <small>{state.detail || "No detail returned"}</small>
                  </div>
                </article>
              ))}
            </div>

            {message ? <p className="message-line">{message}</p> : null}
          </section>
        </div>
      </section>
    </main>
  );
}
