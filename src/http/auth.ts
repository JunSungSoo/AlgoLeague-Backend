import type { FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";

export type Session = { userId: string; role: "LEARNER" | "OPERATOR" | "ADMIN"; scopes: string[] };
const secret = () =>
    new TextEncoder().encode(
        process.env.SESSION_SECRET ?? "development-only-secret-change-me-32chars",
    );

export async function issueSession(session: Session) {
    return new SignJWT(session)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(secret());
}

export type PhoneVerificationPurpose = "signup" | "find-id" | "reset-password" | "change-password";
export async function issuePhoneVerification(phone: string, purpose: PhoneVerificationPurpose) {
    return new SignJWT({ phone, purpose })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(secret());
}

export async function verifyPhoneVerification(token: string, purpose: PhoneVerificationPurpose) {
    try {
        const { payload } = await jwtVerify(token, secret());
        return payload.purpose === purpose && typeof payload.phone === "string"
            ? payload.phone
            : null;
    } catch {
        return null;
    }
}

export async function getSession(request: FastifyRequest): Promise<Session | null> {
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const cookie = request.headers.cookie
        ?.split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith("ac_session="))
        ?.slice("ac_session=".length);
    const token = bearer ?? cookie;
    if (!token) return null;
    try {
        const { payload } = await jwtVerify(token, secret());
        return payload as unknown as Session;
    } catch {
        return null;
    }
}

export async function requireScope(request: FastifyRequest, scope: string) {
    const session = await getSession(request);
    return session?.scopes.includes(scope) ? session : null;
}
