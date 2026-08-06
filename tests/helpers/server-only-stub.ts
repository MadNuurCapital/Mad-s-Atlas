/**
 * Test stub for the `server-only` package.
 *
 * `server-only` deliberately throws when resolved through its client export,
 * which is exactly the build-time guard we want in the application. Under
 * Vitest there is no bundler to pick the server export, so importing any
 * module that uses it would fail before a single assertion ran.
 *
 * Aliased in vitest.config.mts. This does NOT weaken the guard: the real
 * package is still what Next resolves at build time, and that is where a
 * client component importing a server module must fail.
 */
export {};
