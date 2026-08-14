import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runSandboxLocally } from "../judge/sandbox";

const requestSchema = z.object({
    language: z.enum(["python", "java", "javascript", "cpp"]),
    source: z.string().min(1).max(100_000),
    input: z.string().max(1_000_000),
    timeLimitMs: z.number().int().min(100).max(10_000).optional(),
    runtimeVersion: z.string().min(1).max(40).optional().nullable(),
});
const serviceToken = process.env.SANDBOX_SERVICE_TOKEN;
if (!serviceToken || serviceToken.length < 32)
    throw new Error("SANDBOX_SERVICE_TOKEN must contain at least 32 characters");

const app = Fastify({ logger: true, bodyLimit: 1_200_000, requestTimeout: 195_000 });

app.get("/health", async () => ({ status: "ok", service: "sandbox-runner" }));
app.post("/run", async (request, reply) => {
    if (!validAuthorization(request.headers.authorization, serviceToken))
        return reply.code(401).send({ error: "unauthorized" });
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid sandbox request" });
    return runSandboxLocally(
        parsed.data.language,
        parsed.data.source,
        parsed.data.input,
        parsed.data.timeLimitMs,
        parsed.data.runtimeVersion,
    );
});

await app.listen({ port: Number(process.env.SANDBOX_PORT ?? 4100), host: "0.0.0.0" });

function validAuthorization(value: string | undefined, expectedToken: string) {
    const expected = Buffer.from(`Bearer ${expectedToken}`);
    const actual = Buffer.from(value ?? "");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
