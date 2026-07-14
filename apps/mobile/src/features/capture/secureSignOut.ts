export interface SecureSignOutOperations {
  clearSessionTokens(): Promise<void>;
  shutdownAndDeleteLocalState(): Promise<void>;
  destroyCaptureKeysAfterVerifiedPurge(): Promise<void>;
}

export interface SecureSignOutResult {
  sessionTokensCleared: boolean;
  localStateDeleted: boolean;
  captureKeysDestroyed: boolean;
}

export async function performSecureSignOut(
  operations: SecureSignOutOperations
): Promise<SecureSignOutResult> {
  let sessionTokensCleared = false;
  let localStateDeleted = false;
  let captureKeysDestroyed = false;

  try {
    await operations.clearSessionTokens();
    sessionTokensCleared = true;
  } catch {
    // Continue with local cryptographic purge. The UI must remain signed out either way.
  }
  try {
    await operations.shutdownAndDeleteLocalState();
    localStateDeleted = true;
  } catch {
    // Capture keys must remain available for a later verified physical-deletion retry.
  }
  if (localStateDeleted) {
    try {
      await operations.destroyCaptureKeysAfterVerifiedPurge();
      captureKeysDestroyed = true;
    } catch {
      // Local ciphertext is already verified absent; report key deletion failure without restoring session UI.
    }
  }

  return { sessionTokensCleared, localStateDeleted, captureKeysDestroyed };
}
