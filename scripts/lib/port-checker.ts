/**
 * Zero-dependency service probes for local translation infrastructure.
 *
 * Uses `node:net` for TCP and global `fetch` for HTTP health checks.
 * All probes have short timeouts (2s) so the batch translator starts
 * quickly even when services are unavailable.
 *
 * See ADR-004 Phase 5
 */

import * as net from "node:net";
import { execFile } from "node:child_process";

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

// ── HTTP Health Probe ───────────────────────────────────────────────

/**
 * HTTP GET a health endpoint and verify a JSON field exists.
 * Returns `true` only if the response is 2xx and the field is present.
 */
export async function probeService(
  port: number,
  healthPath: string,
  expectedField: string,
  host = "127.0.0.1",
  timeoutMs = 2000
): Promise<boolean> {
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

// ── Named Service Probes ────────────────────────────────────────────

/** Check NLLB translation service on localhost:8000 */
export function probeNllb(): Promise<boolean> {
  return probeService(8000, "/health", "status");
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
  const [nllb, lmStudio] = await Promise.all([probeNllb(), probeLmStudio()]);
  return { nllb, lmStudio };
}

// ── GPU Detection ───────────────────────────────────────────────────

export interface GpuInfo {
  available: boolean;
  name?: string;
  vramMb?: number;
  /** Whether NVIDIA Container Toolkit works (docker --gpus) */
  dockerGpu: boolean;
}

/**
 * Detect NVIDIA GPU via `nvidia-smi`.
 * Returns GPU name + VRAM if present, and probes Docker GPU passthrough.
 */
export async function detectGpu(): Promise<GpuInfo> {
  const noGpu: GpuInfo = { available: false, dockerGpu: false };

  // Step 1: nvidia-smi on the host
  let name: string;
  let vramMb: number;
  try {
    const smiOutput = await execAsync("nvidia-smi", [
      "--query-gpu=name,memory.total",
      "--format=csv,noheader,nounits",
    ]);
    const parts = smiOutput
      .trim()
      .split(",")
      .map((s) => s.trim());
    if (parts.length < 2) return noGpu;
    name = parts[0]!;
    vramMb = parseInt(parts[1]!, 10);
    if (isNaN(vramMb)) return noGpu;
  } catch {
    return noGpu;
  }

  // Step 2: Docker GPU passthrough
  let dockerGpu = false;
  try {
    const dockerCheck = await execAsync("docker", [
      "run",
      "--rm",
      "--gpus",
      "all",
      "nvidia/cuda:12.1.0-base-ubuntu22.04",
      "nvidia-smi",
      "--query-gpu=name",
      "--format=csv,noheader",
    ]);
    dockerGpu = dockerCheck.trim().length > 0;
  } catch {
    // Docker GPU not available — NVIDIA Container Toolkit not installed or Docker not running
  }

  return { available: true, name, vramMb, dockerGpu };
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
