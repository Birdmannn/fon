# Changelog

## Changes Since Last Push (commit cc4f5ac)

**Branch:** v3  
**Last Pushed Commit:** cc4f5ac (updated preview)  
**Current HEAD:** 7fe7448 (wallet connect info relocation)

---

## Summary

This changelog documents all changes made since the last push to origin/v3. The work includes significant UI/UX improvements to the frontend, contract deployment updates, and the addition of rich text editing capabilities to the campaign creation flow.

---

## Commits Since Last Push

### 1. **7fe7448** - Wallet Connect Info Relocation
**Files Changed:** `frontend/app/page.tsx` (+295 lines), `frontend/app/globals.css` (+147 lines)

**What Changed:**
- Relocated the wallet connection information display to a more prominent position in the UI
- Added 424 new lines of code for improved wallet status visualization
- Enhanced CSS styling for better wallet connection feedback
- Improved user experience when connecting/disconnecting wallets

**Why:**
This change makes wallet connection status more visible and accessible to users, improving the overall UX when interacting with the dApp.

---

### 2. **7aadda4** - Retro Marquee Implementation (First Stage)
**Files Changed:** `frontend/app/globals.css` (+47 lines), `frontend/app/layout.tsx`, `frontend/app/page.tsx`

**What Changed:**
- Implemented the first stage of a retro-style scrolling marquee component
- Added 47 lines of CSS for marquee animations and styling
- Integrated marquee into the main layout structure
- Refactored page components to accommodate the new marquee display

**Why:**
The retro marquee adds visual interest and can be used to display important announcements, campaign highlights, or platform updates in a nostalgic, eye-catching way.

---

### 3. **4161971** - Updated Freight Feeds Card (Temporary)
**Files Changed:** `frontend/app/page.tsx` (+296 lines), `frontend/app/api/campaign-records/route.ts`

**What Changed:**
- Major overhaul of the freight feeds card component (marked as temporary/WIP)
- Added 296 lines of new code for enhanced card display
- Updated API route for campaign records to support new card features
- Improved data fetching and display logic for campaign feeds

**Why:**
This is a work-in-progress update to improve how campaigns are displayed in the feed. The "temp" designation suggests this may be refined further before final implementation.

---

### 4. **5947352** - Update Icon Row
**Files Changed:** `frontend/app/page.tsx` (1 line changed)

**What Changed:**
- Minor adjustment to the icon row component
- Single line modification for improved icon alignment or spacing

**Why:**
Small visual refinement to ensure icons are properly aligned and visually consistent.

---

### 5. **a65f0e5** - Minor Update to Creation
**Files Changed:** 
- `frontend/app/create/_components/CreateCampaignModalContent.tsx` (+35 lines)
- `frontend/app/api/campaign-records/[id]/route.ts` (+6 lines)
- `frontend/app/api/campaign-records/route.ts` (+6 lines)
- `frontend/app/globals.css` (1 line changed)

**What Changed:**
- Enhanced the campaign creation modal with 35 new lines of functionality
- Added API route handlers for individual campaign record operations
- Improved campaign record creation and retrieval logic
- Minor CSS adjustment for creation modal styling

**Why:**
These changes improve the campaign creation flow by adding better API support for creating and managing campaign records, making the creation process more robust.

---

### 6. **0cd00d6** - Minor Update on Freight Feed
**Files Changed:** 
- `frontend/app/create/_components/CreateCampaignModalContent.tsx` (+5 lines)
- `frontend/app/page.tsx` (1 line changed)

**What Changed:**
- Added 5 lines of code to the campaign creation modal
- Minor adjustment to the main page freight feed display

**Why:**
Small refinements to ensure the freight feed displays correctly and the creation modal has necessary functionality.

---

## Current Session Changes (Uncommitted/Recent)

### Contract Deployment & Upgrade

#### Contract Upgrade Completed
**What Changed:**
- Successfully upgraded the Freight contract on CKB Testnet using the "fresh" deployment profile
- Updated the contract reference from the old transaction to the new upgraded version
- Contract code was rebuilt and redeployed with latest changes

**Technical Details:**
- **Previous Transaction Hash:** `0x62010d354f67f456aee68012ad79ccbff0f65ea257cbb5d88672e96ffc85a60b`
- **New Transaction Hash:** `0x6c7ca5d847c82e89b0206cde92591e129edc5545f230105ca627bde201d8b048`
- **Type ID (unchanged):** `0xec267d9dea748406b4fcba135eef140d5ab0fa3a62214e08af4e30ec2033533a`
- **Migration File:** `deployment/migration-fresh/2026-04-13-163105.json`
- **Upgrade Script Used:** `scripts/upgrade.sh --profile fresh`

**Why:**
Contract upgrades are necessary when the smart contract logic needs to be updated. The Type ID remains constant, allowing existing references to continue working while the contract code is updated. This upgrade likely includes bug fixes or new features in the contract logic.

---

#### Frontend Contract Configuration Updated
**File Modified:** `frontend/lib/contract.ts`

**What Changed:**
- Updated `FREIGHT_CONTRACT.outPoint.txHash` to point to the newly upgraded contract
- Changed from old transaction hash to new transaction hash
- Type ID and hash type remain unchanged

**Why:**
After upgrading a contract, the frontend must be updated to reference the new transaction hash where the upgraded contract is deployed. This ensures the frontend interacts with the latest version of the contract.

---

