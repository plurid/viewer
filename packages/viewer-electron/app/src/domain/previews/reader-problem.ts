import { layoutFailures, officeLayoutRecovery } from './documents/layout';
import { resourceStatusMessage, resourceStatusMessages } from './resource-status';
import { errorMessage } from '../errors';
import { needsFolderAccess } from '../files/access';

export const fontLoadFailure = "This font may be damaged, or in a format Viewer can't show.";
const fontTableProblems = [
  'This file is not a TrueType, OpenType or WOFF font.',
  'The font collection has no faces.',
  'A compressed font table is larger than its original.',
  'A compressed font table is too large to read.',
  'A compressed font table is longer than its directory states.',
  'A compressed font table is damaged.',
  'A compressed font table is shorter than its directory states.',
  'The font file is truncated.',
  'A font table lies outside the file.',
  'Its WOFF2 tables are compressed with Brotli.',
  'Its tables could not be read.',
] as const;

/** Fixed reader refusals, grouped by the preview that presents them. The sentence is also
 * their wire identity. Exception detail travels separately and never supplies display text. */
export const readerProblems = {
  resource: [
    'The file is protected. Open it in its own app.',
    'The file is damaged or incomplete.',
    'The file ends before all of its data can be read.',
    'Viewer does not support this file format.',
    'Reading this file took too long.',
    'The file could not be read.',
    'File access was canceled.',
    'The document preview was canceled.',
    'The preview source changed while reading.',
    'The preview was canceled.',
    'Select a regular document.',
    ...Object.values(resourceStatusMessages),
    'Allow access to this folder using the folder picker, then try again.',
    'Close some previews before opening more files.',
    'Choose a regular file to preview.',
    'Special devices and sockets cannot be previewed.',
    'Too many comparisons are open. Close one before opening another.',
    'Too many previews are open. Close one, then try again.',
    'Allow agents to send this data to the provider in Settings → Models before an agent runs this action.',
    'Allow this provider to receive the selected data before running the action. Review model data permissions in Settings → Models.',
    'Too many document pages are opening. Try again.',
    'Too many documents are opening. Close a preview and try again.',
    'Too many local previews are opening. Close a preview and try again.',
    'Wait for another document preview to finish opening.',
    'The local preview cache is full. Close a rendered preview and try again.',
    'Preview access changed. Open the file again.',
    'This preview resource has expired.',
    'This preview request has expired.',
    'This preview request is already running.',
    'This document request is already running.',
    'Preview resources have closed.',
    'This file changed after Viewer read its format. Reopen its preview.',
    'This preview file is no longer a regular file.',
    'Viewer can’t open a document inside this file here.',
    'Viewer reads only the saved picture of a document package.',
    'The document changed while being read. Open it again.',
    'The file changed while reading. Retry with the current file.',
    'The file changed or is truncated.',
    'The source changed before decoding. Reopen its preview.',
    'The source changed during decoding. Reopen its preview.',
    'This source changed. Reopen its preview.',
    'This file exceeds the local preview input limit. Open it in its original app.',
    'The item moved while waiting for its file provider. Refresh the folder and retry.',
    'The file provider did not make this item available in time. Check its connection, then retry.',
    'Too many pending file provider requests.',
  ],
  recovery: [
    'Viewer found no single renamed file in this folder. Use Locate File… to choose it.',
    'The file changed as Viewer found it. Try again.',
  ],
  image: [
    'RAW rendering requires a camera RAW file.',
    'Choose a preview size between 1 and 4096 pixels.',
    'The RAW preview was canceled.',
    'The RAW helper returned an invalid preview.',
    'The RAW helper returned an invalid image.',
    'This build of Viewer can’t decode this file.',
    'This build of Viewer can’t render this preview.',
    'Rendered previews need a file on disk.',
    'Only an embedded TIFF picture can be decoded from PostScript.',
    'The embedded TIFF exceeds its preview limit.',
    'This build of Viewer can’t decode SVG images.',
    'This build of Viewer can’t decode OpenEXR images.',
    'This build of Viewer can’t decode this TIFF image.',
    'This image could not be decoded within the local preview limits. Open it in its original app.',
    'Image decoding exceeded 10 seconds. Retry or open the file in its original app.',
    'The macOS image preview timed out. Retry the preview or open the file in its original app.',
    'RAW decoding exceeded 30 seconds. Retry or open the file in its original app.',
    'This RAW rendition exceeds the 32 MB preview limit.',
    'This camera file could not be decoded. It may be damaged or use an unsupported RAW encoding. Open it in its original app.',
  ],
  media: [
    'This build of Viewer can’t convert videos to play here.',
    'Choose a supported audio or video file for a compatibility preview.',
    'Choose a supported audio or video file.',
    'This media has no supported duration, or is longer than 24 hours.',
    'The video changed before conversion. Reopen its preview.',
    'This file has no supported video picture.',
    'The complete video is too long for the 64 MB compatibility-preview limit. Open it in its original app.',
    'The compatibility copy could not be verified through its final frame.',
    'A complete compatibility copy could not be verified. Open this video in its original app.',
    'The video preview was canceled.',
    'Local video conversion exceeded two minutes. Open the file in its original app.',
    'The complete compatibility copy exceeds 64 MB. Open this video in its original app.',
    'A compatible video copy could not be decoded. Open the file in its original app.',
    'The complete recording is too long for the 64 MB compatibility-preview limit. Open it in its original app.',
    'The recording changed before conversion. Reopen its preview.',
    'A complete compatibility copy could not be verified. Open this recording in its original app.',
  ],
  archive: [
    'This archive entry is damaged or encrypted.',
    'The archive is damaged or incomplete.',
    'Archive source must be a regular file.',
    'Nested archives are not supported yet.',
    'The archive changed while reading. Retry with the current file.',
    'This archive entry cannot be previewed (unsupported compression, encryption, or size).',
    'This is not a supported ZIP or TAR archive.',
    'Viewer can’t open a ZIP archive split into several files.',
    'Viewer can’t open ZIP64 archives.',
    'Compressed TAR preview is limited to 64 MB.',
    'Compressed TAR changed or is truncated.',
    'This ZIP entry cannot be streamed.',
    'ZIP index exceeds the preview limit or is malformed.',
    'Archive entry size exceeds its index or reader limit.',
    'TAR file name exceeds the preview limit.',
  ],
  compressed: [
    'The compressed data is damaged or incomplete.',
    'This file is not gzip-compressed.',
    'This gzip file is damaged or incomplete.',
    'This file expands beyond the 8 MB preview limit.',
    'This gzip file holds no file.',
  ],
  embedded: [
    'This preview section lies outside its source.',
    'The embedded picture exceeds 32 MiB.',
    'This picture is missing or exceeds its preview limit.',
    'This picture is not a PNG within its preview limit.',
    'This picture is not the PNG or JPEG it is named, or exceeds its preview limit.',
    'This member is missing or exceeds its preview limit.',
    'This package member changed while it was read.',
    'This package member is not in a folder.',
    'This package member is not a regular file.',
    'This package member is not where its name says.',
    'This picture is not the PNG or JPEG it is named.',
  ],
  book: [
    'This book illustration exceeds its preview limit.',
    'This book illustration has unsupported or oversized dimensions.',
    'The derived preview exceeds its memory limit.',
    'This EPUB has no readable publication metadata. Encrypted publications may require another reader.',
    'EPUB expanded content exceeds its extraction limit.',
    'External XML entities are not supported.',
    'This file holds no FictionBook.',
    'This book exceeds 32 MB.',
    'This XML is not a FictionBook.',
  ],
  office: [
    {
      example: 'This Office XML nests deeper than Viewer reads.',
      pattern:
        /^This Office XML (?:nests deeper|has a part larger|has more elements) than Viewer reads\.$/,
    },
    'A part of this Office document is missing, encrypted or unsupported.',
    'Duplicate workbook number format.',
    'The embedded image exceeds the supported PNG/JPEG preview bounds.',
    'This image is not a supported embedded document relationship.',
    'Embedded document images require a supported Word document.',
    'Office package has duplicate part names.',
    'This Office format has no readable package.',
    'Office document changed while being read. Open it again.',
    'The bundled Office renderer is missing or damaged.',
    'The source changed while opening its Office layout.',
    'Office file must be a regular file within 64 MB.',
    'Office package index exceeds the reader limit.',
    'Office expanded content exceeds the reader limit.',
    'Office package has no local main document.',
    'Office package type does not match this document.',
    'This DOCX has no readable document body.',
    'Malformed or unsupported Office XML.',
    'Office XML declarations and external entities are not supported.',
    'Office XML part exceeds 4 MB.',
    'This XLSX has no readable workbook.',
    'This XLSX has no worksheets.',
    'This workbook has no worksheet by that name.',
    'The requested worksheet has no supported local content.',
    'Worksheet pages are available for Excel workbooks only.',
    'Worksheet pages are available for supported Excel workbooks only.',
    'Document is not a regular file within the extraction limit.',
    'This format has no text extractor.',
    'Worksheet cell address exceeds Excel limits.',
    'This Office document has damaged package relationships.',
    'The message headers exceed the reader limit.',
    'The worksheet is damaged or incomplete.',
  ],
  mail: [
    'This message is larger than 64 MB.',
    'The HTML body of this message exceeds 4 MB.',
    "This message's headers are longer than Viewer reads.",
    'This message is no longer in the mailbox.',
    'This message is not a regular file.',
    'The message headers exceed the reader limit.',
    'This mailbox is not a regular file.',
    'The mailbox changed while it was read. Open it again.',
    'The message changed while it was read. Open it again.',
    'This file does not start with an Apple Mail message length.',
    'This file holds one message, not a mailbox.',
    'Choose a message of this mailbox.',
  ],
  html: [
    'Asset request timed out.',
    'The file request was canceled.',
    'Archived HTML has no local page to render.',
    'This HTML has no local page to render.',
    'A document package is edited in its own app.',
    'This HTML preview has closed. Open the file again.',
    'This HTML preview resource has changed. Open it again.',
    'Close an HTML preview before opening another.',
    'Too many HTML previews.',
    'Close a preview before opening another.',
    'Choose an on-disk HTML file.',
    'Choose an on-disk file.',
    'Folder access is required.',
    'The selected folder changed. Select it again.',
    'The page exceeds 4 MB of HTML.',
    'The page parts exceed their limit.',
    'The saved page exceeds 4 MB of HTML.',
    'This web archive exceeds 64 MB.',
    'Choose an absolute folder path.',
    'Choose a regular folder.',
    'The selected folder changed.',
    'Preview closed.',
    'Too many simultaneous asset reads.',
    'The asset is outside this folder.',
    'The asset changed while opening.',
    'Only GET and HEAD are available.',
    'This preview doesn’t list folders.',
    'Only regular assets are available.',
    'An HTML preview doesn’t load this kind of file.',
    'The asset is too large.',
    'The asset changed while reading.',
    'Method not allowed.',
    'This page holds no such part.',
    'Web previews are closed.',
    'Too many pending web preview requests.',
    'This property list holds no saved web page.',
  ],
  pdf: ['The PDF is damaged or incomplete.'],
  djvu: [
    'This DjVu file is larger than 256 MB.',
    'This page is too large to render.',
    'That page does not exist.',
    'The document is not open.',
    'The DjVu decoder stopped.',
  ],
  postscript: [
    {
      example: 'Ghostscript 10.03.1 exceeded the PDF output size limit.',
      pattern:
        /^Ghostscript(?: \d{1,3}\.\d{1,3}(?:\.\d{1,3})?)? (?:could not render this document|exceeded the (?:rendering time|PDF output size|scratch-space) limit)\.$/,
    },
    'Choose a PostScript, EPS or Illustrator file.',
    'Choose a regular PostScript file.',
    'This PostScript file changed while opening.',
    'This EPS PostScript section is malformed; its bytes are shown below.',
    'The App Store edition can’t render PostScript.',
    'This build of Viewer can’t render PostScript.',
    'This Illustrator file already contains a PDF.',
    'This PostScript file is malformed; its bytes are shown below.',
    'PostScript rendering was canceled.',
    'Reading the page was canceled.',
    'Ghostscript could not be checked.',
    'Ghostscript changed; choose Render pages again.',
    'Install Ghostscript (brew install ghostscript) to show the pages.',
    'The selected program did not identify itself as Ghostscript.',
    'Ghostscript did not produce a complete PDF.',
    'The Ghostscript scratch folder changed and was kept.',
    'The Ghostscript scratch folder could not be safely checked and was kept.',
    'Ghostscript’s temporary files were kept because Viewer couldn’t move them to the Trash.',
    'Ghostscript scratch could not be moved to Trash and was kept.',
    'Ghostscript left scratch behind after rendering; the scratch was moved to Trash.',
  ],
  shortcut: [
    'This is not a valid address.',
    'This shortcut names no address.',
    'The shortcut could not be read.',
    'This shortcut keeps its address in a resource fork, which Viewer does not read.',
    'This file is too large to be a shortcut.',
  ],
  text: [
    'The property list is damaged or incomplete.',
    'The property list holds an element Viewer does not read.',
    'This is not a binary property list.',
    'This XML is not a property list.',
    'The property list has an invalid trailer.',
    'The property list is too large.',
    'The property list nests too deeply.',
    'The property list refers to itself.',
    'The property list holds an object type Viewer does not read.',
    'A property list key is missing.',
    'Malformed or unsupported XML.',
    'XML declarations and external entities are not supported.',
    'This XML nests deeper than Viewer reads.',
    'This XML has a part larger than Viewer reads.',
    'This XML has more elements than Viewer reads.',
    'The property list has no end, or is larger than 2 MB.',
    'Files over 1 MB show as text only.',
    'Files with over 100 YAML documents show as text only.',
    'XML this large shows as text only.',
  ],
  provision: [
    'The provisioning profile is larger than 4 MB.',
    'The property list is not a profile.',
    'This file holds no property list.',
  ],
  torrent: [
    'The torrent file is larger than 16 MB.',
    'The torrent holds too many values.',
    'The torrent nests too deeply.',
    'The torrent file is not valid bencode.',
    'This file has no torrent information.',
  ],
  keys: [
    'The armor is not base64.',
    'The OpenSSH key ends early.',
    'This is not an OpenSSH private key.',
    'The OpenSSH key holds no key.',
    'The OpenPGP data ends early.',
  ],
  table: [
    {
      example: 'Table processing took too long. Try again.',
      pattern:
        /^(?:Table processing|Mesh parsing) (?:stopped|returned unreadable data|has closed|took too long)\. Try again\.$/,
    },
    'This table exceeds the 4 MB text preview limit.',
    'Use a table filter shorter than 4096 characters.',
    'Choose CSV or tab-separated data.',
    'Open the table before filtering it.',
  ],
  sqlite: [
    'Databases inside archives and comparisons are not previewed.',
    'The database changed while Viewer read it. Try again.',
    'This table name cannot be read safely.',
    'This table is no longer in the database.',
    'Viewer does not run views. Their columns and definition are in Schema.',
    'Viewer could not open this database.',
  ],
  font: [
    fontLoadFailure,
    ...fontTableProblems,
    ...fontTableProblems.map((reason) => `${fontLoadFailure} ${reason}` as const),
    "Viewer couldn't read the font file.",
    'Viewer shows fonts up to 32 MB.',
  ],
  identify: [
    'Choose a regular file to identify.',
    'Add a model in Settings → Models.',
    'Select a model in Settings.',
    'Add this provider’s API key in Settings.',
    'The model response exceeded its limit.',
    'The model returned invalid JSON. No changes were applied.',
    'The model returned an invalid answer. Try again.',
    'Only a file on disk can be shown as another format.',
    'This preview file is no longer a regular file.',
  ],
  model: [
    {
      example: 'This VRML file exceeds the 128 MB preview limit.',
      pattern:
        /^This (?:Collada|VRML|X3D|3DS|USDZ) (?:scene (?:uses a node inside itself|is nested too deeply)|file exceeds the \d{1,3} MB preview limit)\.$/,
    },
    {
      example: 'This USDZ archive exceeds the preview limit.',
      pattern: /^This (?:3MF|USDZ) archive exceeds the preview limit\.$/,
    },
    {
      example: 'This OFF file is malformed at line 12.',
      pattern: /^This OFF file is malformed at line \d{1,9}\.$/,
    },
    {
      example: 'This X3D scene has an invalid coordIndex value.',
      pattern:
        /^This X3D scene has an invalid (?:point|color|index|coordIndex|translation|center|scale|scaleOrientation|rotation|diffuseColor|emissiveColor|specularColor|transparency|shininess|creaseAngle|whichChoice) value\.$/,
    },
    'This model uses a unit Viewer does not support.',
    'No geometry could be read from this CAD file.',
    'This CAD assembly has too many parts to preview.',
    'This CAD model exceeds the geometry limit for previews.',
    'This CAD file produced invalid geometry.',
    "The CAD converter couldn't load. Try again.",
    'The CAD converter stopped while reading this file. Try again.',
    'The CAD converter stopped.',
    'No renderable geometry was found in this model.',
    'This model has invalid texture dimensions.',
    'This model has invalid geometry indices.',
    'This OFF file ends before its last face.',
    'This file does not start with an OFF header.',
    'Binary OFF files are not supported.',
    'Only three-dimensional OFF files are supported.',
    'This 3MF file has an invalid model document.',
    'No model was found in this 3MF file.',
    'This 3MF contains models with different units. Export them with a shared unit to preview.',
    'This file is not a 3DS model.',
    'This 3DS file has a malformed chunk.',
    'This USDZ file is not a package.',
    'This USDZ package holds no USD layer.',
    'This USDZ package holds more than one USD layer; the preview reads one.',
    'Only VRML 2.0 files are supported.',
    'Collada files that declare entities are not supported.',
    'This Collada file is not valid XML.',
    'X3D files that declare entities are not supported.',
    'This file is not a valid X3D scene.',
    'This X3D scene is nested too deeply.',
    'The file ends before all of its model data can be read.',
    'No geometry could be read.',
    'This model has invalid geometry.',
    'This model exceeds the geometry limit for previews.',
    'This model exceeds the 128 MB decoded geometry limit.',
    'This model exceeds the 128 MB decoded texture limit.',
    'This CAD file exceeds the conversion limit (64 MB).',
    'This mesh exceeds the 128 MB parsing limit.',
    'This 3D format is not supported.',
    'CAD conversion took too long. Try a simpler model or reopen the file.',
    "This model loads files from the internet, which Viewer doesn't do. Put its textures next to the model file.",
    "Couldn't read this model file. Check that it's still there, then try again.",
  ],
  drawing: [
    {
      example:
        'Drawing text encoding DOS850 is not supported. Export a UTF-8 ASCII DXF (2007 or newer).',
      pattern:
        /^Drawing text encoding (?:windows-\d{1,5}|DOS\d{1,5}) is not supported\. Export a UTF-8 ASCII DXF \(2007 or newer\)\.$/i,
    },
    "Viewer couldn't draw this file.",
    'The drawing contains invalid or excessively large coordinates.',
    'Binary DXF is not supported yet. Export an ASCII DXF from your CAD app.',
    'This is not a complete ASCII DXF drawing.',
    'Viewer shows drawings up to 32 MB or 600,000 group codes.',
    'The DXF drawing could not be parsed.',
    "This drawing's blocks repeat too often to show.",
    'A block has an invalid transform.',
    'A block array is too large to show.',
    'A curve has an invalid center.',
    'A curve has invalid dimensions.',
    'A curve has invalid angles.',
    'An object has too many points to show.',
    'A polyline has invalid vertices.',
    'A polyline has too many points to show.',
    'Viewer shows drawings up to 50,000 objects or 1,000,000 points.',
    'Viewer shows drawings up to 32 MB.',
    "Viewer couldn't read this drawing.",
    'No supported model-space geometry was found.',
    'This drawing uses an unsupported text encoding. Export a UTF-8 ASCII DXF (2007 or newer).',
  ],
  layout: [
    'The Office renderer stopped. Retry the layout preview.',
    'The bundled Office renderer could not be opened.',
    'A bundled Office asset could not be read.',
    'Choose a Word, Excel or PowerPoint file for Office layout preview.',
    ...Object.values(layoutFailures),
    'Choose a supported Office document for layout preview.',
    'Choose a regular file for Office layout.',
    'Choose an Office layout preview.',
    'The Office renderer closed. Retry the layout preview.',
    'Office renderer could not start.',
    'The Office layout preview was canceled.',
    'Viewer is quitting.',
  ],
} as const;

