import { buildApp } from "./app";
const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 4000) });
