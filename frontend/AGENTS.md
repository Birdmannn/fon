<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## FON UI conventions

Before making a FON UI change, inspect the existing implementation and comparable
screens to learn the project's normal layout, typography, spacing, controls, and
transitions. Reuse existing components and CSS classes. In particular, info-modal
sections use `create-info-constraints-copy` and `create-review-section-label`;
actions use `create-info-confirm-btn` and the existing action/control containers.
Add only the styles needed for the requested differences.
