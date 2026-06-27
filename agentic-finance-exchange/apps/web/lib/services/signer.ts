/**
 * Firma transazioni Web3: interfaccia verso KMS (mock in dev).
 * Le chiavi private non devono mai comparire in chiaro nel codice applicativo.
 */

export type SignTransactionRequest = {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  valueWei?: bigint;
  gasLimit?: bigint;
};

export type SignedTransaction = {
  rawTransaction: `0x${string}`;
  hash: `0x${string}`;
  kmsKeyId: string;
};

export type KeyManagementService = {
  /** Identificativo log (audit) — nessun segreto. */
  readonly keyRef: string;
  signTransaction(req: SignTransactionRequest): Promise<SignedTransaction>;
};

/** Mock KMS: restituisce pseudo-tx senza crittografia reale. */
export function createMockKmsSigner(keyRef = "mock-kms-afx-001"): KeyManagementService {
  return {
    keyRef,
    async signTransaction(req: SignTransactionRequest): Promise<SignedTransaction> {
      const digest = `${req.chainId}:${req.to}:${req.data.slice(0, 18)}`;
      const hash = `0x${Buffer.from(digest).toString("hex").padEnd(64, "0").slice(0, 64)}` as `0x${string}`;
      return {
        rawTransaction: `0xf8${req.data.slice(2, 10)}00` as `0x${string}`,
        hash,
        kmsKeyId: keyRef,
      };
    },
  };
}

let _defaultSigner: KeyManagementService | null = null;

export function getSigner(): KeyManagementService {
  if (!_defaultSigner) {
    _defaultSigner = createMockKmsSigner(
      process.env.AFX_KMS_KEY_REF ?? "mock-kms-afx-001",
    );
  }
  return _defaultSigner;
}
