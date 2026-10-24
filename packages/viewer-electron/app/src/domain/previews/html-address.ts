/** Private page capabilities use an opaque UUID host and never carry credentials or a port. */
export function htmlCapability(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'viewer-html:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(parsed.hostname)
      ? parsed.hostname
      : undefined;
  } catch {
    return undefined;
  }
}
