import os from 'node:os';

/** The person's Home folder; a Mac App Store build's `os.homedir()` is its container. */
export const realHome = () => (process.mas ? os.userInfo().homedir : os.homedir());
