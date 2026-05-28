export default function RainbowButtonPreviewPage() {
  return (
    <main className="rainbow-preview-page">
      <div className="rainbow-preview-panel">
        <p className="rainbow-preview-label">Idle</p>
        <button type="button" className="rainbow-preview-button">
          Save draft
        </button>

        <p className="rainbow-preview-label">Primary</p>
        <button type="button" className="rainbow-preview-button rainbow-preview-button-dark">
          Save draft
        </button>

        <p className="rainbow-preview-help">
          Hover and focus the buttons to inspect the border treatment in isolation.
        </p>
      </div>
    </main>
  );
}
