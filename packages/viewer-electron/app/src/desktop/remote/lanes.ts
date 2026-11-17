/** Separate SFTP channels, because OpenSSH answers one channel's requests in order. */
export type RemoteLane = 'browse' | 'transfer' | 'walk';

export const remoteLanes: readonly RemoteLane[] = ['browse', 'transfer', 'walk'];