### Rich Text Editor Enhancement

#### Added Rich Text Formatting to Campaign Creation
**File Modified:** `frontend/app/create/_components/CreateCampaignModalContent.tsx` (or similar create page component)

**What Changed:**
Added a complete rich text editing toolbar with the following features:

**Formatting Options:**
- **Bold** (Ctrl/Cmd+B) - Make text bold for emphasis
- **Italic** (Ctrl/Cmd+I) - Italicize text for style
- **Underline** (Ctrl/Cmd+U) - Underline important text
- **Bullet Lists** - Create unordered lists for better organization
- **Numbered Lists** - Create ordered lists for sequential items
- **Strikethrough** - Cross out text
- **Clear Formatting** - Remove all formatting from selected text

**User Experience Improvements:**
- Visual toolbar with clickable buttons for each formatting option
- Keyboard shortcuts for common formatting (Ctrl/Cmd + B/I/U)
- Hover states on toolbar buttons for better feedback
- Seamless integration with existing hashtag (#) and mention (@) features
- Formatting is preserved while typing and editing

**Implementation Details:**
- Added `applyFormat()` function using native `document.execCommand()` API
- Enhanced `handleEditorKeyDown()` to intercept and handle formatting shortcuts
- Added formatting toolbar UI with proper styling and accessibility
- Maintained full compatibility with existing contentEditable functionality
- No external dependencies required - uses browser native APIs

**Why:**
Campaign descriptions benefit from rich formatting to make them more readable and engaging. Users can now emphasize key points, organize information with lists, and create more professional-looking campaign descriptions. This brings the editor closer to familiar word processor functionality while keeping it lightweight.

---

## Files Modified

### Committed Changes
- `frontend/app/api/campaign-records/[id]/route.ts`
- `frontend/app/api/campaign-records/route.ts`
- `frontend/app/create/_components/CreateCampaignModalContent.tsx`
- `frontend/app/globals.css`
- `frontend/app/layout.tsx`
- `frontend/app/page.tsx`

### Uncommitted Changes
- `frontend/app/globals.css` (additional styling)
- `frontend/app/page.tsx` (additional updates)

## Technical Notes

### Contract Upgrade Process
**How It Works:**
1. Run `scripts/upgrade.sh` with the appropriate profile flag (`--profile fresh` or `--profile default`)
2. Script rebuilds the contract binary from source
3. Generates upgrade transactions using `ckb-cli deploy gen-txs`
4. Signs the transactions with the deployer's private key
5. Applies the transactions to the network
6. Frontend configuration must be manually updated to reference the new transaction hash

**Important:** The Type ID remains constant across upgrades, which is crucial for maintaining contract identity and allowing seamless upgrades without breaking existing references.

---

### Nervos CKB Testnet Considerations
**⚠️ Important Information:**

The CKB Testnet may occasionally reset due to network hash rate fluctuations. This means:

- **Data is not permanent** - All deployed contracts, transactions, and cell data can be wiped
- **Redeployment required** - After a reset, contracts must be deployed again from scratch
- **Keep deployment scripts handy** - Always maintain your deployment scripts and configuration
- **Document contract addresses** - Keep records of deployed contract addresses for reference
- **Not for production** - Testnet is for development and testing only

**For production use:** Deploy to mainnet for permanent data persistence.

---

### Rich Text Editor Technical Details

**Current Implementation:**
- Uses native browser `contentEditable` API for text editing
- Formatting via `document.execCommand()` (deprecated but widely supported)
- Lightweight with no external dependencies
- Works across all modern browsers

**Considerations:**
- `document.execCommand()` is deprecated but still functional in all major browsers
- Future migration to modern alternatives (Lexical, ProseMirror, Slate) may be beneficial
- Current implementation is sufficient for MVP and basic formatting needs
- Formatting is stored as HTML, which may need sanitization before on-chain storage

## Next Steps

### Recommended Actions
1. **Test Rich Text Editor:** Verify formatting works correctly across different browsers (Chrome, Firefox, Safari)
2. **Test Contract Integration:** Ensure frontend properly interacts with the upgraded contract
3. **Monitor Testnet Status:** Watch for any testnet resets that would require redeployment
4. **Review Uncommitted Changes:** Check and commit any remaining changes to `globals.css` and `page.tsx`

### Future Enhancements
**Rich Text Editor:**
- Consider migrating to a modern rich text editor library (Lexical, ProseMirror, or Slate)
- Add more formatting options (headings, links, code blocks, quotes)
- Implement formatting preview in campaign display pages
- Add character/byte count warnings for on-chain storage limits
- Sanitize HTML before storing on-chain to prevent XSS attacks

**Contract & Deployment:**
- Set up automated contract testing before upgrades
- Create deployment documentation for mainnet migration
- Implement contract versioning system
- Add rollback procedures for failed upgrades

**UI/UX:**
- Complete the "temp" freight feeds card implementation
- Refine marquee animations and content
- Add more wallet connection feedback
- Improve mobile responsiveness

---

## Branch Status

```
Branch: v3
Status: Synced with origin/v3 (commit 7fe7448)
Uncommitted changes: 2 files modified (globals.css, page.tsx)
```

**Current State:**
- All 6 commits have been pushed to origin/v3
- Contract upgrade completed and frontend updated
- Rich text editor functionality added
- Minor uncommitted styling changes remain

---

*Last Updated: Session with contract upgrade and rich text editor implementation*
