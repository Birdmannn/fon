export type LockMountableCriterion = "fbars";

export type LockMountableConfig = {
  enabled: boolean;
  criterion: LockMountableCriterion;
  minimumFbars: string;
};