type ReaderProblemDefinition = (typeof readerProblems)[keyof typeof readerProblems][number];
type ReaderSentence = Extract<ReaderProblemDefinition, string>;
const definitions: readonly ReaderProblemDefinition[] = Object.values(readerProblems).flat();
const readerMessages: ReadonlySet<string> = new Set(
  definitions.filter((item) => typeof item === 'string'),
);
const formattedMessages = definitions.flatMap((item) =>
  typeof item === 'string' ? [] : [item.pattern],
);

type FormattedReaderSentence = string & { readonly formattedReaderSentence: unique symbol };

export interface ReaderProblemFields {
  readerProblem?: ReaderSentence | FormattedReaderSentence;
}

export class ReaderRefusal extends Error {
  constructor(
    readonly readerProblem: ReaderSentence | FormattedReaderSentence,
    detail: string = readerProblem,
  ) {
    super(detail);
  }
}

export function restoreReaderError(
  message: string,
  fields: { readerProblem?: unknown; code?: unknown },
): Error {
  const error = new Error(message);
  if (typeof fields.code === 'string') Object.assign(error, { code: fields.code });
  if (registeredSentence(fields.readerProblem))
    Object.assign(error, { readerProblem: fields.readerProblem });
  return error;
}

/** Only a registered sentence can be carried by a worker or the desktop bridge. */
export function readerProblemFields(error: unknown): ReaderProblemFields {
  const reason = knownPreviewProblem(error);
  return registeredSentence(reason) ? { readerProblem: reason } : {};
}

