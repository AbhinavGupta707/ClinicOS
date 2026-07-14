import { requireNativeModule } from "expo-modules-core";

export interface ProtectedDirectoryResult {
  uri: string;
  path: string;
  backupExcluded: boolean;
  deviceProtected: boolean;
}

export default requireNativeModule<{
  prepareProtectedDirectoryAsync(): Promise<ProtectedDirectoryResult>;
}>("ClinicSecureStorage");
