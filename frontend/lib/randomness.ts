import { blake2b } from "@nervosnetwork/ckb-sdk-utils";
import { bytesToHex } from "./encoding";

export type RandomnessCommitment = {
  preimage: Uint8Array;
  commitment: Uint8Array;
};

export function createRandomnessCommitment(): RandomnessCommitment {
  const preimage = crypto.getRandomValues(new Uint8Array(32));
  const hasher = blake2b(32, null, null, null);
  hasher.update(preimage);
  const commitment = hasher.digest("binary") as Uint8Array;

  return {
    preimage,
    commitment,
  };
}

export function randomnessPreimageToHex(preimage: Uint8Array): string {
  return bytesToHex(preimage);
}
