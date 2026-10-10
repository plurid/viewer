/** Synthetic media, generated locally; no sourced or product assets.
 * Image/video source: ffmpeg color=c=0x82b3cf:s=64x64, video at 5 fps for one second.
 */
export const imageFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAZElEQVR4nO3PQQ3AIADAQEgwjiaMIGkieFyW9BS0c587/mzpgFcNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaB9jwAMC1OTN3wAAAABJRU5ErkJggg==',
  'base64',
);
export const videoFixture = Buffer.from(
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJnEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggJR7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAxV0GNTGF2ZjYyLjEyLjEwMUSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhxeLKqhjII0ZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgkLCBQLqBQJqBAlWwhFW5gQESVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTIuMTAxc3PWY8CLY8WIcXiyqoYyCNFnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjI4LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QKXngQCjwIEAAIDQAwCdASpAAEAAAEcIhYWIhYSIAgICdaoD+AP4AgcaRkYBcMdIS8QA/vpxH/9Jo1T8faW/+xmP2jP8bwCjloEAyADRAQABEBAAGAAYWC/0AAiOgACjloEBkADRAQABEBAAGAAYWC/0AAiOgACjloECWADRAQABEBAAGAAYWC/0AAiOgACjloEDIADRAQABEBAAGAAYWC/0AAiOgAAcU7trkbuPs4EAt4r3gQHxggGm8IED',
  'base64',
);
export function audioFixture(): Buffer {
  const rate = 22050,
    samples = rate,
    data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    data.writeInt16LE(Math.round(Math.sin((index / rate) * Math.PI * 880) * 1600), 44 + index * 2);
  return data;
}
