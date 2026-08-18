import { createHash, randomInt, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
    getSession,
    issuePhoneVerification,
    issueSession,
    verifyPhoneVerification,
    type PhoneVerificationPurpose,
} from "./auth";
import { hashPassword, verifyPassword } from "../services/password";
import { dayjs } from "../lib/dayjs-config";
import { defaultRuntimeVersion, isRuntimeVersion } from "../domain/runtime-versions";

const languageSchema = z.enum(["python", "java", "javascript", "cpp"]);
const phoneSchema = z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(/^\+8210\d{8}$/, "올바른 휴대폰 번호를 입력해 주세요."));
const usernameSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(4, "아이디는 4자 이상이어야 합니다.")
    .max(20, "아이디는 20자 이하여야 합니다.")
    .regex(
        /^[a-z][a-z0-9_]+$/,
        "아이디는 영문 소문자로 시작하고 영문, 숫자, 밑줄만 사용할 수 있습니다.",
    );
const passwordSchema = z
    .string()
    .min(8, "비밀번호는 8자 이상이어야 합니다.")
    .max(64, "비밀번호는 64자 이하여야 합니다.")
    .regex(/[A-Za-z]/, "비밀번호에 영문자를 포함해 주세요.")
    .regex(/\d/, "비밀번호에 숫자를 포함해 주세요.");
const nicknameSchema = z
    .string()
    .trim()
    .min(2, "닉네임은 2자 이상이어야 합니다.")
    .max(16, "닉네임은 16자 이하여야 합니다.")
    .regex(/^[\p{L}\p{N}_]+$/u, "닉네임에는 문자, 숫자, 밑줄만 사용할 수 있습니다.");
const profileImageSchema = z
    .string()
    .max(300_000, "프로필 사진의 용량이 너무 큽니다.")
    .regex(
        /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/,
        "JPG, PNG 또는 WebP 이미지만 등록할 수 있습니다.",
    );
type ChallengePurpose = PhoneVerificationPurpose;
const challenges = new Map<
    string,
    {
        phone: string;
        purpose: ChallengePurpose;
        username?: string;
        codeHash: string;
        expiresAt: number;
        attempts: number;
    }
>();
const recentRequests = new Map<string, number>();
type PreviewUser = {
    id: string;
    username: string;
    passwordHash: string;
    name: string;
    phone: string;
    nickname: string;
    nicknameChangedAt: Date | null;
    address: string | null;
    profileImageUrl: string | null;
    preferredLanguage: z.infer<typeof languageSchema>;
    preferredRuntimeVersion: string | null;
    role: "LEARNER";
    grade: number;
    verifiedSolves: number;
};
const previewUsers = new Map<string, PreviewUser>();

