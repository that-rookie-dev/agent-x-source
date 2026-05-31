// Minimal ambient declaration to avoid requiring `pg` types during typecheck
// The real `pg` package is imported dynamically at runtime; this shim prevents
// TypeScript from erroring when `pg` is not installed in the dev environment.
declare module 'pg' {
  // Pool is used in this file; declare as any to keep typing minimal
  export const Pool: any;
  const _default: any;
  export default _default;
}
