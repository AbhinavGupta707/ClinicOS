import type {
  ClinicOperationsRepository,
  DurableIntegrityRepository,
  RepositoryScope
} from "../../repositories.ts";
import type { RepositoryPortTransactionLease } from "../core/scoped-repository-port.ts";

export const DURABLE_INTEGRITY_OPERATIONS = [
  "recordClinicalMediaReceipt",
  "checkInAppointmentWithQueue",
  "findProviderEligibility",
  "findActivePaymentProviderAccount",
  "appendPaymentProviderIntegrationOutboxEvent",
  "claimPaymentRequestIntent",
  "claimStoredPaymentRequestIntent",
  "findPaymentRequestIntentById",
  "finalizePaymentRequestIntent",
  "claimVerifiedPaymentProviderEvent",
  "createPaymentReconciliation",
  "completePaymentProviderEvent"
] as const satisfies readonly (keyof DurableIntegrityRepository)[];

type RemoveRepositoryScope<TOperation> = TOperation extends (
  scope: RepositoryScope,
  ...args: infer TArgs
) => infer TResult
  ? (...args: TArgs) => TResult
  : never;

export type DurableIntegrityRepositoryPort = Readonly<{
  [TOperation in keyof DurableIntegrityRepository]: RemoveRepositoryScope<
    DurableIntegrityRepository[TOperation]
  >;
}>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindDurableIntegrityRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): DurableIntegrityRepositoryPort {
  const durableRepository = repository as ClinicOperationsRepository &
    Partial<DurableIntegrityRepository>;
  const adapter = Object.create(null) as Record<string, (...args: unknown[]) => unknown>;

  for (const operationName of DURABLE_INTEGRITY_OPERATIONS) {
    Object.defineProperty(adapter, operationName, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: (...args: unknown[]) =>
        lease.execute(async () => {
          const operation = durableRepository[operationName];
          if (typeof operation !== "function") {
            throw new DurableIntegrityRepositoryUnavailableError(operationName);
          }
          return (
            operation as (scope: RepositoryScope, ...input: unknown[]) => Promise<unknown>
          ).call(durableRepository, scope, ...args);
        })
    });
  }

  return Object.freeze(adapter) as DurableIntegrityRepositoryPort;
}

export class DurableIntegrityRepositoryUnavailableError extends Error {
  readonly code = "DURABLE_INTEGRITY_REPOSITORY_UNAVAILABLE";

  constructor(operationName: keyof DurableIntegrityRepository) {
    super(`Durable integrity repository operation ${operationName} is not available.`);
    this.name = "DurableIntegrityRepositoryUnavailableError";
  }
}
