import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { release } from 'node:os';
import { z } from 'zod';
import {
  speechMaximumBytes,
  speechSampleRate,
  pcmEnergy,
  type SpeechLanguage,
  type SpeechRuntimeStatus,
  type SpeechTranscript,
} from '../../domain/speech/recognition';
import { speechRuntimeArchive, speechRuntimeName, speechRuntimeVersion } from './runtime-manifest';
import { verifySpeechPackage } from './signed-resources';

const transcript = z.object({ text: z.string().max(48000), language: z.string().max(20) }).strict();
export class SpeechRuntime {
  private proof?: Promise<{ helper: string; library: string }>;
  constructor(
    private root = path.join(process.resourcesPath ?? path.resolve('assets'), speechRuntimeName()),
  ) {}
  private verify() {
    return (this.proof ??= (async () => {
      const folder = await lstat(this.root);
      if (!folder.isDirectory() || folder.isSymbolicLink())
        throw new Error('Speech engine resources must be an ordinary folder.');
      const manifestPath = path.join(this.root, 'manifest.json'),
        info = await lstat(manifestPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 8192)
        throw new Error('Invalid speech engine manifest.');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        version: string;
        archive: string;
        files: Record<string, string>;
      };
      if (
        manifest.version !== speechRuntimeVersion ||
        manifest.archive !== speechRuntimeArchive.sha256
      )
        throw new Error('The speech engine release differs from the pinned manifest.');
      let changedBySigning = false;
      for (const name of ['viewer-speech-recognizer', 'libwhisper.dylib']) {
        if (!/^[a-f0-9]{64}$/.test(manifest.files[name] ?? ''))
          throw new Error('Invalid speech engine checksum manifest.');
        const file = path.join(this.root, name),
          info = await lstat(file),
          hash = createHash('sha256');
        if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024 ** 2)
          throw new Error('The speech engine resource is not a bounded ordinary file.');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        if (hash.digest('hex') !== manifest.files[name]) changedBySigning = true;
      }
      if (changedBySigning) await verifySpeechPackage(this.root);
      return {
        helper: path.join(this.root, 'viewer-speech-recognizer'),
        library: path.join(this.root, 'libwhisper.dylib'),
      };
    })().catch((error) => {
      this.proof = undefined;
      throw error;
    }));
  }
  async status(): Promise<SpeechRuntimeStatus> {
    try {
      if (process.platform !== 'darwin')
        throw new Error('Local speech has not been bundled for this platform.');
      const [major = 0, minor = 0] = release().split('.').map(Number);
      if (major < 22 || (major === 22 && minor < 4))
        return {
          name: 'whisper.cpp',
          recognitionAvailable: false,
          reason: 'Local speech requires macOS 13.3 or later.',
        };
      await this.verify();
      return {
        name: 'whisper.cpp',
        version: speechRuntimeVersion,
        recognitionAvailable: true,
        reason: 'Transcription runs locally. Audio stays in memory and is not sent to a provider.',
      };
    } catch {
      return {
        name: 'whisper.cpp',
        recognitionAvailable: false,
        reason:
          'The local speech engine is missing or could not be verified. Use a Viewer build that bundles local speech.',
      };
    }
  }
  async transcribe(
    file: string,
    model: string,
    pcm: Uint8Array,
    language: SpeechLanguage,
    outer: AbortSignal,
  ): Promise<SpeechTranscript> {
    outer.throwIfAborted();
    if (pcm.byteLength < 3200 || pcm.byteLength > speechMaximumBytes || pcm.byteLength % 2)
      throw new Error('Record between 0.1 and 60 seconds of audio.');
    const seconds = pcm.byteLength / (speechSampleRate * 2),
      start = Date.now();
    if (pcmEnergy(pcm) < 0.002) return { text: '', language, seconds, milliseconds: 0, model };
    const runtime = await this.verify();
    const signal = AbortSignal.any([outer, AbortSignal.timeout(120000)]);
    const answer = await new Promise<unknown>((resolve, reject) => {
      const child = spawn(runtime.helper, [runtime.library, file, language], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin' },
        signal,
      });
      const chunks: Buffer[] = [];
      let size = 0,
        errors = 0,
        failure: Error | undefined;
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 262144) {
          failure = new Error('The speech engine response exceeded its limit.');
          child.kill();
        } else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if ((errors += chunk.length) > 262144) {
          failure = new Error('The speech engine diagnostics exceeded their limit.');
          child.kill();
        }
      });
      child.on('error', (error) => {
        failure = error;
      });
      child.stdin.on('error', () => {});
      child.on('close', (code) => {
        if (signal.aborted) reject(signal.reason);
        else if (failure) reject(failure);
        else if (code !== 0)
          reject(
            new Error('Local transcription failed. Try a shorter recording or a different model.'),
          );
        else {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('The speech engine returned an invalid response.'));
          }
        }
      });
      child.stdin.end(pcm);
    });
    outer.throwIfAborted();
    const result = transcript.parse(answer);
    return {
      ...result,
      text: result.text.trim(),
      model,
      seconds,
      milliseconds: Date.now() - start,
    };
  }
}
