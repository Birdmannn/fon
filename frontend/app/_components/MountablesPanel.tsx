const MOUNTABLES_PLACEHOLDER_MESSAGE = "NO MOUNTABLES YET. RAFFLE RAFFLE RAFFLE.   ";

export default function MountablesPanel() {
  const marqueeText = `${MOUNTABLES_PLACEHOLDER_MESSAGE}${MOUNTABLES_PLACEHOLDER_MESSAGE}${MOUNTABLES_PLACEHOLDER_MESSAGE}`;

  return (
    <div className="retro-mountables-shell" aria-label="Mountables display">
      <div className="retro-marquee-track">
        <span>{marqueeText}</span>
        <span aria-hidden="true">{marqueeText}</span>
      </div>
    </div>
  );
}
