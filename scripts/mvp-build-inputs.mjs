import { mkdir, lstat, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";

// Next rewrites next-env.d.ts even when distDir and tsconfig are isolated.
// Preserve only these generated inputs; never reset the worktree or infer their
// original contents from Git. A lock prevents overlapping acceptance runners.
export function createAcceptanceBuildInputGuard(webRoot) {
  const preservation = preserveAcceptanceBuildInputs(webRoot);
  let restoration;
  return {
    ready: preservation.then(() => undefined),
    // Shutdown may arrive while the asynchronous snapshot is still being saved.
    restore: () => (restoration ??= preservation.then((restore) => restore()))
  };
}

async function preserveAcceptanceBuildInputs(webRoot) {
  const parent = join(webRoot, ".cache");
  const lock = join(parent, "mvp-acceptance-inputs.lock");
  await mkdir(parent, { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        "An acceptance build already owns the generated web inputs. If it was killed, inspect .cache/mvp-acceptance-inputs.lock before recovering its saved files."
      );
    }
    throw error;
  }
  const originals = [];
  try {
    for (const name of ["next-env.d.ts", ".tsconfig.mvp-acceptance.json"]) {
      const path = join(webRoot, name);
      let original;
      try {
        const stat = await lstat(path);
        if (!stat.isFile()) throw new Error(`Acceptance input must be a regular file: ${name}`);
        original = { content: await readFile(path), mode: stat.mode & 0o777 };
        await writeFile(join(lock, name), original.content, { mode: 0o600 });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      originals.push({ name, path, original });
    }
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify(
        {
          pid: process.pid,
          files: originals.map(({ name, original }) => ({
            name,
            existed: !!original,
            mode: original?.mode
          }))
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch (error) {
    await rm(lock, { recursive: true });
    throw error;
  }
  let restored = false;
  return async () => {
    if (restored) return;
    // Keep the backup/lock if restoration fails, so recovery remains possible.
    for (const { path, original } of originals) {
      if (original) {
        await writeFile(path, original.content);
        await chmod(path, original.mode);
      } else {
        await rm(path, { force: true });
      }
    }
    await rm(lock, { recursive: true });
    restored = true;
  };
}
