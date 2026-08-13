import Fastify from "fastify";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { languagePolicy, type JudgeLanguage, type Verdict } from "../../domain/judge";

const requestSchema = z.object({
    language: z.enum(["python", "java", "javascript", "cpp"]),
    source: z.string().min(1).max(100_000),
    input: z.string().max(1_000_000),
});
const app = Fastify({ logger: true, bodyLimit: 1_200_000 });

app.get("/health", async () => ({ status: "ok", service: "sandbox-runner" }));
app.post("/run", async (request, reply) => {
    const expected = process.env.SANDBOX_SERVICE_TOKEN;
    if (!expected || request.headers.authorization !== `Bearer ${expected}`)
        return reply.code(401).send({ error: "unauthorized" });
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid sandbox request" });
    return runIsolated(parsed.data.language, parsed.data.source, parsed.data.input);
});

await app.listen({ port: Number(process.env.SANDBOX_PORT ?? 4100), host: "0.0.0.0" });

const directCommands: Record<JudgeLanguage, string> = {
    python: "python3 -I -B main.py",
    java: "javac -encoding UTF-8 -d classes Main.java && java -cp classes Main",
    javascript: "node --disable-proto=delete --no-addons main.js",
    cpp: "g++ -O2 -std=gnu++23 -pipe -o main main.cpp && ./main",
};
async function runIsolated(language: JudgeLanguage, source: string, input: string) {
    const policy = languagePolicy[language];
    const directory = await mkdtemp(join(tmpdir(), "algoleague-run-"));
    const startedAt = performance.now();
    try {
        await writeFile(join(directory, policy.sourceName), source, { mode: 0o400 });
        return await new Promise<{
            verdict: Verdict;
            stdout: string;
            stderr: string;
            durationMs: number;
        }>((resolveResult) => {
            const child = spawn("sh", ["-lc", directCommands[language]], {
                cwd: directory,
                stdio: "pipe",
                detached: true,
                env: {
                    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                    LANG: "C.UTF-8",
                    HOME: directory,
                },
            });
            const stdout: Buffer[] = [],
                stderr: Buffer[] = [];
            let outputBytes = 0,
                limited = false,
                timedOut = false;
            const stop = () => {
                try {
                    process.kill(-child.pid!, "SIGKILL");
                } catch {
                    child.kill("SIGKILL");
                }
            };
            const timer = setTimeout(
                () => {
                    timedOut = true;
                    stop();
                },
                policy.seconds * 1000 + (language === "java" || language === "cpp" ? 15_000 : 500),
            );
            const capture = (target: Buffer[]) => (chunk: Buffer) => {
                outputBytes += chunk.length;
                if (outputBytes > 1_048_576) {
                    limited = true;
                    stop();
                } else target.push(chunk);
            };
            child.stdout.on("data", capture(stdout));
            child.stderr.on("data", capture(stderr));
            child.on("error", (error) => {
                clearTimeout(timer);
                resolveResult({
                    verdict: "JH",
                    stdout: "",
                    stderr: error.message.slice(0, 8000),
                    durationMs: performance.now() - startedAt,
                });
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                stop();
                const err = Buffer.concat(stderr).toString("utf8").slice(0, 8000);
                const verdict: Verdict = limited
                    ? "OLE"
                    : timedOut
                      ? "TLE"
                      : code === 0
                        ? "AC"
                        : /error:|compilation failed/i.test(err)
                          ? "CE"
                          : /memory|resource|operation not permitted|killed/i.test(err)
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
