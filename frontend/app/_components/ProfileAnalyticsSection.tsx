"use client";

import { useMemo } from "react";

import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import type { ProfileAnalytics, ProfileAnalyticsPoint } from "@/app/_hooks/useProfileAnalytics";

const CHART_WIDTH = 760;
const CHART_HEIGHT = 320;
const CHART_PADDING = {
  top: 24,
  right: 18,
  bottom: 42,
  left: 44,
};

const ANALYTICS_SERIES = [
  {
    key: "produced",
    label: "Produced",
    className: "profile-analytics-series-produced",
    color: "#3b82f6",
    gradientId: "profile-analytics-gradient-produced",
  },
  {
    key: "participated",
    label: "Participated",
    className: "profile-analytics-series-participated",
    color: "#7c3aed",
    gradientId: "profile-analytics-gradient-participated",
  },
  {
    key: "rewarded",
    label: "Rewarded",
    className: "profile-analytics-series-rewarded",
    color: "#16a34a",
    gradientId: "profile-analytics-gradient-rewarded",
  },
] as const satisfies Array<{
  key: Exclude<keyof ProfileAnalyticsPoint, "date">;
  label: string;
  className: string;
  color: string;
  gradientId: string;
}>;

type SeriesKey = (typeof ANALYTICS_SERIES)[number]["key"];

type ChartCoordinate = {
  date: string;
  value: number;
  x: number;
  y: number;
};

type ProfileAnalyticsSectionProps = {
  analytics: ProfileAnalytics | null;
  error: string;
  loading: boolean;
};

function formatDisplayDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatAxisDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatNumber(value: number) {
  return value.toLocaleString();
}

function buildYAxisTicks(maxValue: number) {
  if (maxValue <= 0) {
    return [0, 20, 40, 60];
  }

  const approximateTickCount = 3;
  const rawStep = Math.max(1, Math.ceil(maxValue / approximateTickCount));
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(rawStep)));
  const step = Math.max(1, Math.ceil(rawStep / magnitude) * magnitude);
  const upperBound = Math.max(step, Math.ceil(maxValue / step) * step);
  const ticks: number[] = [];

  for (let value = 0; value <= upperBound; value += step) {
    ticks.push(value);
  }

  return ticks;
}

function getXPosition(index: number, totalPoints: number) {
  const chartWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  if (totalPoints <= 1) {
    return CHART_PADDING.left + chartWidth / 2;
  }

  return CHART_PADDING.left + (index / (totalPoints - 1)) * chartWidth;
}

function getYPosition(value: number, maxValue: number) {
  const chartHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const normalized = maxValue > 0 ? value / maxValue : 0;
  return CHART_PADDING.top + chartHeight - normalized * chartHeight;
}

function buildSeriesCoordinates(points: ProfileAnalyticsPoint[], field: SeriesKey, maxValue: number) {
  return points.map((point, index) => ({
    date: point.date,
    value: point[field],
    x: getXPosition(index, points.length),
    y: getYPosition(point[field], maxValue),
  }));
}

function buildSmoothLinePath(points: ChartCoordinate[]) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  const [firstPoint, ...rest] = points;
  let path = `M ${firstPoint.x} ${firstPoint.y}`;

  for (let index = 0; index < rest.length; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    path += ` C ${midX} ${current.y}, ${midX} ${next.y}, ${next.x} ${next.y}`;
  }

  return path;
}

function buildSmoothAreaPath(points: ChartCoordinate[], baselineY: number) {
  if (points.length === 0) {
    return "";
  }

  const linePath = buildSmoothLinePath(points);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  return `${linePath} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`;
}

function buildXAxisLabelIndexes(points: ProfileAnalyticsPoint[]) {
  if (points.length === 0) {
    return [];
  }

  const monthIndexes: number[] = [];
  let previousMonthKey = "";

  points.forEach((point, index) => {
    const monthKey = point.date.slice(0, 7);
    if (monthKey !== previousMonthKey) {
      monthIndexes.push(index);
      previousMonthKey = monthKey;
    }
  });

  return monthIndexes;
}

