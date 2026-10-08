export default function FreightTreeHelpInfo() {
  return (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-500 font-bold">Linked Freights:</p>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-gray-500">
        <li>A parent can have many children, but each child has one parent.</li>
        <li>A participant clears a child only after the same wallet clears its own criteria and every ancestor.</li>
        <li>Adding a parent can return cleared participants to pending; past payouts remain final.</li>
        <li>Tracking links affect completion only when a linked freight is required.</li>
      </ol>
      <div className="mt-3 flex flex-col gap-1">
        <p className="create-review-section-label text-gray-500 font-bold">Encroachment:</p>
        <p className="create-info-constraint-item text-gray-500">
          <span>This occurs when a user forcefully obtains another user&apos;s privileges. A parent creator may attach their freight above someone else&apos;s child only when they have at least 10 times that creator&apos;s FBARS.</span>
        </p>
      </div>
    </div>
  );
}
