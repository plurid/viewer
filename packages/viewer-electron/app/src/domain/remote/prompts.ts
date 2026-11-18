import { remoteLimits } from './limits';

/**
 * `secret`: a password, passphrase, PIN or code, typed into a secure field. `host-key`: OpenSSH
 * asks whether to trust a key it has not seen. `notice`: something to do elsewhere, such as
 * touching a security key (`SSH_ASKPASS_PROMPT=none`); OpenSSH ends it itself.
 */
export type RemotePromptKind = 'secret' | 'host-key' | 'notice';

export type SecretField = 'Passphrase' | 'PIN' | 'Password' | 'Verification code' | 'Answer';

/** How a question is shown: who asks it, what it says, what the secure field holds. */
export interface PromptPresentation {
  kind: RemotePromptKind;
  title: string;
  text: string;
  placeholder: SecretField;
}

/** What a prompt is shown with: the connection's name and the file name of its chosen key. */
export interface PromptContext {
  name: string;
  key?: string;
}

const invisible = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

/**
 * Prompt text as people see it: line breaks and tabs become spaces, every other control, format,
 * bidi or invisible character is removed, and the result is capped at 2,000 characters.
 */
export function remotePromptText(text: string): string {
  const visible = [...text.slice(0, 4 * remoteLimits.serverPromptCharacters)]
    .map((character) => (/[\t\r\n\u2028\u2029]/u.test(character) ? ' ' : character))
    .filter((character) => !invisible.test(character))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
  return [...visible].slice(0, remoteLimits.serverPromptCharacters).join('');
}

/** The empty secure field names what was asked for. */
export function secretPlaceholder(text: string): SecretField {
  if (/passphrase/i.test(text)) {
    return 'Passphrase';
  }
  if (/\bPIN\b/.test(text)) {
    return 'PIN';
  }
  if (/verification|one-time|\bcode\b|\bOTP\b|token/i.test(text)) {
    return 'Verification code';
  }
  if (/password/i.test(text)) {
    return 'Password';
  }
  return 'Answer';
}

const baseName = (file: string): string => file.split('/').filter(Boolean).at(-1) ?? file;

// OpenSSH's own questions, as sshconnect.c and sshconnect2.c word them. A server's
// keyboard-interactive question always starts "(user@host) ", so it cannot pass for one of these.
const passphrase = /^Enter passphrase for key '(.+)':$/;
const pin = /^Enter PIN for \S+ key .+:$/;
const password = /^(\S{1,30})@\S+'s password:$/;
const firstKey = /^The authenticity of host '.+' can't be established\./;
const fingerprint = /\b([A-Z0-9-]{2,20}) key fingerprint is (SHA256:[A-Za-z0-9+/]{43})\./;
const yesNo = /\(yes\/no(?:\/\[fingerprint\])?\)\?$/;
const touch = /^Confirm user presence for key /;
const server = /^\(\S+@\S+\) (.+)$/;

/**
 * Questions OpenSSH asks on the Mac are Viewer's own, in Viewer's words. Everything else, the
 * server's keyboard-interactive questions included, is quoted and attributed to the server, so
 * a server can never word a question as if Viewer asked it.
 *
 * @param hint OpenSSH's `SSH_ASKPASS_PROMPT`: `none` for a notice it ends itself
 */
export function describePrompt(
  raw: string,
  hint: string | undefined,
  context: PromptContext,
): PromptPresentation {
  const text = remotePromptText(raw);
  const target = '“' + context.name + '”';
  const quoted = (words: string) => '“' + words + '”';
  const asked = (words: string): PromptPresentation => ({
    kind: 'secret',
    title: context.name + ' asks:',
    text: quoted(words),
    placeholder: secretPlaceholder(words),
  });
  if (hint === 'none') {
    return touch.test(text)
      ? {
          kind: 'notice',
          title: 'Touch your security key',
          text: 'To connect to ' + target + '.',
          placeholder: 'Answer',
        }
      : {
          kind: 'notice',
          title: context.name + ' asks:',
          text: quoted(text),
          placeholder: 'Answer',
        };
  }
  const fromServer = server.exec(text);
  if (fromServer) {
    return asked(fromServer[1]!);
  }
  const key = passphrase.exec(text);
  if (key) {
    // OpenSSH cuts the path at 100 characters; the saved key's own name is never cut.
    return {
      kind: 'secret',
      title: 'Passphrase for key “' + (context.key ?? baseName(key[1]!)) + '”',
      text: 'Enter it to connect to ' + target + '.',
      placeholder: 'Passphrase',
    };
  }
  if (pin.test(text)) {
    return {
      kind: 'secret',
      title: 'PIN for your security key',
      text: 'Enter it to connect to ' + target + '.',
      placeholder: 'PIN',
    };
  }
  const user = password.exec(text);
  if (user) {
    return {
      kind: 'secret',
      title: 'Password for “' + user[1] + '”',
      text: 'Enter it to connect to ' + target + '.',
      placeholder: 'Password',
    };
  }
  if (firstKey.test(text) || yesNo.test(text)) {
    const offered = fingerprint.exec(text);
    return offered && firstKey.test(text)
      ? {
          kind: 'host-key',
          title: 'First connection to ' + target,
          text:
            'Its ' +
            offered[1] +
            ' key fingerprint is ' +
            offered[2] +
            '. Trust it only if it matches the fingerprint the server’s administrator gives you.',
          placeholder: 'Answer',
        }
      : {
          kind: 'host-key',
          title: 'Trust the host key of ' + target + '?',
          text,
          placeholder: 'Answer',
        };
  }
  return asked(text);
}
