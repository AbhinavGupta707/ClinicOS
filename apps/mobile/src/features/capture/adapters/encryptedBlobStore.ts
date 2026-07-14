import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync
} from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import type { EncryptedCaptureBlobStore } from "../types";
import { ProtectedCaptureDirectory } from "./protectedDirectory";
import { SecureCaptureKeyVault } from "./secureKeyVault";

export class ExpoEncryptedCaptureBlobStore implements EncryptedCaptureBlobStore {
  readonly #root: ProtectedCaptureDirectory;
  readonly #keys: SecureCaptureKeyVault;
  #blobs: Directory | null = null;
  #quarantine: Directory | null = null;

  constructor(root: ProtectedCaptureDirectory, keys: SecureCaptureKeyVault) {
    this.#root = root;
    this.#keys = keys;
  }

  async initialize(): Promise<void> {
    const { directory } = await this.#root.prepare();
    this.#blobs = new Directory(directory, "sealed");
    this.#quarantine = new Directory(directory, "quarantine");
    for (const child of [this.#blobs, this.#quarantine]) {
      if (!child.exists) child.create({ idempotent: true, intermediates: true });
      for (const entry of child.list()) {
        if (entry instanceof File && entry.name.endsWith(".tmp")) entry.delete();
      }
    }
  }

  async availableBytes(): Promise<number> {
    return Paths.availableDiskSpace;
  }

  async put(id: string, plaintext: Uint8Array): Promise<void> {
    assertOpaqueId(id);
    const blobs = this.#requireDirectory(this.#blobs);
    const target = new File(blobs, `${id}.sealed`);
    if (target.exists) throw new Error("Encrypted capture blob already exists.");
    const temporary = new File(blobs, `${id}.tmp`);
    const key = await AESEncryptionKey.import(await this.#keys.getMediaKeyHex(), "hex");
    const aad = new TextEncoder().encode(`clinicos-capture:v1:${id}`);
    const sealed = await aesEncryptAsync(plaintext, key, { additionalData: aad, tagLength: 16 });
    const combined = await sealed.combined();
    temporary.create({ overwrite: false });
    try {
      temporary.write(combined);
      if (temporary.size !== combined.byteLength) {
        throw new Error("Encrypted capture write was incomplete.");
      }
      await temporary.move(target);
    } catch (error) {
      if (temporary.exists) temporary.delete();
      throw error;
    }
  }

  async get(id: string): Promise<Uint8Array> {
    assertOpaqueId(id);
    const file = new File(this.#requireDirectory(this.#blobs), `${id}.sealed`);
    if (!file.exists) throw new Error("Encrypted capture blob is missing.");
    const combined = await file.bytes();
    const key = await AESEncryptionKey.import(await this.#keys.getMediaKeyHex(), "hex");
    const aad = new TextEncoder().encode(`clinicos-capture:v1:${id}`);
    return aesDecryptAsync(AESSealedData.fromCombined(combined), key, {
      additionalData: aad,
      output: "bytes"
    });
  }

  async delete(id: string): Promise<void> {
    assertOpaqueId(id);
    for (const directory of [this.#blobs, this.#quarantine]) {
      const file = new File(this.#requireDirectory(directory), `${id}.sealed`);
      if (file.exists) file.delete();
    }
  }

  async quarantine(id: string): Promise<void> {
    assertOpaqueId(id);
    const source = new File(this.#requireDirectory(this.#blobs), `${id}.sealed`);
    if (!source.exists) return;
    const target = new File(this.#requireDirectory(this.#quarantine), `${id}.sealed`);
    if (target.exists) target.delete();
    await source.move(target);
  }

  async purgeAll(): Promise<void> {
    for (const directory of [this.#blobs, this.#quarantine]) {
      const child = this.#requireDirectory(directory);
      if (child.exists) child.delete();
    }
    await this.initialize();
  }

  async shutdownAndDelete(): Promise<void> {
    const directories = [this.#blobs, this.#quarantine];
    const failures: unknown[] = [];
    for (const directory of directories) {
      if (directory?.exists) {
        try {
          directory.delete();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (directories.some((directory) => directory?.exists)) {
      failures.push(new Error("Protected capture media deletion could not be verified."));
    }
    this.#blobs = null;
    this.#quarantine = null;
    if (failures.length > 0) {
      throw new Error("Protected capture media shutdown and deletion did not complete.");
    }
  }

  #requireDirectory(directory: Directory | null): Directory {
    if (!directory) throw new Error("Encrypted capture blob store is not initialized.");
    return directory;
  }
}

function assertOpaqueId(value: string): void {
  if (!/^[a-f0-9-]{20,64}$/i.test(value)) throw new TypeError("Capture blob identifier is invalid.");
}
