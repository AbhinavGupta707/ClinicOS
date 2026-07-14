import type {
  QueueStats,
  UploadQueueItem,
  UploadQueueRepository
} from "../types.ts";

export class ExpoSqlCipherQueueRepository implements UploadQueueRepository {
  constructor(..._nativeArguments: unknown[]) {}

  initialize(): Promise<void> { return Promise.reject(unavailable()); }
  verifyIntegrity(): Promise<boolean> { return Promise.resolve(false); }
  recoverInterrupted(_now: string): Promise<number> { return Promise.reject(unavailable()); }
  stats(): Promise<QueueStats> { return Promise.reject(unavailable()); }
  list(): Promise<readonly UploadQueueItem[]> { return Promise.reject(unavailable()); }
  get(_id: string): Promise<UploadQueueItem | null> { return Promise.reject(unavailable()); }
  insert(_item: UploadQueueItem): Promise<void> { return Promise.reject(unavailable()); }
  update(_item: UploadQueueItem): Promise<void> { return Promise.reject(unavailable()); }
  delete(_id: string): Promise<void> { return Promise.reject(unavailable()); }
  claimNext(_input: {
    now: string;
    leaseOwner: string;
    leaseExpiresAt: string;
  }): Promise<UploadQueueItem | null> { return Promise.reject(unavailable()); }
  shutdownAndDelete(): Promise<void> { return Promise.reject(unavailable()); }
}

function unavailable(): Error {
  return new Error("SQLCipher protected capture storage is unavailable on web.");
}
