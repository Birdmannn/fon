# Freight trees and links

Published freights can have one direct parent and any number of direct children. A parent is stored as `parentCampaignId` on the child record. The `View Tree` action on a freight detail page shows its root, descendants, and tracking links. It also accepts the ID or URL of another published freight for an add-parent, add-child, or link action.

## Parent and child

- A freight creator may attach a parent to their freight. A different user may attach a freight they created as the parent only when their current FBARS are at least 10 times the child freight creator's current FBARS. The server verifies the wallet signature and both balances when the relationship is made; the encroachment balances are stored with the link.
- A child has only one direct parent. The server rejects cycles and concurrent attempts to attach different parents.
- A participant is canonically verified on a child only after their own base activity, forms, mounted-app principles, optional linked-freight requirement, and the same wallet's parent verification are all satisfied. The check recurses through the ancestor chain.
- Adding a new head parent re-evaluates existing participants across its descendants. A previously verified participant becomes pending if they have not fulfilled that head parent. Later parent status changes propagate to descendants.
- Previously distributed on-chain rewards are historical transactions and are **not reversed** by a new parent. The new parent changes current off-chain completion status only.

## Linked freights

`linkedCampaignIds` are tracking links, separate from the parent tree. The freight detail view shows outgoing and incoming links. By default, a link does not affect completion.

The freight creator can enable **Require each participant to create a linked freight**. With this enabled, the participant may link a published freight they created to this freight. The participant's canonical verification stays pending until at least one such linked freight exists. The source freight's creator may also add a tracking link; only links to a freight created by the participant satisfy that participant's requirement.

Relationships and settings are managed by the wallet-signed `/api/freights/tree` endpoint. Participant completion remains in MongoDB; these relationships do not create on-chain completion records.
