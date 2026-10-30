declare const result: unique symbol;

/** An expression for `Runtime.evaluate` whose awaited value is `R`. */
export type PageExpression<R> = string & { readonly [result]: R };

/**
 * A page expression made from a real function, so scenarios stay readable instead of passing
 * minified strings. tsx keeps names through an `__name` helper the page lacks; the wrapper
 * defines it. The function must not use anything outside its own body and arguments. Arguments
 * travel as JSON: `undefined` arrives as `null`.
 */
export function pageCall<Arguments extends unknown[], R>(
  fn: (...args: Arguments) => R,
  ...args: Arguments
): PageExpression<R> {
  return `(() => {
    const __name = (target) => target;
    return (${fn.toString()})(...${JSON.stringify(args)});
  })()` as PageExpression<R>;
}
