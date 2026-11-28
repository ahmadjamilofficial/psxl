import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, copyFile, cp, mkdir, readFile, rename, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const modelDir = join(publicDir, "models");
const vendorDir = join(publicDir, "vendor", "cactus-needle");

const MODEL_URL = "https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact";
const MODEL_LICENSE_URL = "https://huggingface.co/Cactus-Compute/needle3/resolve/main/LICENSE";
const MODEL_SHA256 = "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38";
const MODEL_SIZE = 35_335_380;
const WRAPPER_VERSION = "0.3.0";
const WRAPPER_URL = "https://registry.npmjs.org/cactus-needle/-/cactus-needle-" + WRAPPER_VERSION + ".tgz";

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function download(url, destination, expectedSha256, expectedSize) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error("Download failed (" + response.status + ") for " + url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expectedSize !== undefined && bytes.length !== expectedSize) {
    throw new Error("Unexpected asset size: expected " + expectedSize + ", received " + bytes.length);
  }
  if (expectedSha256) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expectedSha256) throw new Error("SHA-256 mismatch for " + url + ": received " + actual);
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = destination + ".download";
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
  console.log("[PSXL Needle] Downloaded " + destination + " (" + (bytes.length / 1024 / 1024).toFixed(1) + " MB)");
}

async function ensureModel() {
  await mkdir(modelDir, { recursive: true });
  const destination = join(modelDir, "needle3.cact");
  if (await exists(destination)) {
    const bytes = await readFile(destination);
    const valid = bytes.length === MODEL_SIZE && createHash("sha256").update(bytes).digest("hex") === MODEL_SHA256;
    if (valid) {
      console.log("[PSXL Needle] Verified cached Needle 3 model; skipping download.");
      return;
    }
    await rm(destination, { force: true });
  }
  console.log("[PSXL Needle] Downloading Needle 3 weights from Hugging Face…");
  await download(MODEL_URL, destination, MODEL_SHA256, MODEL_SIZE);
  const licensePath = join(modelDir, "LICENSE");
  if (!(await exists(licensePath))) await download(MODEL_LICENSE_URL, licensePath);
}

async function ensureBrowserRuntime() {
  const manifestPath = join(vendorDir, "package.json");
  if (await exists(manifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.version === WRAPPER_VERSION &&
          await exists(join(vendorDir, "dist/browser/worker.js")) &&
          await exists(join(vendorDir, "vendor/needle.wasm"))) {
        console.log("[PSXL Needle] Verified cached browser runtime; skipping download.");
        return;
      }
    } catch { /* Re-fetch an incomplete or invalid runtime. */ }
  }

  console.log("[PSXL Needle] Downloading cactus-needle browser runtime " + WRAPPER_VERSION + "…");
  const workDir = await mkdtemp(join(tmpdir(), "psxl-needle-runtime-"));
  const archive = join(workDir, "cactus-needle.tgz");
  const extracted = join(workDir, "package");
  await mkdir(extracted, { recursive: true });
  try {
    await download(WRAPPER_URL, archive);
    execFileSync("tar", ["-xzf", archive, "-C", extracted, "--strip-components=1", "package"], { stdio: "inherit" });
    const manifest = JSON.parse(await readFile(join(extracted, "package.json"), "utf8"));
    if (manifest.version !== WRAPPER_VERSION) {
      throw new Error("Expected cactus-needle " + WRAPPER_VERSION + ", got " + manifest.version);
    }
    if (!(await exists(join(extracted, "dist/browser/worker.js"))) ||
        !(await exists(join(extracted, "vendor/needle.wasm")))) {
      throw new Error("The downloaded cactus-needle package is missing its browser worker or WASM runtime.");
    }
    await rm(vendorDir, { recursive: true, force: true });
    await mkdir(vendorDir, { recursive: true });
    await cp(join(extracted, "dist"), join(vendorDir, "dist"), { recursive: true });
    await cp(join(extracted, "vendor"), join(vendorDir, "vendor"), { recursive: true });
    await copyFile(join(extracted, "package.json"), manifestPath);
    for (const file of ["LICENSE", "NOTICE"]) {
      if (await exists(join(extracted, file))) await copyFile(join(extracted, file), join(vendorDir, file));
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

await ensureBrowserRuntime();
await ensureModel();
console.log("[PSXL Needle] Runtime and SHA-256-verified model are ready for the production build.");
