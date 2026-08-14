import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { languagePolicy, type JudgeLanguage, type Verdict } from "../../domain/judge";
import { resolveRuntimeVersion } from "../../domain/runtime-versions";

export type SandboxResult = {
    verdict: Verdict;
    stdout: string;
    stderr: string;
    durationMs: number;
};

export async function runSandbox(
    language: JudgeLanguage,
    source: string,
    input: string,
    timeLimitMs?: number,
    runtimeVersion?: string | null,
): Promise<SandboxResult> {
    if (process.env.SANDBOX_SERVICE_URL) {
        try {
            const response = await fetch(`${process.env.SANDBOX_SERVICE_URL}/run`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${process.env.SANDBOX_SERVICE_TOKEN ?? ""}`,
                },
                body: JSON.stringify({ language, source, input, timeLimitMs, runtimeVersion }),
                signal: AbortSignal.timeout(190_000),
            });
            if (!response.ok) throw new Error(`sandbox service ${response.status}`);
            return (await response.json()) as SandboxResult;
        } catch (error) {
            return {
                verdict: "JH",
                stdout: "",
                stderr: normalizeError(
                    error instanceof Error ? error.message : "sandbox service unavailable",
                ),
                durationMs: 0,
            };
        }
    }
    return runSandboxLocally(language, source, input, timeLimitMs, runtimeVersion);
}

export async function runSandboxLocally(
    language: JudgeLanguage,
    source: string,
    input: string,
    timeLimitMs?: number,
    runtimeVersion?: string | null,
): Promise<SandboxResult> {
    const policy = languagePolicy[language];
    const runtime = resolveRuntimeVersion(language, runtimeVersion);
    const imageError = await ensureRuntimeImage(runtime.image);
    if (imageError)
        return { verdict: "JH", stdout: "", stderr: normalizeError(imageError), durationMs: 0 };
    const executionLimitMs = Math.max(100, Math.min(timeLimitMs ?? policy.seconds * 1000, 10_000));
    const containerName = `algoleague-job-${randomUUID()}`;
    const startedAt = performance.now();
    return await new Promise((resolveResult) => {
        const child = spawn("docker", dockerArgumentsFor(language, containerName, runtimeVersion), {
            stdio: ["pipe", "pipe", "pipe"],
            env: dockerClientEnvironment(),
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outputBytes = 0;
        let limited = false;
        let timedOut = false;
        let stopping = false;
        let cleanup: Promise<void> | null = null;
        const stopContainer = async () => {
            if (stopping) return cleanup;
            stopping = true;
            child.kill("SIGTERM");
            cleanup = forceRemoveContainer(containerName);
            await cleanup;
            child.kill("SIGKILL");
        };
        const timer = setTimeout(
            () => {
                timedOut = true;
                void stopContainer();
            },
            executionLimitMs + (language === "java" || language === "cpp" ? 15_000 : 500),
        );
        const capture = (target: Buffer[]) => (chunk: Buffer) => {
            outputBytes += chunk.length;
            if (outputBytes > 1_048_576) {
                limited = true;
                void stopContainer();
            } else target.push(chunk);
        };
        child.stdout.on("data", capture(stdout));
        child.stderr.on("data", capture(stderr));
        child.on("error", (error) => {
            clearTimeout(timer);
            void forceRemoveContainer(containerName);
            resolveResult({
                verdict: "JH",
                stdout: "",
                stderr: normalizeError(error.message),
                durationMs: performance.now() - startedAt,
            });
        });
        child.on("close", async (code) => {
            clearTimeout(timer);
            if (cleanup) await cleanup;
            const err = normalizeError(Buffer.concat(stderr).toString("utf8"));
            const infrastructureFailed = /No such image|Cannot connect to the Docker daemon/i.test(
                err,
            );
            const verdict: Verdict = limited
                ? "OLE"
                : timedOut
                  ? "TLE"
                  : infrastructureFailed
                    ? "JH"
                    : code === 0
                      ? "AC"
                      : compileFailed(language, err)
                        ? "CE"
                        : safetyFailed(err)
                          ? "SE"
                          : "RE";
            resolveResult({
                verdict,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: err,
                durationMs: performance.now() - startedAt,
            });
        });
        child.stdin.end(encodeJob(source, input));
    });
}

function encodeJob(source: string, input: string) {
    return `${Buffer.byteLength(source)}\n${Buffer.byteLength(input)}\n${source}${input}`;
}

function dockerClientEnvironment() {
    return Object.fromEntries(
        ["PATH", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].flatMap(
            (key) => (process.env[key] ? [[key, process.env[key]!]] : []),
        ),
    );
}

async function forceRemoveContainer(name: string) {
    await new Promise<void>((resolve) => {
        const cleanup = spawn("docker", ["rm", "--force", name], {
            stdio: "ignore",
            env: dockerClientEnvironment(),
        });
        cleanup.once("error", () => resolve());
        cleanup.once("close", () => resolve());
    });
}

function compileFailed(language: JudgeLanguage, error: string) {
    return (language === "java" || language === "cpp") && /error:|compilation failed/i.test(error);
}
function safetyFailed(error: string) {
    return /memory|resource|operation not permitted|killed/i.test(error);
}
function normalizeError(error: string) {
    return error.replaceAll(/\/workspace|\/tmp\/[\w./-]+/g, "<sandbox>").slice(0, 8_000);
}

export function dockerArgumentsFor(
    language: JudgeLanguage,
    containerName = "algoleague-test-job",
    runtimeVersion?: string | null,
) {
    const policy = languagePolicy[language];
    const runtime = resolveRuntimeVersion(language, runtimeVersion);
    const bootstrap = `set -eu
read -r source_size
read -r input_size
mkdir -p /tmp/workspace
dd bs=1 count="$source_size" of=/tmp/workspace/${policy.sourceName} status=none
dd bs=1 count="$input_size" of=/tmp/input status=none
chmod 400 /tmp/workspace/${policy.sourceName}
exec sh -lc ${JSON.stringify(runtime.command)} < /tmp/input`;
    return [
        "run",
        "--rm",
        "--init",
        "--interactive",
        "--pull",
        "never",
        "--name",
        containerName,
        "--network",
        "none",
        "--env",
        "HOME=/tmp",
        "--user",
        "65534:65534",
        "--read-only",
        "--pids-limit",
        "32",
        "--memory",
        "1g",
        "--memory-swap",
        "1g",
        "--cpus",
        "1",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--ulimit",
        "nofile=64:64",
        "--ulimit",
        "fsize=1048576:1048576",
        "--tmpfs",
        "/tmp:rw,exec,nosuid,nodev,size=256m",
        runtime.image,
        "sh",
        "-c",
        bootstrap,
    ];
}

async function ensureRuntimeImage(image: string) {
    if ((await dockerCommand(["image", "inspect", image])).ok) return "";
    const pulled = await dockerCommand(["pull", image], 180_000);
    return pulled.ok ? "" : pulled.error || `런타임 이미지를 준비하지 못했습니다: ${image}`;
}

async function dockerCommand(args: string[], timeoutMs = 10_000) {
    return await new Promise<{ ok: boolean; error: string }>((resolve) => {
        const child = spawn("docker", args, {
            stdio: ["ignore", "ignore", "pipe"],
            env: dockerClientEnvironment(),
        });
        const errors: Buffer[] = [];
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
        child.once("error", (error) => {
            clearTimeout(timer);
            resolve({ ok: false, error: error.message });
        });
        child.once("close", (code) => {
            clearTimeout(timer);
            resolve({ ok: code === 0, error: Buffer.concat(errors).toString("utf8") });
        });
    });
}
