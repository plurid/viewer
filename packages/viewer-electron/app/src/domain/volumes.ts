export interface Volume {
  path: string;
  name: string;
  total: number;
  available: number;
  removable: boolean;
  ejectable: boolean;
  readOnly: boolean;
}

/** A network share address the system may mount; anything else is refused. */
export function serverAddress(input: string): string {
  let address: URL;
  try {
    address = new URL(input.trim());
  } catch {
    throw new Error('Enter a server address such as smb://server/share.');
  }
  if (!['smb:', 'afp:', 'nfs:', 'ftp:', 'cifs:'].includes(address.protocol) || !address.host)
    throw new Error('Use an smb, afp, nfs, ftp or cifs server address.');
  return address.href;
}
