export const DEFAULT_LIGHT_MODE_PRIMARY_COLOR = "#ffffff";
export const ALTERNATE_LIGHT_MODE_PRIMARY_COLOR = "#f2f0e4";
export const LIGHT_MODE_PRIMARY_COLOR_STORAGE_KEY = "freighton:light-mode-primary-color";
export const LIGHT_MODE_PRIMARY_COLOR_ATTRIBUTE = "data-light-mode-primary-color";
export const LIGHT_MODE_PRIMARY_COLOR_SYNC_EVENT = "freighton:light-mode-primary-color-sync";

export const LIGHT_MODE_PRIMARY_COLOR_OPTIONS = [
  {
    label: "White",
    value: DEFAULT_LIGHT_MODE_PRIMARY_COLOR,
  },
  {
    label: "Cream",
    value: ALTERNATE_LIGHT_MODE_PRIMARY_COLOR,
  },
] as const;

export type LightModePrimaryColor = typeof LIGHT_MODE_PRIMARY_COLOR_OPTIONS[number]["value"];

export function isLightModePrimaryColor(value: unknown): value is LightModePrimaryColor {
  return value === DEFAULT_LIGHT_MODE_PRIMARY_COLOR || value === ALTERNATE_LIGHT_MODE_PRIMARY_COLOR;
}

export function normalizeLightModePrimaryColor(value: unknown): LightModePrimaryColor {
  if (typeof value !== "string") {
    return DEFAULT_LIGHT_MODE_PRIMARY_COLOR;
  }

  const normalized = value.trim().toLowerCase();
  return isLightModePrimaryColor(normalized) ? normalized : DEFAULT_LIGHT_MODE_PRIMARY_COLOR;
}

export function getLightModePrimaryColorAttributeValue(value: unknown) {
  const normalized = normalizeLightModePrimaryColor(value);
  return normalized === ALTERNATE_LIGHT_MODE_PRIMARY_COLOR ? "cream" : "white";
}

export function applyLightModePrimaryColorToDocument(value: unknown) {
  const normalized = normalizeLightModePrimaryColor(value);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute(
      LIGHT_MODE_PRIMARY_COLOR_ATTRIBUTE,
      getLightModePrimaryColorAttributeValue(normalized),
    );
  }

  return normalized;
}

export function readStoredLightModePrimaryColor() {
  if (typeof window === "undefined") {
    return DEFAULT_LIGHT_MODE_PRIMARY_COLOR;
  }

  try {
    return normalizeLightModePrimaryColor(window.localStorage.getItem(LIGHT_MODE_PRIMARY_COLOR_STORAGE_KEY));
  } catch {
    return DEFAULT_LIGHT_MODE_PRIMARY_COLOR;
  }
}

export function persistLightModePrimaryColor(value: unknown) {
  const normalized = normalizeLightModePrimaryColor(value);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LIGHT_MODE_PRIMARY_COLOR_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage errors and still notify in-memory listeners.
    }

    window.dispatchEvent(new CustomEvent(LIGHT_MODE_PRIMARY_COLOR_SYNC_EVENT, {
      detail: {
        color: normalized,
      },
    }));
  }

  return normalized;
}
