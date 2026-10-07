"use client";

import { useLayoutEffect, useMemo, useRef } from "react";

import type { FreightNode, FreightTree } from "@/app/_components/FreightTreeInfo";

export default function FreightTreeDiagram({ tree }: { tree: FreightTree }) {
  const viewportRef = useRef<HTMLDivElement>(null);
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
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  }, [tree]);

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
      <ul className="campaign-freight-tree-level campaign-freight-tree-root">
        {roots.map(renderNode)}
      </ul>
    </div>
  );
}