function registeredSentence(value: unknown): value is ReaderSentence | FormattedReaderSentence {
  return (
    typeof value === 'string' &&
    (readerMessages.has(value) ||
      (value.length <= 256 &&
        !/[\r\n]/.test(value) &&
        formattedMessages.some((pattern) => pattern.test(value))))
  );
}

const damagedArchive = new Set([
  'ZIP directory was not found.',
  'Malformed ZIP directory.',
  'Truncated ZIP directory.',
  'ZIP directory count is invalid.',
  'Malformed ZIP local header.',
  'Truncated ZIP entry.',
  'Truncated ZIP compressed entry.',
  'Archive entry size does not match its index.',
  'ZIP entry checksum is invalid.',
  'Malformed TAR extended header.',
  'Malformed TAR entry size.',
  'TAR header checksum is invalid.',
]);

const damagedWorksheet = new Set([
  'Invalid worksheet cell address.',
  'Worksheet references a missing shared string.',
  'Invalid worksheet boolean.',
  'Invalid worksheet part.',
  'Invalid merged cell range.',
  'Invalid merged cell order.',
  'Overlapping merged cell ranges.',
  'Invalid or unordered worksheet row.',
  'Duplicate or unordered worksheet cell.',
  'Duplicate worksheet cell value.',
  'Duplicate worksheet formula.',
  'Duplicate worksheet inline value.',
  'Invalid or duplicate worksheet name.',
]);

