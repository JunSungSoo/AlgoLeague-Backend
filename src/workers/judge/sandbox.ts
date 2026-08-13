import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { languagePolicy, type JudgeLanguage, type Verdict } from "../../domain/judge";

const commands: Record<JudgeLanguage, string> = {
    python: "python3 -I -B /workspace/main.py",
    java: "javac -encoding UTF-8 -d /tmp/classes /workspace/Main.java && java -cp /tmp/classes Main",
    javascript: "node --disable-proto=delete --no-addons /workspace/main.js",
    cpp: "g++ -O2 -std=gnu++23 -pipe -o /tmp/main /workspace/main.cpp && /tmp/main",
};

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
): Promise<SandboxResult> {
    if (process.env.SANDBOX_SERVICE_URL) {
        try {
            const response = await fetch(`${process.env.SANDBOX_SERVICE_URL}/run`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${process.env.SANDBOX_SERVICE_TOKEN ?? ""}`,
                },
                body: JSON.stringify({ language, source, input }),
                signal: AbortSignal.timeout(30_000),
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
    return runSandboxLocally(language, source, input);
}

export async function runSandboxLocally(
    language: JudgeLanguage,
    source: string,
    input: string,
): Promise<SandboxResult> {
    const policy = languagePolicy[language];
    const sandboxRoot = resolve(tmpdir(), "algorithm-champions-judge");
    const directory = await mkdtemp(`${sandboxRoot}-`);
    if (!resolve(directory).startsWith(`${sandboxRoot}-`) || resolve(directory) === sep)
        throw new Error("unsafe sandbox path");
    const startedAt = performance.now();
    try {
        await writeFile(join(directory, policy.sourceName), source, { mode: 0o400 });
        const args = [
            "run",
            "--rm",
            "--network",
            "none",
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
            "--tmpfs",
            "/tmp:rw,nosuid,nodev,size=256m",
            "--mount",
            `type=bind,src=${directory},dst=/workspace,readonly`,
            policy.image,
            "sh",
            "-lc",
            commands[language],
        ];
        return await new Promise((resolveResult) => {
            const child = spawn("docker", args, { stdio: "pipe", env: process.env });
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            let outputBytes = 0;
            let limited = false;
            let timedOut = false;
            const timer = setTimeout(
                () => {
                    timedOut = true;
                    child.kill("SIGKILL");
                },
                policy.seconds * 1000 + (language === "java" || language === "cpp" ? 15_000 : 500),
            );
            const capture = (target: Buffer[]) => (chunk: Buffer) => {
                outputBytes += chunk.length;
                if (outputBytes > 1_048_576) {
                    limited = true;
                    child.kill("SIGKILL");
                } else target.push(chunk);
            };
            child.stdout.on("data", capture(stdout));
            child.stderr.on("data", capture(stderr));
            child.on("error", (error) => {
                clearTimeout(timer);
                resolveResult({
                    verdict: "JH",
                    stdout: "",
                    stderr: normalizeError(error.message),
                    durationMs: performance.now() - startedAt,
                });
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                const err = normalizeError(Buffer.concat(stderr).toString("utf8"));
                const verdict: Verdict = limited
                    ? "OLE"
                    : timedOut
                      ? "TLE"
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
            child.stdin.end(input);
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
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

export function dockerArgumentsFor(language: JudgeLanguage, directory = "/safe/job") {
    const policy = languagePolicy[language];
    return [
        "run",
        "--rm",
        "--network",
        "none",
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
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=256m",
        "--mount",
        `type=bind,src=${directory},dst=/workspace,readonly`,
        policy.image,
        "sh",
        "-lc",
        commands[language],
    ];
}
