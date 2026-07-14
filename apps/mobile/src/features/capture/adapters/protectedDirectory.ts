import { Directory } from "expo-file-system";
import ClinicSecureStorage from "../../../../modules/clinic-secure-storage";

export interface ProtectedCaptureDirectoryInfo {
  directory: Directory;
  path: string;
}

export class ProtectedCaptureDirectory {
  #prepared: Promise<ProtectedCaptureDirectoryInfo> | null = null;

  prepare(): Promise<ProtectedCaptureDirectoryInfo> {
    this.#prepared ??= this.#prepare();
    return this.#prepared;
  }

  async #prepare(): Promise<ProtectedCaptureDirectoryInfo> {
    const result = await ClinicSecureStorage.prepareProtectedDirectoryAsync();
    if (!result.backupExcluded || !result.deviceProtected) {
      throw new Error("Native capture storage did not confirm backup exclusion and device protection.");
    }
    if (!result.uri.startsWith("file://") || !result.path.startsWith("/")) {
      throw new Error("Native capture storage returned an invalid app-private directory.");
    }
    const directory = new Directory(result.uri);
    if (!directory.exists) directory.create({ idempotent: true, intermediates: true });
    return { directory, path: result.path };
  }
}
