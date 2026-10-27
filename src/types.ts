export interface Mint {
  decimals: number;
  supplyRaw: string;
  extensions: number[];
  hook: {
    status: "configured" | "disabled" | "absent" | "legacy";
    authority: string | null;
    programId: string | null;
  };
}
export interface ExtraMeta {
  index: number;
  kind: "static" | "hook-pda" | "external-pda" | "pubkey-data" | "unknown";
  discriminator: number;
  address: string | null;
  programIndex: number | null;
  configHex: string;
  signer: boolean;
  writable: boolean;
}
export interface Account {
  owner: string;
  executable: boolean;
  data: Buffer;
  slot: number;
}
export interface Inspection {
  version: 1;
  source: "rpc" | "example";
  exampleName?: string;
  mint: string;
  network: "mainnet" | "devnet";
  observedAt: string;
  slot: number;
  mintInfo: Mint;
  program: {
    status: "not-requested" | "found" | "missing" | "unavailable";
    executable: boolean | null;
    owner: string | null;
    slot: number | null;
  };
  extra: {
    address: string | null;
    status: "not-requested" | "found" | "missing" | "unavailable";
    slot: number | null;
    entries: ExtraMeta[];
  };
  notes: string[];
}
