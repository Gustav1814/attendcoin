import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const emptyState = () => ({ profiles: {}, courses: {}, checkins: {} });

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(JSON.stringify(data, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Single-file JSON store. Reads come from memory. Writes are serialised through
 * one promise chain, so a mutation always sees the result of the previous one
 * and two requests can never interleave a read-check-write.
 */
export async function openStore(dataDir, fileName = "db.json") {
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, fileName);

  let state = emptyState();
  try {
    state = { ...emptyState(), ...JSON.parse(await readFile(file, "utf8")) };
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Could not load ${file}: ${err.message}`);
  }

  let tail = Promise.resolve();

  // The mutator works on a copy, so throwing inside it leaves state untouched.
  function update(mutate) {
    const run = tail.then(async () => {
      const draft = structuredClone(state);
      const result = await mutate(draft);
      await writeAtomic(file, draft);
      state = draft;
      return result;
    });
    tail = run.catch(() => {});
    return run;
  }

  return {
    file,
    read: () => state,
    update,
    flush: () => tail,
  };
}
