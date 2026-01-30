/**
 * Zero-dependency service probes for local translation infrastructure.
 *
 * Uses `node:net` for TCP, `node:https` for TLS health checks, and
 * global `fetch` for plain HTTP. All probes have short timeouts (2s)
 * so the batch translator starts quickly even when services are unavailable.
 *
 * See ADR-004 Phase 5
 */

import * as fs from "node:fs";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { readApiKey } from "./nllb-keygen.js";

/**
 * HTTPS agent that accepts self-signed certificates.
 * Scoped to NLLB probes only — does NOT affect global fetch/TLS.
 */
const nllbTlsAgent = new https.Agent({ rejectUnauthorized: false });

// ── TCP Probe ───────────────────────────────────────────────────────

/**
 * Check if a TCP port is accepting connections.
 * Resolves `true` if the connection succeeds within `timeoutMs`.
 */
export function isPortOpen(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 2000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

// ── HTTP/HTTPS Health Probe ─────────────────────────────────────────

/**
 * HTTP(S) GET a health endpoint and verify a JSON field exists.
 * Returns `true` only if the response is 2xx and the field is present.
 *
 * For `https` scheme, uses a scoped agent that accepts self-signed certs.
 */
export async function probeService(
  port: number,
  healthPath: string,
  expectedField: string,
  host = "127.0.0.1",
  timeoutMs = 2000,
  scheme: "http" | "https" = "http"
): Promise<boolean> {
  if (scheme === "https") {
    return probeHttps(port, healthPath, expectedField, host, timeoutMs);
  }

  try {
    const url = `http://${host}:${port}${healthPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return false;

    const json = (await res.json()) as Record<string, unknown>;
    return expectedField in json;
  } catch {
    return false;
  }
}

/** HTTPS probe using node:https (supports self-signed certs via scoped agent) */
function probeHttps(
  port: number,
  healthPath: string,
  expectedField: string,
  host: string,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: host,
        port,
        path: healthPath,
        agent: nllbTlsAgent,
        timeout: timeoutMs,
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          resolve(false);
          return;
        }
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(body) as Record<string, unknown>;
            resolve(expectedField in json);
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ── Named Service Probes ────────────────────────────────────────────

/** Check NLLB translation service on localhost:8000 (HTTPS, self-signed) */
export function probeNllb(host = "127.0.0.1"): Promise<boolean> {
  return probeService(8000, "/health", "status", host, 2000, "https");
}

/** Check LM Studio on localhost:1234 */
export function probeLmStudio(): Promise<boolean> {
  return probeService(1234, "/v1/models", "data");
}

/** Probe all services and return availability map */
export async function probeAllServices(): Promise<{
  nllb: boolean;
  lmStudio: boolean;
}> {
  const nllbHost = process.env["NLLB_HOST"] ?? "127.0.0.1";
  const [nllb, lmStudio] = await Promise.all([
    probeNllb(nllbHost),
    probeLmStudio(),
  ]);
  return { nllb, lmStudio };
}

/**
 * Read the NLLB API key from the key file.
 * Re-exported from nllb-keygen for convenience.
 */
export function getNllbApiKey(): string | null {
  return readApiKey();
}

// ── Hardware Detection ───────────────────────────────────────────────

export type GpuVendor = "nvidia" | "apple" | "amd" | "none";

export interface GpuInfo {
  available: boolean;
  vendor: GpuVendor;
  name?: string;
  vramMb?: number;
  /** Whether Docker GPU passthrough works (NVIDIA Container Toolkit) */
  dockerGpu: boolean;
}

export interface CpuInfo {
  model: string;
  cores: number;
  /** ISA feature flags relevant to ML inference performance */
  features: {
    avx2: boolean;
    avx512: boolean;
    avx512bf16: boolean;
    /** ARM NEON (always true on Apple Silicon / ARM64) */
    neon: boolean;
  };
}

export interface HardwareInfo {
  gpu: GpuInfo;
  cpu: CpuInfo;
  systemRamMb: number;
}

/**
 * Docker profile recommendation for the NLLB container.
 *
 * Model and precision selection is deferred to the Python server at runtime,
 * which uses canonical PyTorch APIs (torch.cuda.is_bf16_supported(), VRAM
 * queries, etc.) for authoritative hardware capability detection.
 *
 * The TS side only determines:
 *   1. CPU or GPU Docker profile (for `docker compose --profile`)
 *   2. Pass-through of user overrides (NLLB_DEVICE, NLLB_PARAMS, NLLB_PRECISION)
 *
 * After the container starts, the batch translator reads back the server's
 * actual model + precision selection from the /health endpoint.
 */
export interface DockerProfileRecommendation {
  /** Docker compose profile: "" (CPU default) or "gpu" */
  profile: "" | "gpu";
  /** Whether GPU inference is expected */
  useGpu: boolean;
  /** Human-readable summary for console output */
  label: string;
}

/**
 * Determine Docker profile (CPU vs GPU) based on hardware detection.
 *
 * This is a lightweight pre-launch decision. The server inside the container
 * makes the authoritative model + precision selection using PyTorch APIs.
 *
 * Env var overrides:
 *   NLLB_DEVICE=cpu  → force CPU profile
 *   NLLB_DEVICE=gpu  → force GPU profile
 */
export function recommendProfile(
  hw: HardwareInfo
): DockerProfileRecommendation {
  const deviceOverride = (process.env["NLLB_DEVICE"] ?? "").toLowerCase();

  if (deviceOverride === "cpu") {
    return {
      profile: "",
      useGpu: false,
      label: "CPU (forced via NLLB_DEVICE)",
    };
  }
  if (deviceOverride === "gpu") {
    return {
      profile: "gpu",
      useGpu: true,
      label: "GPU (forced via NLLB_DEVICE)",
    };
  }

  // Auto-detect: GPU profile if Docker GPU passthrough works
  if (hw.gpu.available && hw.gpu.dockerGpu) {
    const vramStr = hw.gpu.vramMb
      ? `${hw.gpu.vramMb} MB VRAM`
      : "unified memory";
    return {
      profile: "gpu",
      useGpu: true,
      label: `GPU — ${hw.gpu.name ?? hw.gpu.vendor} (${vramStr})`,
    };
  }

  return { profile: "", useGpu: false, label: "CPU (no Docker GPU detected)" };
}

/** Detect system RAM in MB */
export function getSystemRamMb(): number {
  return Math.round(os.totalmem() / (1024 * 1024));
}

/**
 * Detect GPU accelerator. Probes in order:
 *   1. NVIDIA (nvidia-smi)
 *   2. Apple Metal (system_profiler on macOS)
 *   3. AMD ROCm (rocm-smi)
 *
 * Only NVIDIA currently supports Docker GPU passthrough.
 */
export async function detectGpu(): Promise<GpuInfo> {
  const noGpu: GpuInfo = { available: false, vendor: "none", dockerGpu: false };

  // ── NVIDIA ──
  try {
    const smiOutput = await execAsync("nvidia-smi", [
      "--query-gpu=name,memory.total",
      "--format=csv,noheader,nounits",
    ]);
    const parts = smiOutput
      .trim()
      .split(",")
      .map((s) => s.trim());
    if (parts.length >= 2) {
      const name = parts[0]!;
      const vramMb = parseInt(parts[1]!, 10);
      if (!isNaN(vramMb)) {
        const dockerGpu = await probeDockerGpu();
        return { available: true, vendor: "nvidia", name, vramMb, dockerGpu };
      }
    }
  } catch {
    // Not NVIDIA
  }

  // ── Apple Metal (macOS) ──
  if (process.platform === "darwin") {
    try {
      // Apple GPUs share unified memory; report as system RAM
      const spOutput = await execAsync("system_profiler", [
        "SPDisplaysDataType",
      ]);
      const chipMatch = /Chip.*?:\s*(.+)/i.exec(spOutput);
      if (chipMatch) {
        // Unified memory — GPU uses system RAM, no separate VRAM.
        // Docker GPU passthrough not supported on macOS.
        return {
          available: true,
          vendor: "apple",
          name: chipMatch[1]!.trim(),
          vramMb: undefined, // unified memory — use system RAM for sizing
          dockerGpu: false,
        };
      }
    } catch {
      // Not Apple Silicon or system_profiler not available
    }
  }

  // ── AMD ROCm ──
  try {
    const rocmOutput = await execAsync("rocm-smi", [
      "--showmeminfo",
      "vram",
      "--csv",
    ]);
    const lines = rocmOutput.trim().split("\n");
    // rocm-smi CSV: header then data rows
    if (lines.length >= 2) {
      const nameOutput = await execAsync("rocm-smi", [
        "--showproductname",
        "--csv",
      ]);
      const nameLines = nameOutput.trim().split("\n");
      const name =
        nameLines.length >= 2
          ? (nameLines[1]!.split(",")[1]?.trim() ?? "AMD GPU")
          : "AMD GPU";
      // Parse total VRAM from CSV
      const dataLine = lines[1]!;
      const totalBytes = parseInt(dataLine.split(",")[1]?.trim() ?? "0", 10);
      const vramMb = Math.round(totalBytes / (1024 * 1024));
      // ROCm Docker passthrough exists but is less common
      return {
        available: true,
        vendor: "amd",
        name,
        vramMb: vramMb > 0 ? vramMb : undefined,
        dockerGpu: false, // Conservative — ROCm Docker support varies
      };
    }
  } catch {
    // Not AMD ROCm
  }

  return noGpu;
}

/** Probe NVIDIA Docker GPU passthrough */
async function probeDockerGpu(): Promise<boolean> {
  try {
    const dockerCheck = await execAsync("docker", [
      "run",
      "--rm",
      "--gpus",
      "all",
      "nvidia/cuda:12.8.0-base-ubuntu24.04",
      "nvidia-smi",
      "--query-gpu=name",
      "--format=csv,noheader",
    ]);
    return dockerCheck.trim().length > 0;
  } catch {
    return false;
  }
}

// ── CPU Feature Detection ─────────────────────────────────────────

/**
 * Detect CPU model, core count, and ISA features (AVX2, AVX512, etc.).
 *
 * Cross-platform:
 *   - Linux / WSL / Docker: parse /proc/cpuinfo flags
 *   - Windows (native): try WSL `cat /proc/cpuinfo` first (catches WSL2
 *     which reports the host CPU), then fall back to inferring from
 *     os.cpus() model string
 *   - macOS: `sysctl machdep.cpu.features` + `machdep.cpu.leaf7_features`
 *
 * These features matter for ML inference on CPU:
 *   AVX2       — baseline for fast ONNX / PyTorch CPU inference
 *   AVX-512    — enables bitsandbytes int8/int4 on CPU
 *   AVX512BF16 — native bf16 on CPU (Sapphire Rapids / Zen 5+)
 *   NEON       — ARM SIMD (Apple Silicon, Graviton)
 */
export async function detectCpu(): Promise<CpuInfo> {
  const cpus = os.cpus();
  const model = cpus[0]?.model ?? "unknown";
  const cores = cpus.length;
  const arch = os.arch(); // x64, arm64, etc.

  const defaultFeatures = {
    avx2: false,
    avx512: false,
    avx512bf16: false,
    neon: arch === "arm64" || arch === "arm",
  };

  // ARM — no AVX, but NEON is always present
  if (arch === "arm64" || arch === "arm") {
    return { model, cores, features: defaultFeatures };
  }

  // ── Linux / WSL (inside Linux): /proc/cpuinfo is authoritative ──
  if (process.platform === "linux") {
    const features = parseProcCpuinfoFeatures();
    if (features) {
      return { model, cores, features: { ...defaultFeatures, ...features } };
    }
  }

  // ── Windows: try WSL first (gets real host CPU flags), then heuristic ──
  if (process.platform === "win32") {
    // Attempt 1: WSL cat /proc/cpuinfo (works if WSL is installed)
    try {
      const wslOutput = await execAsync("wsl", ["cat", "/proc/cpuinfo"]);
      const features = parseCpuinfoString(wslOutput);
      if (features) {
        return { model, cores, features: { ...defaultFeatures, ...features } };
      }
    } catch {
      // WSL not available or not installed
    }

    // Attempt 2: Heuristic from CPU model string
    const features = inferFeaturesFromModel(model);
    return { model, cores, features: { ...defaultFeatures, ...features } };
  }

  // ── macOS: sysctl ──
  if (process.platform === "darwin") {
    try {
      const [feats, leaf7] = await Promise.all([
        execAsync("sysctl", ["-n", "machdep.cpu.features"]).catch(() => ""),
        execAsync("sysctl", ["-n", "machdep.cpu.leaf7_features"]).catch(
          () => ""
        ),
      ]);
      const combined = `${feats} ${leaf7}`.toUpperCase();
      return {
        model,
        cores,
        features: {
          ...defaultFeatures,
          avx2: combined.includes("AVX2"),
          avx512: /AVX512/.test(combined),
          avx512bf16: combined.includes("AVX512BF16"),
        },
      };
    } catch {
      // sysctl not available (shouldn't happen on macOS)
    }
  }

  return { model, cores, features: defaultFeatures };
}

/** Parse /proc/cpuinfo directly (Linux / WSL) */
function parseProcCpuinfoFeatures(): {
  avx2: boolean;
  avx512: boolean;
  avx512bf16: boolean;
} | null {
  try {
    const content = fs.readFileSync("/proc/cpuinfo", "utf-8");
    return parseCpuinfoString(content);
  } catch {
    return null;
  }
}

/** Extract AVX features from /proc/cpuinfo text */
function parseCpuinfoString(content: string): {
  avx2: boolean;
  avx512: boolean;
  avx512bf16: boolean;
} | null {
  // Find first "flags" line (all cores report the same flags)
  const flagsLine = content.split("\n").find((l) => l.startsWith("flags"));
  if (!flagsLine) return null;

  const flags = flagsLine.toUpperCase();
  return {
    avx2: flags.includes("AVX2"),
    avx512: /AVX512/.test(flags),
    avx512bf16: flags.includes("AVX512_BF16"),
  };
}

/**
 * Heuristic: infer AVX features from CPU model string (Windows fallback).
 *
 * This is imperfect but covers common cases when /proc/cpuinfo isn't available.
 * Intel Core 11th+ gen and AMD Zen 3+ all have AVX2.
 * AVX-512 is on Intel 10th-11th gen mobile/desktop, Xeon Scalable, and Zen 4+.
 * AVX512BF16 is on Sapphire Rapids / Zen 5+.
 */
function inferFeaturesFromModel(model: string): {
  avx2: boolean;
  avx512: boolean;
  avx512bf16: boolean;
} {
  const m = model.toUpperCase();
  const result = { avx2: false, avx512: false, avx512bf16: false };

  // Almost all x86-64 CPUs from 2015+ have AVX2 (Haswell+, Zen 1+)
  // Check for known exceptions (Atom, Celeron N-series older models)
  const isOldAtom = /ATOM|CELERON\s*N\d{3}\b/.test(m);
  if (!isOldAtom) {
    result.avx2 = true;
  }

  // AVX-512 heuristics
  // Intel: Xeon Scalable (Skylake-SP+), Core 10th-11th gen (Ice Lake, Tiger Lake, Rocket Lake)
  // AMD: Zen 4+ (Ryzen 7000+, EPYC 9004+)
  if (/XEON.*(?:GOLD|SILVER|PLATINUM|BRONZE|W-\d{4,})/i.test(m)) {
    result.avx512 = true;
  }
  // Intel Core 10th gen (i*-10) and 11th gen (i*-11) had AVX-512
  if (/I[3579]-1[01]\d{2,3}/.test(m)) {
    result.avx512 = true;
  }
  // AMD Zen 4+ (Ryzen 7000/8000/9000+, EPYC 9004+)
  if (/RYZEN.*[789]\d{3}|EPYC\s*9/.test(m)) {
    result.avx512 = true;
  }

  // AVX512BF16: Intel Sapphire Rapids+, AMD Zen 5+
  if (/XEON.*W[3579]-\d{4}X|SAPPHIRE/i.test(m)) {
    result.avx512bf16 = true;
  }
  if (/RYZEN.*9\d{3}/.test(m) && /ZEN\s*5/i.test(m)) {
    result.avx512bf16 = true;
  }

  return result;
}

/** Full hardware detection: GPU + CPU + system RAM */
export async function detectHardware(): Promise<HardwareInfo> {
  const [gpu, cpu] = await Promise.all([detectGpu(), detectCpu()]);
  const systemRamMb = getSystemRamMb();
  return { gpu, cpu, systemRamMb };
}

/** Promise wrapper around child_process.execFile */
function execAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
