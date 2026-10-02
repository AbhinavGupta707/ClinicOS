import { mkdir, open, writeFile, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
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
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        );
        try {
          const stat = await handle.stat();
          if (!stat.isFile()) throw new Error(`Acceptance input must be a regular file: ${name}`);
          original = { content: await handle.readFile(), mode: stat.mode & 0o777 };
        } finally {
          await handle.close();
        }
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
    for (const { name, path, original } of originals) {
      if (original) {
        // Replace the directory entry; never follow a symlink substituted by a build.
        const replacement = join(lock, `restore-${name}`);
        const handle = await open(replacement, "wx", 0o600);
        try {
          await handle.writeFile(original.content);
          await handle.chmod(original.mode);
        } finally {
          await handle.close();
        }
        await rename(replacement, path);
      } else {
        await rm(path, { force: true });
      }
    }
    await rm(lock, { recursive: true });
    restored = true;
  };
}
