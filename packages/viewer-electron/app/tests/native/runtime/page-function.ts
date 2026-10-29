/**
 * A page expression made from a real function, so scenarios stay readable instead of passing
 * minified strings. tsx keeps names through an `__name` helper the page lacks; the wrapper
 * defines it. The function must not use anything outside its own body and arguments.
 */
export function pageCall<Arguments extends unknown[]>(
  fn: (...args: Arguments) => unknown,
  ...args: Arguments
): string {
  return `(() => {
    const __name = (target) => target;
    return (${fn.toString()})(...${JSON.stringify(args)});
  })()`;
}
