import type { DocumentData } from '../../domain/services';
import type { SavedPage } from '../../domain/previews/saved-page';
import { savedPageFormats } from '../../domain/previews/saved-page';
import {
  webArchiveLimits,
  webArchivePage,
  webArchiveSummary,
} from '../../domain/previews/documents/web-archive';
import { fileCoordination } from '../files/file-coordination';
import { documentBytes } from './formats';
import { mailPage } from './mail';

/** A saved web page's address and title, and its text for search. Caller must hold a read
 * coordination claim for this file. */
export async function extractWebArchive(file: string): Promise<DocumentData> {
  const summary = webArchiveSummary(await documentBytes(file, webArchiveLimits.bytes));
  const { text, ...webArchive } = summary;
  const metadata: Record<string, string> = {};
  if (webArchive.title) metadata.title = webArchive.title;
  if (webArchive.url) metadata.url = webArchive.url;
  return {
    path: file,
    metadata,
    evidence: [{ source: 'page', text }],
    text: '[page]\n' + text,
    webArchive,
    truncated: false,
  };
}

/** The page an email or web archive shows, with the parts it loads, read under a coordination
 * claim. `message` chooses one message of a mailbox. */
export function readSavedPage(
  file: string,
  format: string,
  message: number | undefined,
  signal?: AbortSignal,
): Promise<SavedPage> {
  if (!savedPageFormats.includes(format))
    return Promise.reject(new Error(`A .${format} file has no saved page.`));
  return fileCoordination.run(
    [{ path: file, mode: 'read' }],
    async () => {
      signal?.throwIfAborted();
      const page =
        format === 'webarchive'
          ? webArchivePage(await documentBytes(file, webArchiveLimits.bytes))
          : await mailPage(file, format, message, signal);
      signal?.throwIfAborted();
      return page;
    },
    signal,
  );
}
