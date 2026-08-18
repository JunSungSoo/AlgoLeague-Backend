import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { issueSession } from "./auth";

let app: FastifyInstance;
let token: string;
beforeAll(async () => {
    app = await buildApp();
    token = await issueSession({
        userId: "00000000-0000-0000-0000-000000000001",
        role: "ADMIN",
        scopes: ["problem:read", "submission:write", "admin:write"],
    });
});
afterAll(async () => {
    await app.close();
});
const auth = () => ({ authorization: `Bearer ${token}` });

describe("backend API", () => {
    it("reports health", async () => {
        const response = await app.inject({ method: "GET", url: "/api/health" });
        expect(response.statusCode).toBe(200);
        expect(response.json().service).toBe("algorithm-champions-back");
    });
    it("rejects protected APIs without a session", async () => {
        const [problems, ranking, progress, submission, reviews] = await Promise.all([
            app.inject({ method: "GET", url: "/api/problems" }),
            app.inject({ method: "GET", url: "/api/rankings/6" }),
            app.inject({ method: "GET", url: "/api/grade-progress" }),
            app.inject({
                method: "POST",
                url: "/api/problems/minimum-route/submit",
                payload: { language: "python", code: "print(1)" },
            }),
            app.inject({ method: "GET", url: "/api/admin/problem-reviews" }),
        ]);
        expect(problems.statusCode).toBe(403);
        expect(ranking.statusCode).toBe(401);
        expect(progress.statusCode).toBe(401);
        expect(submission.statusCode).toBe(403);
        expect(reviews.statusCode).toBe(403);
    });
    it("requires a session and database for the real dashboard", async () => {
        const guest = await app.inject({ method: "GET", url: "/api/dashboard" });
        expect(guest.statusCode).toBe(401);
        const authenticated = await app.inject({
            method: "GET",
            url: "/api/dashboard",
            headers: auth(),
        });
        expect(authenticated.statusCode).toBe(503);
    });
    it("requires the database for catalog, submissions, ranking, progress and admin data", async () => {
        const responses = await Promise.all([
            app.inject({ method: "GET", url: "/api/problems", headers: auth() }),
            app.inject({ method: "GET", url: "/api/my-problems", headers: auth() }),
            app.inject({ method: "GET", url: "/api/problems/generated-problem", headers: auth() }),
            app.inject({ method: "GET", url: "/api/rankings/6", headers: auth() }),
            app.inject({ method: "GET", url: "/api/grade-progress", headers: auth() }),
            app.inject({ method: "GET", url: "/api/admin/overview", headers: auth() }),
            app.inject({ method: "GET", url: "/api/admin/problem-reviews", headers: auth() }),
            app.inject({
                method: "GET",
                url: "/api/admin/problem-reviews/example",
                headers: auth(),
            }),
            app.inject({
                method: "POST",
                url: "/api/admin/problem-reviews/example/approve",
                headers: auth(),
                payload: { confirmed: true },
            }),
            app.inject({
                method: "POST",
                url: "/api/admin/problem-reviews/example/reject",
                headers: auth(),
                payload: { reason: "검수 기준 미충족" },
            }),
            app.inject({ method: "GET", url: "/api/submissions/example/status", headers: auth() }),
            app.inject({
                method: "GET",
                url: "/api/submissions/example/completion?sort=recommended&page=1",
                headers: auth(),
            }),
        ]);
        expect(responses.map((response) => response.statusCode)).toEqual([
            503, 503, 503, 503, 503, 503, 503, 503, 503, 503, 503, 503,
        ]);
    });
    it("validates problem review decisions before database access", async () => {
        const [approve, reject] = await Promise.all([
            app.inject({
                method: "POST",
                url: "/api/admin/problem-reviews/example/approve",
                headers: auth(),
                payload: { confirmed: false },
            }),
            app.inject({
                method: "POST",
                url: "/api/admin/problem-reviews/example/reject",
                headers: auth(),
                payload: { reason: "짧음" },
            }),
        ]);
        expect(approve.statusCode).toBe(400);
        expect(reject.statusCode).toBe(400);
    });
    it("validates grade params for authenticated users", async () => {
        const response = await app.inject({
            method: "GET",
            url: "/api/rankings/10",
            headers: auth(),
        });
        expect(response.statusCode).toBe(400);
    });
    it("accepts an authenticated development submission", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/problems/minimum-route/submit",
            headers: auth(),
            payload: { language: "python", code: "print(1)" },
        });
        expect(response.statusCode).toBe(202);
        expect(response.json().verdict).toBe("QU");
    });
    it("registers, updates the profile, recovers the id and resets the password", async () => {
        const requested = await app.inject({
            method: "POST",
            url: "/api/auth/phone/request",
            payload: { phone: "010-1234-5678", purpose: "signup" },
        });
        expect(requested.statusCode).toBe(200);
        const verified = await app.inject({
            method: "POST",
            url: "/api/auth/phone/verify",
            payload: { challengeId: requested.json().challengeId, code: "123456" },
        });
        const usernameCheck = await app.inject({
            method: "POST",
            url: "/api/auth/username/check",
            payload: { username: "testuser" },
        });
        expect(usernameCheck.json().available).toBe(true);
        const registered = await app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: {
                verificationToken: verified.json().verificationToken,
                username: "testuser",
                password: "Password123",
                name: "테스트 사용자",
                nickname: "테스트러너",
                preferredLanguage: "cpp",
            },
        });
        expect(registered.statusCode).toBe(201);
        expect(registered.json().user.username).toBe("testuser");
        expect(registered.headers["set-cookie"]).toContain("HttpOnly");
        const badLogin = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "testuser", password: "wrong" },
        });
        expect(badLogin.statusCode).toBe(401);
        const login = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "testuser", password: "Password123" },
        });
        expect(login.statusCode).toBe(200);
        const cookieHeader = String(login.headers["set-cookie"]).split(";")[0];
        const sessionHeaders = { cookie: cookieHeader };
        const profile = await app.inject({
            method: "GET",
            url: "/api/profile",
            headers: sessionHeaders,
        });
        expect(profile.statusCode).toBe(200);
        expect(profile.json().canChangeNickname).toBe(true);
        const nickname = await app.inject({
            method: "POST",
            url: "/api/profile/nickname",
            headers: sessionHeaders,
            payload: { nickname: "새로운러너" },
        });
        expect(nickname.statusCode).toBe(200);
        expect(nickname.json().user.nickname).toBe("새로운러너");
        const repeatedNickname = await app.inject({
            method: "POST",
            url: "/api/profile/nickname",
            headers: sessionHeaders,
            payload: { nickname: "또다른러너" },
        });
        expect(repeatedNickname.statusCode).toBe(429);
        const language = await app.inject({
            method: "POST",
            url: "/api/profile/preferred-language",
            headers: sessionHeaders,
            payload: { preferredLanguage: "java", preferredRuntimeVersion: "java21" },
        });
        expect(language.json().user.preferredLanguage).toBe("java");
        expect(language.json().user.preferredRuntimeVersion).toBe("java21");
        const invalidRuntime = await app.inject({
            method: "POST",
            url: "/api/profile/preferred-language",
            headers: sessionHeaders,
            payload: { preferredLanguage: "java", preferredRuntimeVersion: "node24" },
        });
        expect(invalidRuntime.statusCode).toBe(400);
        const passwordWithoutVerification = await app.inject({
            method: "POST",
            url: "/api/profile/password",
            headers: sessionHeaders,
            payload: { newPassword: "ProfilePassword789" },
        });
        expect(passwordWithoutVerification.statusCode).toBe(400);
        const changeCodeRequest = await app.inject({
            method: "POST",
            url: "/api/auth/phone/request",
            headers: sessionHeaders,
            payload: { phone: "01012345678", purpose: "change-password" },
        });
        expect(changeCodeRequest.statusCode).toBe(200);
        const changeCodeVerified = await app.inject({
            method: "POST",
            url: "/api/auth/phone/verify",
            payload: { challengeId: changeCodeRequest.json().challengeId, code: "123456" },
        });
        const passwordChange = await app.inject({
            method: "POST",
            url: "/api/profile/password",
            headers: sessionHeaders,
            payload: {
                verificationToken: changeCodeVerified.json().verificationToken,
                newPassword: "ProfilePassword789",
            },
        });
        expect(passwordChange.statusCode).toBe(200);
        const changedLogin = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "testuser", password: "ProfilePassword789" },
        });
        expect(changedLogin.statusCode).toBe(200);
        const findRequest = await app.inject({
            method: "POST",
            url: "/api/auth/phone/request",
            payload: { phone: "01012345678", purpose: "find-id" },
        });
        const found = await app.inject({
            method: "POST",
            url: "/api/auth/phone/verify",
            payload: { challengeId: findRequest.json().challengeId, code: "123456" },
        });
        expect(found.json().username).toBe("testuser");
        const resetRequest = await app.inject({
            method: "POST",
            url: "/api/auth/phone/request",
            payload: { username: "testuser", phone: "01012345678", purpose: "reset-password" },
        });
        const resetVerified = await app.inject({
            method: "POST",
            url: "/api/auth/phone/verify",
            payload: { challengeId: resetRequest.json().challengeId, code: "123456" },
        });
        const reset = await app.inject({
            method: "POST",
            url: "/api/auth/password/reset",
            payload: {
                username: "testuser",
                verificationToken: resetVerified.json().verificationToken,
                newPassword: "NewPassword456",
            },
        });
        expect(reset.statusCode).toBe(200);
        const newLogin = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { username: "testuser", password: "NewPassword456" },
        });
        expect(newLogin.statusCode).toBe(200);
    });
});
