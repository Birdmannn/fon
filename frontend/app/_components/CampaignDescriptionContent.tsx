type DescriptionSegment =
  | { type: "paragraph"; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "spacer" };

function buildDescriptionSegments(lines: string[]): DescriptionSegment[] {
  const segments: DescriptionSegment[] = [];
  let quoteLines: string[] = [];

  const flushQuoteLines = () => {
    if (quoteLines.length === 0) {
      return;
    }

    segments.push({ type: "quote", lines: quoteLines });
    quoteLines = [];
  };

  lines.forEach((line) => {
    if (/^\s*>/.test(line)) {
      quoteLines.push(line.replace(/^\s*>\s?/, ""));
      return;
    }

    flushQuoteLines();

    if (line.trim().length === 0) {
      segments.push({ type: "spacer" });
      return;
    }

    segments.push({ type: "paragraph", text: line });
  });

  flushQuoteLines();

  return segments;
}

type CampaignDescriptionContentProps = {
  lines: string[];
};

export default function CampaignDescriptionContent({ lines }: CampaignDescriptionContentProps) {
  const segments = buildDescriptionSegments(lines);

  return segments.map((segment, segmentIndex) => {
    if (segment.type === "quote") {
      return (
        <div key={`quote-${segmentIndex}`} className="campaign-card-description-quote">
          {segment.lines.map((line, lineIndex) => {
            if (line.trim().length === 0) {
              return <div key={`quote-spacer-${segmentIndex}-${lineIndex}`} className="campaign-card-description-quote-spacer" aria-hidden="true" />;
            }

            return (
              <p key={`quote-line-${segmentIndex}-${lineIndex}`} className="campaign-card-description-quote-line">
                {line}
              </p>
            );
          })}
        </div>
      );
    }

    if (segment.type === "spacer") {
      return <div key={`spacer-${segmentIndex}`} className="campaign-card-description-spacer" aria-hidden="true" />;
    }

    return (
      <p key={`paragraph-${segmentIndex}`} className="campaign-card-description-line">
        {segment.text}
      </p>
    );
  });
}
