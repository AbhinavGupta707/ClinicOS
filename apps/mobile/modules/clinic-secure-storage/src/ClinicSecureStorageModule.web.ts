import type { ProtectedDirectoryResult } from "./ClinicSecureStorageModule";

export default {
  async prepareProtectedDirectoryAsync(): Promise<ProtectedDirectoryResult> {
    throw new Error("Protected native capture storage is unavailable on web.");
  }
};