/** Returns only a recognized explanation. Callers supply the action-specific fallback. */
export function knownPreviewProblem(error: unknown, extension?: string): string | undefined {
  const message = errorMessage(error);
  const layout =
    extension && officeLayoutRecovery((error as { code?: unknown } | null)?.code, extension);
  if (layout) return layout;
  const carried = (error as { readerProblem?: unknown } | null)?.readerProblem;
  if (registeredSentence(carried)) return carried;
  if (
    extension &&
    /^[a-z0-9]{1,16}$/.test(extension) &&
    (message === `The contents of this file do not match .${extension}.` ||
      message === `Show as cannot read a file as .${extension}.`)
  )
    return message;
  if (extension === 'stl' && message === 'Offset is outside the bounds of the DataView')
    return 'The file ends before all of its model data can be read.';

  const failure = error as {
    code?: string;
    name?: string;
    status?: number;
    missing?: boolean;
  } | null;
  const code = failure?.code;
  const name = failure?.name;
  const status = name === 'ResponseException' ? failure?.status : undefined;
  const response = status === undefined ? undefined : resourceStatusMessage(status);
  if (response) return response;
  if (
    needsFolderAccess(code) ||
    name === 'NotAllowedError' ||
    /^(?:EACCES\b|EPERM\b|permission denied\b|operation not permitted\b|access denied\b)/i.test(
      message,
    )
  )
    return resourceStatusMessages[403];
  if (
    code === 'ENOENT' ||
    name === 'NotFoundError' ||
    name === 'MissingPDFException' ||
    (name === 'ResponseException' && failure?.missing) ||
    /^(?:ENOENT\b|no such file or directory\b|file not found\b)/i.test(message)
  )
    return resourceStatusMessages[404];
  if (registeredSentence(message)) return message;
  if (
    name === 'PasswordException' ||
    /^(?:protected document|(?:incorrect|invalid) password|no password given|password required)\.?$/i.test(
      message,
    )
  )
    return 'The file is protected. Open it in its own app.';
  if (name === 'InvalidPDFException') return 'The PDF is damaged or incomplete.';
  if (
    /^A property list (?:offset|length|reference|integer|number|date|data value|string|UID|collection) is (?:out of range|malformed)\.$/.test(
      message,
    )
  )
    return 'The property list is damaged or incomplete.';
  if (message.startsWith('The property list holds an unknown element, <'))
    return 'The property list holds an element Viewer does not read.';
  if (message.startsWith('Missing, encrypted, or unsupported Office part:'))
    return 'A part of this Office document is missing, encrypted or unsupported.';
  if (message.startsWith('Unsupported 3MF unit:'))
    return 'This model uses a unit Viewer does not support.';
  if (damagedWorksheet.has(message)) return 'The worksheet is damaged or incomplete.';
  if (message === 'Malformed or encrypted ZIP local header.')
    return 'This archive entry is damaged or encrypted.';
  if (damagedArchive.has(message)) return 'The archive is damaged or incomplete.';
  if (
    /^(?:the |this )?(?:file|document|data) is (?:corrupt(?:ed)?|damaged|incomplete)\.?$/i.test(
      message,
    )
  )
    return 'The file is damaged or incomplete.';
  if (code === 'Z_DATA_ERROR' || /^Z_DATA_ERROR\b/.test(message))
    return 'The compressed data is damaged or incomplete.';
  if (/^(?:unexpected (?:end of (?:file|data|input)|EOF)|truncated (?:file|data))\b/i.test(message))
    return 'The file ends before all of its data can be read.';
  if (
    code === 'EFBIG' ||
    code === 'ERR_BUFFER_TOO_LARGE' ||
    /^(?:(?:(?:the |this )?(?:file|input|document|image|buffer|data) (?:is )?)?too large\b|(?:the |this )?(?:file|input|document|image|buffer|data) exceeds? [^\n]*(?:limit|budget)\b)/i.test(
      message,
    )
  )
    return resourceStatusMessages[413];
  if (
    name === 'NotSupportedError' ||
    /^(?:unsupported (?:file )?(?:format|type)|(?:file )?(?:format|type) (?:is )?not supported)\b/i.test(
      message,
    )
  )
    return 'Viewer does not support this file format.';
  if (
    name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    /^(?:(?:reading|loading|decoding|conversion|request|preview)(?: the file)? )?(?:timed out|took too long)\b/i.test(
      message,
    )
  )
    return 'Reading this file took too long.';
  return undefined;
}
