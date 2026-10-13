/** Installed only in an owned diagnostic renderer, before React loads. */
export const reactCommitProbe = String.raw`
  window.__qaCommits = 0;
  window.__qaFileTableCommits = 0;
  let previous = new WeakSet();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(id, root) {
      window.__qaCommits++;
      const seen = new WeakSet();
      const visit = fiber => {
        if (!fiber) return;
        // Reused bailout children retain old PerformedWork flags. Count only
        // a new work fiber for the selected production component.
        if (fiber.type === window.__qaFileTableType &&
            (fiber.flags & 1) && !previous.has(fiber))
          window.__qaFileTableCommits++;
        seen.add(fiber);
        visit(fiber.child);
        visit(fiber.sibling);
      };
      visit(root.current);
      previous = seen;
    },
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
`;