function normalizePhone(value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.startsWith("82")) return `+${digits}`;
    if (digits.startsWith("010")) return `+82${digits.slice(1)}`;
    return value;
}
function hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
}
function cookie(reply: FastifyReply, token: string, maxAge = 604800) {
    reply.header(
        "set-cookie",
        `ac_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
}
type PublicUserSource = {
    id: string;
    username: string;
    name: string;
    phone: string;
    nickname: string;
    address: string | null;
    profileImageUrl: string | null;
    preferredLanguage: "python" | "java" | "javascript" | "cpp";
    preferredRuntimeVersion?: string | null;
    role: "LEARNER" | "OPERATOR" | "ADMIN";
    grade: number;
    verifiedSolves: number;
};
function publicUser(user: PublicUserSource) {
    return {
        id: user.id,
        username: user.username,
        name: user.name,
        phone: user.phone,
        nickname: user.nickname,
        address: user.address,
        profileImageUrl: user.profileImageUrl,
        preferredLanguage: user.preferredLanguage,
        preferredRuntimeVersion:
            user.preferredRuntimeVersion ?? defaultRuntimeVersion(user.preferredLanguage),
        role: user.role,
        grade: user.grade,
        verifiedSolves: user.verifiedSolves,
    };
}
function nextNicknameChange(changedAt: Date | null) {
    if (!changedAt) return null;
    return dayjs(changedAt).add(1, "month").toDate();
}
async function findUserByPhone(phone: string) {
    if (!process.env.DATABASE_URL) return previewUsers.get(phone) ?? null;
    const { db } = await import("../db/index");
    const { users } = await import("../db/schema");
    const [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    return user ?? null;
}
async function findUserByUsername(username: string) {
    if (!process.env.DATABASE_URL)
        return [...previewUsers.values()].find((user) => user.username === username) ?? null;
    const { db } = await import("../db/index");
    const { users } = await import("../db/schema");
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return user ?? null;
}
async function findUserById(id: string) {
    if (!process.env.DATABASE_URL)
        return [...previewUsers.values()].find((user) => user.id === id) ?? null;
    const { db } = await import("../db/index");
    const { users } = await import("../db/schema");
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
}
async function nicknameExists(nickname: string) {
    if (!process.env.DATABASE_URL)
        return [...previewUsers.values()].some(
            (user) => user.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase(),
        );
    const { db } = await import("../db/index");
    const { users } = await import("../db/schema");
    const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.nickname, nickname))
        .limit(1);
    return Boolean(user);
}

export async function registerAuthRoutes(app: FastifyInstance) {
    app.post("/api/auth/phone/request", async (request, reply) => {
        const parsed = z
            .object({
                phone: phoneSchema,
                purpose: z.enum(["signup", "find-id", "reset-password", "change-password"]),
                username: usernameSchema.optional(),
            })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        if (parsed.data.purpose === "reset-password" && !parsed.data.username)
            return reply.code(400).send({ error: "아이디를 입력해 주세요." });
        if (parsed.data.purpose === "change-password") {
            const session = await getSession(request);
            if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
            const sessionUser = await findUserById(session.userId);
            if (!sessionUser || sessionUser.phone !== parsed.data.phone)
                return reply
                    .code(403)
                    .send({ error: "계정에 등록된 휴대폰 번호로만 인증할 수 있습니다." });
        }
        if (process.env.NODE_ENV === "production" && !process.env.SMS_WEBHOOK_URL)
            return reply.code(503).send({ error: "SMS 인증 공급자 설정이 필요합니다." });
        const phoneUser = await findUserByPhone(parsed.data.phone);
        if (parsed.data.purpose === "signup" && phoneUser)
            return reply.code(409).send({ error: "이미 가입된 휴대폰 번호입니다." });
        if (parsed.data.purpose !== "signup" && !phoneUser)
            return reply
                .code(404)
                .send({ error: "입력한 정보와 일치하는 회원을 찾을 수 없습니다." });
        if (
            parsed.data.purpose === "reset-password" &&
            phoneUser?.username !== parsed.data.username
        )
            return reply.code(404).send({ error: "아이디와 휴대폰 번호가 일치하지 않습니다." });
        const rateKey = `${parsed.data.purpose}:${parsed.data.phone}`;
        const lastRequested = recentRequests.get(rateKey) ?? 0;
        if (dayjs().valueOf() - lastRequested < 60_000)
            return reply.code(429).send({ error: "인증번호는 1분 후 다시 요청할 수 있습니다." });
        const code =
            process.env.NODE_ENV === "production" ? String(randomInt(100000, 1000000)) : "123456";
        const challengeId = randomUUID();
        challenges.set(challengeId, {
            phone: parsed.data.phone,
            purpose: parsed.data.purpose,
            username: parsed.data.username,
            codeHash: hash(code),
            expiresAt: dayjs().add(5, "minute").valueOf(),
            attempts: 0,
        });
        recentRequests.set(rateKey, dayjs().valueOf());
        if (process.env.NODE_ENV === "production") {
            try {
                const smsResponse = await fetch(process.env.SMS_WEBHOOK_URL!, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(process.env.SMS_WEBHOOK_TOKEN
                            ? { authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` }
                            : {}),
                    },
                    body: JSON.stringify({
                        to: parsed.data.phone,
                        code,
                        template: "algorithm-champions-auth",
                    }),
                });
                if (!smsResponse.ok) throw new Error("SMS webhook rejected");
            } catch {
                challenges.delete(challengeId);
                return reply
                    .code(502)
                    .send({ error: "인증번호를 전송하지 못했습니다. 잠시 후 다시 시도해 주세요." });
            }
        }
        return reply.send({
            challengeId,
            expiresIn: 300,
            ...(process.env.NODE_ENV !== "production" ? { devCode: code } : {}),
        });
    });
    app.post("/api/auth/phone/verify", async (request, reply) => {
        const parsed = z
            .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: "인증번호 6자리를 확인해 주세요." });
        const challenge = challenges.get(parsed.data.challengeId);
        if (!challenge || challenge.expiresAt < dayjs().valueOf()) {
            challenges.delete(parsed.data.challengeId);
            return reply
                .code(410)
                .send({ error: "인증번호가 만료되었습니다. 다시 요청해 주세요." });
        }
        challenge.attempts += 1;
        if (challenge.attempts > 5) {
            challenges.delete(parsed.data.challengeId);
            return reply.code(429).send({ error: "인증 시도 횟수를 초과했습니다." });
        }
        if (challenge.codeHash !== hash(parsed.data.code))
            return reply.code(400).send({ error: "인증번호가 일치하지 않습니다." });
        challenges.delete(parsed.data.challengeId);
        if (challenge.purpose === "find-id") {
            const user = await findUserByPhone(challenge.phone);
            if (!user) return reply.code(404).send({ error: "회원을 찾을 수 없습니다." });
            return { username: user.username };
        }
        return {
            verificationToken: await issuePhoneVerification(challenge.phone, challenge.purpose),
            phone: challenge.phone,
        };
    });
    app.post("/api/auth/login", async (request, reply) => {
        const parsed = z
            .object({ username: usernameSchema, password: z.string().min(1) })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: "아이디와 비밀번호를 확인해 주세요." });
        const user = await findUserByUsername(parsed.data.username);
        if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash)))
            return reply.code(401).send({ error: "아이디 또는 비밀번호가 일치하지 않습니다." });
        const token = await issueSession({
            userId: user.id,
            role: user.role,
            scopes: [
                "problem:read",
                "submission:write",
                ...(user.role !== "LEARNER" ? ["admin:write"] : []),
            ],
        });
        cookie(reply, token);
        return { token, user: publicUser(user) };
    });
    app.post("/api/auth/username/check", async (request, reply) => {
        const parsed = z.object({ username: usernameSchema }).safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        const available = !(await findUserByUsername(parsed.data.username));
        return {
            available,
            message: available ? "사용 가능한 아이디입니다." : "이미 사용 중인 아이디입니다.",
        };
    });
    app.post("/api/auth/nickname/check", async (request, reply) => {
        const parsed = z.object({ nickname: nicknameSchema }).safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        const available = !(await nicknameExists(parsed.data.nickname));
        return reply.send({
            available,
            message: available ? "사용 가능한 닉네임입니다." : "이미 사용 중인 닉네임입니다.",
        });
    });
    app.post("/api/auth/register", async (request, reply) => {
        const parsed = z
            .object({
                verificationToken: z.string().min(1),
                username: usernameSchema,
                password: passwordSchema,
                name: z.string().trim().min(2, "이름은 2자 이상이어야 합니다.").max(50),
                nickname: nicknameSchema,
                address: z.string().trim().max(200).optional(),
                preferredLanguage: languageSchema,
            })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        const phone = await verifyPhoneVerification(parsed.data.verificationToken, "signup");
        if (!phone) return reply.code(401).send({ error: "휴대폰 인증을 다시 진행해 주세요." });
        if (await findUserByPhone(phone))
            return reply.code(409).send({ error: "이미 가입된 휴대폰 번호입니다." });
        if (await findUserByUsername(parsed.data.username))
            return reply.code(409).send({ error: "이미 사용 중인 아이디입니다." });
        if (await nicknameExists(parsed.data.nickname))
            return reply.code(409).send({ error: "이미 사용 중인 닉네임입니다." });
        const passwordHash = await hashPassword(parsed.data.password);
        let user: PreviewUser;
        if (!process.env.DATABASE_URL) {
            user = {
                id: randomUUID(),
                username: parsed.data.username,
                passwordHash,
                name: parsed.data.name,
                phone,
                nickname: parsed.data.nickname,
                nicknameChangedAt: null,
                address: parsed.data.address || null,
                profileImageUrl: null,
                preferredLanguage: parsed.data.preferredLanguage,
                preferredRuntimeVersion: defaultRuntimeVersion(parsed.data.preferredLanguage),
                role: "LEARNER",
                grade: 9,
                verifiedSolves: 0,
            };
            previewUsers.set(phone, user);
        } else {
            const { db } = await import("../db/index");
            const { users } = await import("../db/schema");
            const [created] = await db
                .insert(users)
                .values({
                    username: parsed.data.username,
                    passwordHash,
                    name: parsed.data.name,
                    phone,
                    phoneVerifiedAt: dayjs().toDate(),
                    nickname: parsed.data.nickname,
                    address: parsed.data.address || null,
                    preferredLanguage: parsed.data.preferredLanguage,
                    preferredRuntimeVersion: defaultRuntimeVersion(parsed.data.preferredLanguage),
                })
                .returning();
            if (!created)
                return reply.code(500).send({ error: "회원 정보를 저장하지 못했습니다." });
            user = {
                id: created.id,
                username: created.username,
                passwordHash: created.passwordHash ?? "",
                name: created.name,
                phone: created.phone,
                nickname: created.nickname,
                nicknameChangedAt: null,
                address: created.address,
                profileImageUrl: created.profileImageUrl,
                preferredLanguage: created.preferredLanguage,
                preferredRuntimeVersion: created.preferredRuntimeVersion,
                role: "LEARNER",
                grade: created.grade,
                verifiedSolves: created.verifiedSolves,
            };
        }
        const token = await issueSession({
            userId: user.id,
            role: "LEARNER",
            scopes: ["problem:read", "submission:write"],
        });
        cookie(reply, token);
        return reply.code(201).send({ token, user: publicUser(user) });
    });
    app.post("/api/auth/password/reset", async (request, reply) => {
        const parsed = z
            .object({
                username: usernameSchema,
                verificationToken: z.string().min(1),
                newPassword: passwordSchema,
            })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        const phone = await verifyPhoneVerification(
            parsed.data.verificationToken,
            "reset-password",
        );
        if (!phone) return reply.code(401).send({ error: "휴대폰 인증을 다시 진행해 주세요." });
        const user = await findUserByUsername(parsed.data.username);
        if (!user || user.phone !== phone)
            return reply.code(404).send({ error: "아이디와 인증 정보가 일치하지 않습니다." });
        const passwordHash = await hashPassword(parsed.data.newPassword);
        if (!process.env.DATABASE_URL) {
            user.passwordHash = passwordHash;
        } else {
            const { db } = await import("../db/index");
            const { users } = await import("../db/schema");
            await db
                .update(users)
                .set({ passwordHash, updatedAt: dayjs().toDate() })
                .where(eq(users.id, user.id));
        }
        return { ok: true, message: "비밀번호가 변경되었습니다." };
    });
    app.get("/api/profile", async (request, reply) => {
        const session = await getSession(request);
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        const user = await findUserById(session.userId);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        const availableAt = nextNicknameChange(user.nicknameChangedAt);
        return {
            user: publicUser(user),
            nicknameChangedAt: user.nicknameChangedAt
                ? dayjs(user.nicknameChangedAt).toISOString()
                : null,
            nicknameChangeAvailableAt: availableAt ? dayjs(availableAt).toISOString() : null,
            canChangeNickname: !availableAt || !dayjs(availableAt).isAfter(dayjs()),
        };
    });
    app.post("/api/profile/nickname", async (request, reply) => {
        const session = await getSession(request);
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        const parsed = z.object({ nickname: nicknameSchema }).safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        const user = await findUserById(session.userId);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        if (user.nickname === parsed.data.nickname)
            return reply.code(400).send({ error: "현재 닉네임과 다른 닉네임을 입력해 주세요." });
        const availableAt = nextNicknameChange(user.nicknameChangedAt);
        if (availableAt && dayjs(availableAt).isAfter(dayjs()))
            return reply.code(429).send({
                error: `닉네임은 ${dayjs(availableAt).tz().format("YYYY. M. D.")}부터 다시 변경할 수 있습니다.`,
                nicknameChangeAvailableAt: dayjs(availableAt).toISOString(),
            });
        if (await nicknameExists(parsed.data.nickname))
            return reply.code(409).send({ error: "이미 사용 중인 닉네임입니다." });
        const changedAt = dayjs().toDate();
        if (!process.env.DATABASE_URL) {
            user.nickname = parsed.data.nickname;
            user.nicknameChangedAt = changedAt;
        } else {
            try {
                const cutoff = dayjs(changedAt).subtract(1, "month").toDate();
                const { db } = await import("../db/index");
                const { users } = await import("../db/schema");
                const updatedRows = await db
                    .update(users)
                    .set({
                        nickname: parsed.data.nickname,
                        nicknameChangedAt: changedAt,
                        updatedAt: changedAt,
                    })
                    .where(
                        and(
                            eq(users.id, user.id),
                            or(
                                isNull(users.nicknameChangedAt),
                                lte(users.nicknameChangedAt, cutoff),
                            ),
                        ),
                    )
                    .returning({ id: users.id });
                if (!updatedRows.length)
                    return reply
                        .code(429)
                        .send({ error: "닉네임 변경 가능 시점을 확인한 뒤 다시 시도해 주세요." });
            } catch {
                return reply.code(409).send({ error: "이미 사용 중인 닉네임입니다." });
            }
        }
        const updated = { ...user, nickname: parsed.data.nickname };
        return {
            user: publicUser(updated),
            nicknameChangedAt: dayjs(changedAt).toISOString(),
            nicknameChangeAvailableAt: dayjs(nextNicknameChange(changedAt)).toISOString(),
            canChangeNickname: false,
            message: "닉네임이 변경되었습니다.",
        };
    });
    app.post("/api/profile/password", async (request, reply) => {
        const session = await getSession(request);
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        const parsed = z
            .object({
                verificationToken: z.string().min(1, "휴대폰 인증을 진행해 주세요."),
                newPassword: passwordSchema,
            })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: parsed.error.issues[0]?.message });
        const verifiedPhone = await verifyPhoneVerification(
            parsed.data.verificationToken,
            "change-password",
        );
        if (!verifiedPhone)
            return reply.code(401).send({ error: "휴대폰 인증이 만료되었거나 유효하지 않습니다." });
        const user = await findUserById(session.userId);
        if (!user || user.phone !== verifiedPhone)
            return reply
                .code(403)
                .send({ error: "인증한 휴대폰 번호와 계정 정보가 일치하지 않습니다." });
        if (await verifyPassword(parsed.data.newPassword, user.passwordHash))
            return reply.code(400).send({ error: "새 비밀번호는 현재 비밀번호와 달라야 합니다." });
        const passwordHash = await hashPassword(parsed.data.newPassword);
        if (!process.env.DATABASE_URL) {
            user.passwordHash = passwordHash;
        } else {
            const { db } = await import("../db/index");
            const { users } = await import("../db/schema");
            await db
                .update(users)
                .set({ passwordHash, updatedAt: dayjs().toDate() })
                .where(eq(users.id, user.id));
        }
        return { ok: true, message: "비밀번호가 변경되었습니다." };
    });
    app.post("/api/profile/preferred-language", async (request, reply) => {
        const session = await getSession(request);
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        const parsed = z
            .object({
                preferredLanguage: languageSchema,
                preferredRuntimeVersion: z.string().min(1).max(40),
            })
            .superRefine((value, context) => {
                if (!isRuntimeVersion(value.preferredLanguage, value.preferredRuntimeVersion))
                    context.addIssue({
                        code: "custom",
                        path: ["preferredRuntimeVersion"],
                        message: "선택한 언어에서 지원하지 않는 실행 버전입니다.",
                    });
            })
            .safeParse(request.body);
        if (!parsed.success)
            return reply.code(400).send({ error: "지원하는 프로그래밍 언어를 선택해 주세요." });
        const user = await findUserById(session.userId);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        if (!process.env.DATABASE_URL) {
            user.preferredLanguage = parsed.data.preferredLanguage;
            user.preferredRuntimeVersion = parsed.data.preferredRuntimeVersion;
        } else {
            const { db } = await import("../db/index");
            const { users } = await import("../db/schema");
            await db
                .update(users)
                .set({
                    preferredLanguage: parsed.data.preferredLanguage,
                    preferredRuntimeVersion: parsed.data.preferredRuntimeVersion,
                    updatedAt: dayjs().toDate(),
                })
                .where(eq(users.id, user.id));
        }
        return {
            user: publicUser({
                ...user,
                preferredLanguage: parsed.data.preferredLanguage,
                preferredRuntimeVersion: parsed.data.preferredRuntimeVersion,
            }),
            message: "선호 프로그래밍 언어와 실행 버전이 변경되었습니다.",
        };
    });
    app.post("/api/profile/image", async (request, reply) => {
        const session = await getSession(request);
        if (!session) return reply.code(401).send({ error: "로그인이 필요합니다." });
        const parsed = z
            .object({ imageDataUrl: profileImageSchema.nullable() })
            .safeParse(request.body);
        if (!parsed.success)
            return reply
                .code(400)
                .send({ error: parsed.error.issues[0]?.message ?? "프로필 사진을 확인해 주세요." });
        const user = await findUserById(session.userId);
        if (!user) return reply.code(404).send({ error: "회원 정보를 찾을 수 없습니다." });
        if (!process.env.DATABASE_URL) {
            user.profileImageUrl = parsed.data.imageDataUrl;
        } else {
            const { db } = await import("../db/index");
            const { users } = await import("../db/schema");
            await db
                .update(users)
                .set({ profileImageUrl: parsed.data.imageDataUrl, updatedAt: dayjs().toDate() })
                .where(eq(users.id, user.id));
        }
        return {
            user: publicUser({ ...user, profileImageUrl: parsed.data.imageDataUrl }),
            message: parsed.data.imageDataUrl
                ? "프로필 사진이 등록되었습니다."
                : "프로필 사진이 삭제되었습니다.",
        };
    });
    app.post("/api/auth/logout", async (_request, reply) => {
        cookie(reply, "", 0);
        return { ok: true };
    });
}
