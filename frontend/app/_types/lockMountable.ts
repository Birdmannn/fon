export type LockMountableCriterion = "fbars";
export type LockMountableRule = "block_below" | "block_at_or_above";

export type LockMountableConfig = {
  enabled: boolean;
  criterion: LockMountableCriterion;
  rule: LockMountableRule;
  minimumFbars: string;
};
