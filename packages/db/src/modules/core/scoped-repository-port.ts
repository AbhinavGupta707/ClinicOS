import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";

export type ScopedRepositoryOperationName = {
  [TName in keyof ClinicOperationsRepository]: ClinicOperationsRepository[TName] extends (
    scope: RepositoryScope,
    ...args: never[]
  ) => Promise<unknown>
    ? TName
    : never;
}[keyof ClinicOperationsRepository];

type RemoveRepositoryScope<TOperation> = TOperation extends (
  scope: RepositoryScope,
  ...args: infer TArgs
) => infer TResult
  ? (...args: TArgs) => TResult
  : never;

/**
 * An application-facing repository port whose authority is bound by the transaction adapter.
 * Tenant, clinic, and actor identifiers are intentionally absent from every operation.
 */
export type BoundClinicRepositoryPort<TName extends ScopedRepositoryOperationName> = Readonly<{
  [TOperation in TName]: RemoveRepositoryScope<ClinicOperationsRepository[TOperation]>;
}>;

export interface RepositoryPortTransactionLease {
  execute<TResult>(operation: () => Promise<TResult>): Promise<TResult>;
  close(): Promise<void>;
}

/** @internal Prevents transaction-bound ports from escaping or leaving unawaited work behind. */
export function createRepositoryPortTransactionLease(): RepositoryPortTransactionLease {
  let active = true;
  let tail: Promise<void> = Promise.resolve();
  const pending = new Set<Promise<unknown>>();

  return Object.freeze({
    execute<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
      if (!active) {
        throw new Error("Repository port is no longer inside its active unit of work.");
      }

      // node-postgres permits only one in-flight query per transaction-bound Client. Queue every
      // bound repository operation so callers cannot accidentally overlap queries with Promise.all.
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      pending.add(result);
      void result.then(
        () => pending.delete(result),
        () => pending.delete(result)
      );
      return result;
    },
    async close(): Promise<void> {
      active = false;
      await Promise.all([...pending]);
      await tail;
    }
  });
}

/** @internal Only module transaction composition may bind a legacy scoped repository. */
export function bindScopedRepositoryPort<
  const TOperations extends readonly ScopedRepositoryOperationName[]
>(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  operations: TOperations,
  lease: RepositoryPortTransactionLease
): BoundClinicRepositoryPort<TOperations[number]> {
  const adapter = Object.create(null) as Record<string, (...args: unknown[]) => unknown>;

  for (const operationName of operations) {
    const operation = repository[operationName];
    if (typeof operation !== "function") {
      throw new TypeError(`Repository operation ${String(operationName)} is not available.`);
    }

    Object.defineProperty(adapter, operationName, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: (...args: unknown[]) =>
        lease.execute(() =>
          (operation as (scope: RepositoryScope, ...args: unknown[]) => Promise<unknown>).call(
            repository,
            scope,
            ...args
          )
        )
    });
  }

  return Object.freeze(adapter) as BoundClinicRepositoryPort<TOperations[number]>;
}
