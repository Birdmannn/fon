"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { FreightNode, FreightTree } from "@/app/_components/FreightTreeInfo";

export default function FreightTreeDiagram({ tree, zoom = 1 }: { tree: FreightTree; zoom?: number }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLUListElement>(null);
  const [diagramSize, setDiagramSize] = useState({ width: 0, height: 0 });
  const { roots, childrenByParent } = useMemo(() => {
    const nodesById = new Map(tree.nodes.map((node) => [node.campaignId.toLowerCase(), node]));
    const children = new Map<string, FreightNode[]>();
    const rootNodes: FreightNode[] = [];
    for (const node of tree.nodes) {
      const parentId = node.parentCampaignId?.toLowerCase();
      if (!parentId || !nodesById.has(parentId)) {
        rootNodes.push(node);
      } else {
        const siblings = children.get(parentId) ?? [];
        siblings.push(node);
        children.set(parentId, siblings);
      }
    }
    return { roots: rootNodes, childrenByParent: children };
  }, [tree]);

  useLayoutEffect(() => {
    const diagram = diagramRef.current;
    if (!diagram) return;
    const measure = () => {
      const width = diagram.offsetWidth;
      const height = diagram.offsetHeight;
      setDiagramSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(diagram);
    return () => observer.disconnect();
  }, [tree]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  }, [tree, zoom, diagramSize]);

  const renderNode = (node: FreightNode) => {
    const children = childrenByParent.get(node.campaignId.toLowerCase()) ?? [];
    return (
      <li key={node.campaignId} className="campaign-freight-tree-branch">
        <a
          href={`/freight/${encodeURIComponent(node.campaignId)}`}
          className={`campaign-freight-tree-node${node.campaignId.toLowerCase() === tree.currentCampaignId.toLowerCase() ? " campaign-freight-tree-node-current" : ""}`}
        >
          {node.title?.trim() || "Untitled freight"}
        </a>
        {children.length > 0 ? (
          <ul className="campaign-freight-tree-level">
            {children.map(renderNode)}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div ref={viewportRef} className="campaign-freight-tree-viewport" role="region" aria-label="Freight tree diagram" tabIndex={0}>
      <div className="campaign-freight-tree-zoom-space" style={diagramSize.width ? { width: diagramSize.width * zoom, height: diagramSize.height * zoom } : undefined}>
        <ul ref={diagramRef} className="campaign-freight-tree-level campaign-freight-tree-root" style={{ transform: `scale(${zoom})` }}>
          {roots.map(renderNode)}
        </ul>
      </div>
    </div>
  );
}
