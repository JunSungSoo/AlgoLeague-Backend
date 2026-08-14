import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./http/routes";

export async function buildApp() {
    const app = Fastify({
        logger: process.env.NODE_ENV !== "test",
        bodyLimit: 400_000,
        // A runtime image may need to be prepared on the first execution.
        requestTimeout: 200_000,
    });
    const allowedOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    await app.register(cors, {
        origin: (origin, callback) => callback(null, !origin || origin === allowedOrigin),
        credentials: true,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["content-type", "authorization"],
    });
    await registerRoutes(app);
    app.setErrorHandler((error: FastifyError, request, reply) => {
        request.log.error({ err: error, requestId: request.id }, "request failed");
        reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({
            error:
                error.statusCode && error.statusCode < 500
                    ? error.message
                    : "내부 오류가 발생했습니다.",
            traceId: request.id,
        });
    });
    return app;
}