export default function ProfileAnalyticsSection({ analytics, error, loading }: ProfileAnalyticsSectionProps) {
  const hasActivity = Boolean(analytics) && ANALYTICS_SERIES.some((series) => (analytics?.totals[series.key] ?? 0) > 0);

  const chartModel = useMemo(() => {
    if (!analytics || !hasActivity) {
      return null;
    }

    const maxValue = analytics.points.reduce((currentMax, point) => {
      return Math.max(currentMax, point.produced, point.participated, point.rewarded);
    }, 0);
    const yTicks = buildYAxisTicks(maxValue);
    const domainMax = yTicks[yTicks.length - 1] ?? 1;
    const baselineY = CHART_HEIGHT - CHART_PADDING.bottom;

    return {
      baselineY,
      domainMax,
      seriesCoordinates: Object.fromEntries(
        ANALYTICS_SERIES.map((series) => [series.key, buildSeriesCoordinates(analytics.points, series.key, domainMax)]),
      ) as Record<SeriesKey, ChartCoordinate[]>,
      xLabelIndexes: buildXAxisLabelIndexes(analytics.points),
      yTicks,
    };
  }, [analytics, hasActivity]);

  return (
    <section className="profile-analytics-section" aria-labelledby="profile-analytics-title">
      <div className="profile-analytics-header">
        <h2 id="profile-analytics-title" className="profile-analytics-title">Activity</h2>
        <p className="profile-analytics-range-label">
          {analytics
            ? `Last 90 days · ${formatDisplayDate(analytics.range.startDate)} – ${formatDisplayDate(analytics.range.endDate)}`
            : "Last 90 days"}
        </p>
      </div>

      {loading ? (
        <div className="profile-analytics-state profile-analytics-state-loading">
          <ThreeDotLoader label="Loading activity graph" inline />
        </div>
      ) : error ? (
        <p className="profile-analytics-state profile-analytics-state-error">{error}</p>
      ) : !analytics || !hasActivity || !chartModel ? (
        <p className="profile-analytics-state profile-analytics-state-empty">No created, participated, or rewarded activity yet.</p>
      ) : (
        <>
          <div className="profile-analytics-card">
            <div className="profile-analytics-legend" aria-label="Graph legend">
              {ANALYTICS_SERIES.map((series) => (
                <span key={series.key} className={`profile-analytics-legend-item ${series.className}`}>
                  <span className="profile-analytics-legend-sample" aria-hidden="true">
                    <span className="profile-analytics-legend-stroke" />
                    <span className="profile-analytics-legend-point" />
                  </span>
                  <span>{series.label}</span>
                </span>
              ))}
            </div>
          </div>

          <div
            className="profile-analytics-chart-shell"
            tabIndex={0}
            role="group"
            aria-label="Scrollable activity chart"
            aria-describedby="profile-analytics-scroll-hint"
          >
              <svg
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                className="profile-analytics-chart"
                role="img"
                aria-label={`Activity graph from ${formatDisplayDate(analytics.range.startDate)} to ${formatDisplayDate(analytics.range.endDate)}. Produced ${formatNumber(analytics.totals.produced)}, participated ${formatNumber(analytics.totals.participated)}, rewarded ${formatNumber(analytics.totals.rewarded)}.`}
              >
                <defs>
                  {ANALYTICS_SERIES.map((series) => (
                    <linearGradient key={series.gradientId} id={series.gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={series.color} stopOpacity="0.26" />
                      <stop offset="72%" stopColor={series.color} stopOpacity="0.1" />
                      <stop offset="100%" stopColor={series.color} stopOpacity="0.02" />
                    </linearGradient>
                  ))}
                </defs>

                <g aria-hidden="true">
                  {chartModel.yTicks.map((tick) => {
                    const y = getYPosition(tick, chartModel.domainMax);
                    return (
                      <g key={tick}>
                        <line
                          x1={CHART_PADDING.left}
                          y1={y}
                          x2={CHART_WIDTH - CHART_PADDING.right}
                          y2={y}
                          className="profile-analytics-grid-line"
                        />
                        <text
                          x={CHART_PADDING.left - 10}
                          y={y}
                          className="profile-analytics-axis-label"
                          textAnchor="end"
                          dominantBaseline="middle"
                        >
                          {tick}
                        </text>
                      </g>
                    );
                  })}

                  {chartModel.xLabelIndexes.map((index) => {
                    const point = analytics.points[index];
                    if (!point) {
                      return null;
                    }

                    const x = getXPosition(index, analytics.points.length);
                    return (
                      <line
                        key={`grid-${point.date}`}
                        x1={x}
                        y1={CHART_PADDING.top}
                        x2={x}
                        y2={chartModel.baselineY}
                        className="profile-analytics-grid-line profile-analytics-grid-line-vertical"
                      />
                    );
                  })}

                  {ANALYTICS_SERIES.map((series) => {
                    const points = chartModel.seriesCoordinates[series.key];
                    return (
                      <path
                        key={`${series.key}-area`}
                        d={buildSmoothAreaPath(points, chartModel.baselineY)}
                        className="profile-analytics-area"
                        fill={`url(#${series.gradientId})`}
                      />
                    );
                  })}

                  {ANALYTICS_SERIES.map((series) => {
                    const points = chartModel.seriesCoordinates[series.key];
                    return (
                      <path
                        key={`${series.key}-line`}
                        d={buildSmoothLinePath(points)}
                        className={`profile-analytics-line ${series.className}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.35"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}

                  {ANALYTICS_SERIES.flatMap((series) => {
                    return chartModel.seriesCoordinates[series.key]
                      .filter((point) => point.value > 0)
                      .map((point) => (
                        <circle
                          key={`${series.key}-${point.date}`}
                          cx={point.x}
                          cy={point.y}
                          r="4.7"
                          className={`profile-analytics-point ${series.className}`}
                          fill="currentColor"
                        />
                      ));
                  })}

                  <line
                    x1={CHART_PADDING.left}
                    y1={chartModel.baselineY}
                    x2={CHART_WIDTH - CHART_PADDING.right}
                    y2={chartModel.baselineY}
                    className="profile-analytics-axis-line"
                  />

                  {chartModel.xLabelIndexes.map((index, labelIndex) => {
                    const point = analytics.points[index];
                    if (!point) {
                      return null;
                    }

                    const isFirst = labelIndex === 0;
                    const isLast = labelIndex === chartModel.xLabelIndexes.length - 1;
                    return (
                      <text
                        key={`${point.date}-${index}`}
                        x={getXPosition(index, analytics.points.length)}
                        y={CHART_HEIGHT - 12}
                        className="profile-analytics-axis-label"
                        textAnchor={isFirst ? "start" : isLast ? "end" : "middle"}
                      >
                        {formatAxisDate(point.date)}
                      </text>
                    );
                  })}
                </g>
              </svg>
          </div>

          <div className="profile-analytics-totals" aria-label="Activity totals">
            {ANALYTICS_SERIES.map((series) => (
              <div key={series.key} className="profile-analytics-total-stat">
                <span className={`profile-analytics-total-label ${series.className}`}>{series.label}</span>
                <strong className="profile-analytics-total-value">{formatNumber(analytics.totals[series.key])}</strong>
              </div>
            ))}
          </div>
          <p id="profile-analytics-scroll-hint" className="profile-analytics-scroll-hint">
            Scroll horizontally to view the full chart on smaller screens.
          </p>
        </>
      )}
    </section>
  );
}
