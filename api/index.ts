// Vercel serverless entry point — re-exports the Express app as the default
// export (Vercel runs it as the request handler). src/server.ts (app.listen)
// is only for persistent hosts and is excluded via .vercelignore.
export { default } from '../src/app';
