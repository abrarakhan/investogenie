// Next.js resolves `import "server-only"` to its bundled marker module
// (next/dist/compiled/server-only): a no-op in server bundles and a build
// error in client bundles. Declared here so TypeScript needs no extra package.
declare module "server-only";
