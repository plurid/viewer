/** Independent Microsoft Office PDFs from exclusively owned public-file copies. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { temporaryRoot } from '../../tools/temporary';
import { hashFile } from '../../tools/qualification/source';
import { officeLayoutSamples } from '../../tools/playground/office-layout';
import { qualificationSamples } from '../../tools/playground/qualification-samples';
import { defaultPlaygroundDirectory } from '../../tools/playground/main';

assert.equal(process.env.VIEWER_TEST_PRESERVE, '1');
assert.equal(process.env.VIEWER_TEST_NO_REMOVAL, '1');
assert.equal(process.platform, 'darwin', 'Microsoft Office reference automation requires macOS.');
const corpus = process.env.VIEWER_TEST_OFFICE_CORPUS;
assert.ok(corpus);
const retry = process.env.VIEWER_TEST_OFFICE_REFERENCE_RETRY;
const inputRoot = retry
  ? path.resolve(retry)
  : await temporaryRoot('viewer-office-references-', path.resolve('out'));
if (retry) {
  const info = await lstat(inputRoot);
  assert.ok(info.isDirectory() && !info.isSymbolicLink());
}
const root = retry ? path.join(inputRoot, 'Retry-' + randomUUID()) : inputRoot;
if (retry) await mkdir(root);
const files = path.join(inputRoot, 'Inputs');
const output = path.join(root, 'Microsoft Office');
if (!retry) await mkdir(files);
await mkdir(output);
const exec = promisify(execFile);
const scripts = {
  word: `on run argv
    set sourcePath to item 1 of argv
    set outputPath to item 2 of argv
    set opened to missing value
    tell application "Microsoft Word"
      with timeout of 40 seconds
        try
          set opened to open file name sourcePath read only true add to recent files false
          if class of opened is list then set opened to item 1 of opened
          set print revisions of opened to false
          set show revisions and comments of view of active window of opened to false
          save as opened file name outputPath file format format PDF add to recent files false
          close opened saving no
          return version
        on error messageText number errorNumber
          if opened is not missing value then
            try
              close opened saving no
            end try
          end if
          error messageText number errorNumber
        end try
      end timeout
    end tell
  end run`,
  excel: `on run argv
    set sourcePath to item 1 of argv
    set outputPath to item 2 of argv
    set opened to missing value
    set phase to "open"
    set sourceMacPath to (POSIX file sourcePath) as text
    set outputMacPath to (POSIX file outputPath) as text
    tell application "Microsoft Excel"
      with timeout of 40 seconds
        try
          set opened to open workbook workbook file name sourceMacPath update links do not update links read only true editable true add to mru false
          set phase to "select first sheet"
          set selectedSheet to worksheet 1 of opened
          set phase to "activate first sheet"
          activate object selectedSheet
          set phase to "export PDF"
          save workbook as opened filename outputMacPath file format PDF file format add to most recently used list false
          set phase to "close generated workbook"
          close opened saving no
          return version
        on error messageText number errorNumber
          if opened is not missing value then
            try
              close opened saving no
            end try
          end if
          error (phase & ": " & messageText) number errorNumber
        end try
      end timeout
    end tell
  end run`,
  powerpoint: `on run argv
    set sourcePath to item 1 of argv
    set outputPath to item 2 of argv
    set sourceName to item 3 of argv
    set opened to missing value
    tell application "Microsoft PowerPoint"
      with timeout of 40 seconds
        try
          open (POSIX file sourcePath)
          set candidate to presentation sourceName
          set candidatePath to full name of candidate
          if candidatePath is not sourcePath and candidatePath is not ((POSIX file sourcePath) as text) then error "Reference presentation identity did not match its generated copy."
          set opened to candidate
          save opened in (POSIX file outputPath) as save as PDF
          close opened saving no
          return version
        on error messageText number errorNumber
          if opened is not missing value then
            try
              close opened saving no
            end try
          end if
          error messageText number errorNumber
        end try
      end timeout
    end tell
  end run`,
};
for (const [name, script] of Object.entries(scripts))
  await writeFile(path.join(root, name + '.applescript'), script, { flag: 'wx' });
const records: {
  name: string;
  sourceSHA256: string;
  reference?: string;
  officeVersion?: string;
  referenceScope?: string;
  error?: string;
}[] = [];
const formats = process.env.VIEWER_TEST_OFFICE_REFERENCE_FORMATS?.split(',');
const samples = [
  ...officeLayoutSamples,
  ...qualificationSamples.filter((sample) =>
    /poi-(various-pictures.docx|conditional-formatting.xlsx|chart-picture-background.pptx|page-breaks.docx)$/.test(
      sample.path,
    ),
  ),
].filter((sample) => !formats || sample.formats.some((format) => formats.includes(format)));
for (const sample of samples) {
  const name = decodeURIComponent(path.basename(new URL(sample.url).pathname));
  const file = path.join(files, name);
  let source = path.join(corpus, name);
  try {
    await lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    source = path.join(defaultPlaygroundDirectory, sample.path);
  }
  const info = await lstat(source);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(await hashFile(source), sample.sha256);
  if (!retry) await copyFile(source, file, 1);
  const copy = await lstat(file);
  assert.ok(copy.isFile() && !copy.isSymbolicLink());
  assert.equal(await hashFile(file), sample.sha256);
  const record: (typeof records)[number] = { name, sourceSHA256: sample.sha256 };
  try {
    const extension = path.extname(name).slice(1);
    const app = ['doc', 'docx'].includes(extension)
      ? 'word'
      : ['xls', 'xlsx'].includes(extension)
        ? 'excel'
        : 'powerpoint';
    const destination = path.join(output, name + '.pdf');
    const result = await exec(
      '/usr/bin/osascript',
      [path.join(root, app + '.applescript'), file, destination, name],
      { timeout: 45000, maxBuffer: 1_000_000 },
    );
    assert.ok((await lstat(destination)).size > 100);
    record.reference = path.relative(root, destination);
    record.officeVersion = result.stdout.trim();
    record.referenceScope =
      app === 'excel'
        ? 'Complete workbook; compare the native page range of the selected worksheet'
        : app === 'word'
          ? 'Complete document without revision/comment markup'
          : 'Complete presentation';
    console.log('Microsoft Office reference exported: ' + name);
  } catch (error) {
    record.error = String(error);
    console.log('Microsoft Office reference failed: ' + name);
  }
  assert.equal(await hashFile(file), sample.sha256);
  assert.equal(await hashFile(source), sample.sha256);
  records.push(record);
  await writeFile(path.join(root, name + '.json'), JSON.stringify(record, null, 2), { flag: 'wx' });
}
const passed = records.every((record) => record.reference);
await writeFile(
  path.join(root, 'result.json'),
  JSON.stringify(
    {
      passed,
      records,
      scope:
        'Independent Office exports of generated copies; originals and unrelated open documents were not saved or closed.',
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log('Preserved Microsoft Office references: ' + path.relative(process.cwd(), root));
if (!passed) process.exitCode = 1;
