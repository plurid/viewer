import { decodeBinaryPlist, isBinaryPlist, xmlPlistValue } from './plist';

/**
 * Internet shortcuts: a Windows `.url` file, an INI section naming its URL, and a macOS `.webloc`,
 * a property list with a URL key. Viewer shows the address and never fetches it; Open hands web
 * and email addresses to the person's own apps.
 */
export const shortcutFormats = ['url', 'webloc'] as const;
/** A shortcut holds one address: more than this is not a shortcut. */
export const shortcutLimit = 64 * 1024;
/** The schemes Open hands to another app. */
export const openableSchemes: readonly string[] = ['http:', 'https:', 'mailto:'];

export interface ShortcutFacts {
  url: string;
  /** The host of a web address, the recipient of an email address. */
  host: string;
  scheme: string;
  /** Why Open is not offered. */
  refusal?: string;
}

/** Why an address is not opened, or undefined when it may be. */
function refusal(url: URL): string | undefined {
  if (!openableSchemes.includes(url.protocol))
    return `Viewer opens web and email addresses only, not ${url.protocol.slice(0, -1)} addresses.`;
  if (url.username || url.password)
    return 'The address holds a user name or password, so Viewer does not open it.';
  return undefined;
}

/** An address Open may hand to the person's browser or mail app; anything else is refused. */
export function linkAddress(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('This is not a valid address.');
  }
  const refused = refusal(url);
  if (refused) throw new Error(refused);
  return url.href;
}

export function shortcutFacts(address: string): ShortcutFacts {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return { url: address, host: '', scheme: '', refusal: 'This is not a valid address.' };
  }
  let host = url.hostname;
  if (url.protocol === 'mailto:')
    try {
      host = decodeURIComponent(url.pathname);
    } catch {
      host = url.pathname;
    }
  return { url: url.href, host, scheme: url.protocol.slice(0, -1), refusal: refusal(url) };
}

/** Text in UTF-16 with its byte-order mark, UTF-8, or Windows' own code page. */
function shortcutText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The URL of a `.url` file's InternetShortcut section, or its DEFAULT section's BASEURL. */
function internetShortcut(text: string): string | undefined {
  let section = '';
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const header = /^\[(.+)\]$/.exec(trimmed);
    if (header) {
      section = header[1]!.toLowerCase();
      continue;
    }
    const pair = /^([^=;]+)=(.*)$/.exec(trimmed);
    if (pair) values.set(`${section}.${pair[1]!.trim().toLowerCase()}`, pair[2]!.trim());
  }
  return values.get('internetshortcut.url') || values.get('default.baseurl') || undefined;
}

/** The address a shortcut file names; `extension` says which kind it is. */
export function readShortcut(bytes: Uint8Array, extension: string): ShortcutFacts {
  if (bytes.length > shortcutLimit) throw new Error('This file is too large to be a shortcut.');
  let address: unknown;
  if (extension === 'webloc') {
    if (!bytes.length)
      throw new Error(
        'This shortcut keeps its address in a resource fork, which Viewer does not read.',
      );
    const plist = isBinaryPlist(bytes)
      ? decodeBinaryPlist(bytes)
      : xmlPlistValue(shortcutText(bytes));
    address =
      plist && typeof plist === 'object' ? (plist as Record<string, unknown>).URL : undefined;
  } else address = internetShortcut(shortcutText(bytes));
  if (typeof address !== 'string' || !address.trim())
    throw new Error('This shortcut names no address.');
  return shortcutFacts(address);
}
