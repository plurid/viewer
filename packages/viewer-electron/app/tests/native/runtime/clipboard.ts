import { spawn } from 'node:child_process';

/** Restore a captured pasteboard through stdin; private clipboard data never becomes a file or argv. */
export function restoreClipboard(snapshot: string, expectedText: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        `
        ObjC.import('AppKit');
        ObjC.import('Foundation');
        const bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
        const text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding));
        const request = JSON.parse(text);
        const board = $.NSPasteboard.generalPasteboard;
        if (ObjC.unwrap(board.stringForType('public.utf8-plain-text')) === request.expectedText) {
          const items = $.NSMutableArray.alloc.init;
          for (const fields of request.items) {
            const item = $.NSPasteboardItem.alloc.init;
            for (const [type, encoded] of fields)
              item.setDataForType($.NSData.alloc.initWithBase64EncodedStringOptions(encoded, 0), type);
            items.addObject(item);
          }
          board.clearContents;
          if (request.items.length && !board.writeObjects(items))
            throw new Error('Clipboard restoration failed.');
        }
        `,
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Clipboard restoration timed out.'));
    }, 10_000);
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new Error('Could not start clipboard restoration.'));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error('Could not restore the test clipboard.'));
    });
    child.stdin.on('error', () => {
      child.kill('SIGTERM');
      reject(new Error('Could not send the private clipboard snapshot for restoration.'));
    });
    child.stdin.end(JSON.stringify({ items: JSON.parse(snapshot), expectedText }));
  });
}
