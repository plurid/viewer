/** Qualification must count awake time, including the final timer interval. */
import { execFileSync } from 'node:child_process';

type Reading = { awakeMs: number; wallMs: number };
export type Elapsed = { awakeMs: number; wallMs: number };
export class QualificationInterrupted extends Error {
  constructor(readonly elapsed: Elapsed) {
    super(
      'Host sleep or a clock change interrupted qualification. Keep the Mac awake with its lid open and run a fresh qualification.',
    );
  }
}

export function nativeAwakeReading(): Reading {
  if (process.platform !== 'darwin') throw new Error('The awake clock requires macOS.');
  // Current libuv uses mach_continuous_time, which includes system sleep.
  // mach_absolute_time stops during sleep. The system SDK declares its timebase.
  // This helper belongs to the test runner and never accesses the candidate's data.
  const awakeMs = Number(
    execFileSync(
      '/usr/bin/python3',
      [
        '-c',
        `import ctypes
class Timebase(ctypes.Structure):
    _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
lib.mach_absolute_time.restype = ctypes.c_uint64
info = Timebase()
if lib.mach_timebase_info(ctypes.byref(info)) != 0 or not info.denom:
    raise RuntimeError('Cannot read the macOS awake timebase')
print(lib.mach_absolute_time() * info.numer / info.denom / 1000000)
`,
      ],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim(),
  );
  if (!Number.isFinite(awakeMs) || awakeMs < 0) throw new Error('Invalid macOS awake clock.');
  return { awakeMs, wallMs: Date.now() };
}

export class AwakeClock {
  private start: Reading;
  private previous: Elapsed = { awakeMs: 0, wallMs: 0 };
  constructor(private read: () => Reading = nativeAwakeReading) {
    this.start = read();
  }
  elapsed(): Elapsed {
    const now = this.read(),
      elapsed = {
        awakeMs: now.awakeMs - this.start.awakeMs,
        wallMs: now.wallMs - this.start.wallMs,
      };
    if (
      !Number.isFinite(elapsed.awakeMs) ||
      !Number.isFinite(elapsed.wallMs) ||
      elapsed.awakeMs < this.previous.awakeMs ||
      elapsed.wallMs < this.previous.wallMs ||
      Math.abs(elapsed.wallMs - elapsed.awakeMs) > 5000
    )
      throw new QualificationInterrupted(elapsed);
    this.previous = elapsed;
    return elapsed;
  }
}
