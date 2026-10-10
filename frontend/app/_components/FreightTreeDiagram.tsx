"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { FreightTree } from "@/app/_components/FreightTreeInfo";
import { parentIds } from "@/lib/freightTree";

const NODE_WIDTH = 126;
const NODE_HEIGHT = 48;
const COLUMN_GAP = 21.6;
const ROW_GAP = 18;
const PADDING = 36;

export default function FreightTreeDiagram({ tree, zoom = 0.75 }: { tree: FreightTree; zoom?: number }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const graph = useMemo(() => {
    const nodesById = new Map(tree.nodes.map((node) => [node.campaignId.toLowerCase(), node]));
    const rows = new Map<number, typeof tree.nodes>();
    for (const node of tree.nodes) {
      const depth = Math.max(0, node.depth ?? 0);
      rows.set(depth, [...(rows.get(depth) ?? []), node]);
    }
    const maxColumns = Math.max(1, ...[...rows.values()].map((row) => row.length));
    const maxDepth = Math.max(0, ...rows.keys());
    const columnStep = NODE_WIDTH + COLUMN_GAP;
    const rowStep = NODE_HEIGHT + ROW_GAP;
    const width = PADDING * 2 + maxColumns * NODE_WIDTH + (maxColumns - 1) * COLUMN_GAP;
    const height = PADDING * 2 + (maxDepth + 1) * NODE_HEIGHT + maxDepth * ROW_GAP;
    const positions = new Map<string, { x: number; y: number }>();
    for (const [depth, row] of rows) {
      row.sort((left, right) => (left.title ?? left.campaignId).localeCompare(right.title ?? right.campaignId));
      const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
      const startX = (width - rowWidth) / 2;
      row.forEach((node, index) => positions.set(node.campaignId.toLowerCase(), { x: startX + index * columnStep, y: PADDING + depth * rowStep }));
    }
    const edges = tree.nodes.flatMap((node) => parentIds(node)
      .filter((parentId) => nodesById.has(parentId))
      .map((parentId) => ({ parentId, childId: node.campaignId.toLowerCase() })));
    return { positions, edges, width, height };
  }, [tree]);

  const highlighted = useMemo(() => {
    if (!hoveredId) return { nodes: new Set<string>(), edges: new Set<string>() };
    const ids = new Set([hoveredId]);
    const edges = new Set<string>();
    const visit = (start: string, direction: "parentId" | "childId") => {
      const queue = [start];
      while (queue.length) {
        const id = queue.shift()!;
        for (const edge of graph.edges) {
          const next = direction === "parentId" && edge.childId === id ? edge.parentId
            : direction === "childId" && edge.parentId === id ? edge.childId : null;
          if (next && !ids.has(next)) {
            ids.add(next);
            queue.push(next);
          }
          if (next) edges.add(`${edge.parentId}:${edge.childId}`);
        }
      }
    };
    visit(hoveredId, "parentId");
    visit(hoveredId, "childId");
    return { nodes: ids, edges };
  }, [graph.edges, hoveredId]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  }, [tree, zoom, graph.width, graph.height]);

  return (
    <div ref={viewportRef} className="campaign-freight-tree-viewport" role="region" aria-label="Freight graph diagram" tabIndex={0}>
      <div className="campaign-freight-tree-zoom-space" style={{ width: graph.width * zoom, height: graph.height * zoom }}>
        <div className="campaign-freight-tree-graph" style={{ width: graph.width, height: graph.height, transform: `scale(${zoom})` }}>
          <svg className="campaign-freight-tree-edges" width={graph.width} height={graph.height} aria-hidden="true">
            {graph.edges.map(({ parentId, childId }) => {
              const parent = graph.positions.get(parentId);
              const child = graph.positions.get(childId);
              if (!parent || !child) return null;
              const parentX = parent.x + NODE_WIDTH / 2;
              const childX = child.x + NODE_WIDTH / 2;
              const parentBottom = parent.y + NODE_HEIGHT;
              const childTop = child.y;
              const bendY = (parentBottom + childTop) / 2;
              return <path key={`${parentId}:${childId}`}
                d={`M ${parentX} ${parentBottom} V ${bendY} H ${childX} V ${childTop}`}
                className={highlighted.edges.has(`${parentId}:${childId}`) ? "campaign-freight-tree-edge-highlighted" : undefined} />;
            })}
          </svg>
          {tree.nodes.map((node) => {
            const id = node.campaignId.toLowerCase();
            const position = graph.positions.get(id);
            if (!position) return null;
            return <a key={id} href={`/freight/${encodeURIComponent(node.campaignId)}`}
              className={`campaign-freight-tree-node${id === tree.currentCampaignId.toLowerCase() ? " campaign-freight-tree-node-current" : ""}${highlighted.nodes.has(id) ? " campaign-freight-tree-node-highlighted" : ""}`}
              style={{ left: position.x, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              onMouseEnter={() => setHoveredId(id)} onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(id)} onBlur={() => setHoveredId(null)}>
              <span className="campaign-freight-tree-node-title">{node.title?.trim() || "Untitled freight"}</span>
            </a>;
          })}
        </div>
      </div>
    </div>
  );
}
