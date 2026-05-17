# CSS Organization

This directory contains modular CSS files organized by component/feature for easier maintenance and debugging.

## File Structure

```
styles/
├── base.css           # Theme variables, fonts, body styles, utility classes
├── marquee.css        # Retro scrolling marquee component
├── wallet.css         # Wallet connection, info modal, chain indicators
├── header.css         # Header info button, modal, and actions
├── campaign.css       # Campaign cards, actions, status, search, FAB
├── create-modal.css   # Campaign creation modal (main editor)
└── create-review.css  # Campaign creation review/preview step
```

## Import Order

All files are imported in `app/globals.css` in this order:

1. **base.css** - Must be first (defines CSS variables used by other files)
2. **Component files** - Can be in any order (no dependencies between them)

## Naming Conventions

### File Names
- Lowercase with hyphens: `create-modal.css`
- Named after the component or feature they style

### Class Names
- Component-based: `.component-name-element`
- State modifiers: `.component-name-state`
- Examples:
  - `.wallet-info-modal`
  - `.wallet-info-modal-closing`
  - `.campaign-action-btn`
  - `.campaign-action-active`

## Adding New Styles

### For a new component:
1. Create a new file: `styles/your-component.css`
2. Add a header comment describing the component
3. Import it in `globals.css`

### For existing components:
1. Find the appropriate file based on the component
2. Add your styles in that file
3. Follow existing naming patterns

## Quick Reference

| Component | File | Key Classes |
|-----------|------|-------------|
| Theme colors | `base.css` | `.theme-bg`, `.theme-fg`, `.theme-button` |
| Marquee | `marquee.css` | `.retro-marquee-track`, `.retro-marquee-viewport` |
| Wallet | `wallet.css` | `.wallet-info-modal`, `.wallet-chain-indicator` |
| Header | `header.css` | `.header-info-btn`, `.header-info-modal` |
| Campaigns | `campaign.css` | `.campaign-action-btn`, `.status-indicator` |
| Create Modal | `create-modal.css` | `.create-campaign-modal`, `.create-modal-send-btn` |
| Review Step | `create-review.css` | `.create-review-preview-card`, `.create-review-args-grid` |

## Debugging Tips

### Finding a style:
1. Inspect the element in browser DevTools
2. Note the class name (e.g., `.wallet-info-modal`)
3. Search for that class in the appropriate file:
   - `wallet-*` → `wallet.css`
   - `header-*` → `header.css`
   - `campaign-*` → `campaign.css`
   - `create-*` → `create-modal.css` or `create-review.css`
   - `retro-*` → `marquee.css`

### Common issues:
- **Styles not applying**: Check import order in `globals.css`
- **CSS variables not working**: Ensure `base.css` is imported first
- **Animations not working**: Check for `@keyframes` in the same file as the animation

## Performance Notes

- All files are bundled together at build time
- No runtime performance impact from splitting files
- Better for development and maintenance
- Easier code splitting if needed in the future
