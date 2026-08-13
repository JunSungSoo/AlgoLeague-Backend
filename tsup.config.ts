import { defineConfig } from "tsup";
export default defineConfig({
    entry: {
        server: "src/server.ts",
        "judge-worker": "src/workers/judge/index.ts",
        "generation-worker": "src/workers/generation/index.ts",
        "policy-worker": "src/workers/policy/index.ts",
        "sandbox-server": "src/workers/sandbox/server.ts",
        migrate: "src/db/migrate.ts",
        seed: "src/db/seed.ts",
    },
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    sourcemap: true,
    clean: true,
    bundle: true,
    noExternal: [/.*/],
    splitting: false,
    banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
});
