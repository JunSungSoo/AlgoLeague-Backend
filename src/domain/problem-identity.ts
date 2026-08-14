import { createHash } from "node:crypto";
import type { ProblemPackage } from "./generation";

export function problemTitleKey(title: string) {
    return title
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .replaceAll(/[^\p{L}\p{N}]/gu, "");
}

export function problemFingerprint(
    problem: Pick<ProblemPackage, "statement" | "input" | "output">,
) {
    const canonical = [problem.statement, problem.input, problem.output]
        .map(normalizeText)
        .join("|");
    return createHash("md5").update(canonical).digest("hex");
}

function normalizeText(value: string) {
    return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replaceAll(/\s+/g, " ").trim();
}
