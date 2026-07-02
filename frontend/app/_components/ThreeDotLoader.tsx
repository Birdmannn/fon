type ThreeDotLoaderProps = {
  className?: string;
  inline?: boolean;
  label?: string;
};

export default function ThreeDotLoader({
  className = "",
  inline = false,
  label = "Loading",
}: ThreeDotLoaderProps) {
  const classes = [
    "campaign-feed-loading",
    inline ? "campaign-feed-loading-inline" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} aria-label={label} role="status">
      <span className="campaign-feed-loading-dot" />
      <span className="campaign-feed-loading-dot" />
      <span className="campaign-feed-loading-dot" />
    </div>
  );
}
