export const judgeLanguages = ["python", "java", "javascript", "cpp"] as const;
export type JudgeLanguage = (typeof judgeLanguages)[number];
export type Verdict = "QU" | "RN" | "AC" | "WA" | "CE" | "RE" | "TLE" | "OLE" | "SE" | "JH" | "IE";

export const languagePolicy: Record<
    JudgeLanguage,
    { image: string; seconds: number; extension: string; sourceName: string }
> = {
    python: { image: "python:3.14.6-slim", seconds: 4, extension: "py", sourceName: "main.py" },
    java: {
        image: "eclipse-temurin:25-jdk",
        seconds: 3,
        extension: "java",
        sourceName: "Main.java",
    },
    javascript: {
        image: "node:24.18.0-bookworm-slim",
        seconds: 4,
        extension: "js",
        sourceName: "main.js",
    },
    cpp: { image: "gcc:15.3", seconds: 2, extension: "cpp", sourceName: "main.cpp" },
};

export function compareOutput(actual: string, expected: string, tolerance?: number) {
    const actualTokens = actual.trim().split(/\s+/);
    const expectedTokens = expected.trim().split(/\s+/);
    if (actualTokens.length !== expectedTokens.length) return false;
    return expectedTokens.every((token, index) => {
        if (tolerance === undefined) return actualTokens[index] === token;
        const left = Number(actualTokens[index]);
        const right = Number(token);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return actualTokens[index] === token;
        return (
            Math.abs(left - right) <= tolerance ||
            Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(right))
        );
    });
}
