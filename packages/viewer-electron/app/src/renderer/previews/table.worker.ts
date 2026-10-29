import {
  delimitedPreview,
  tableMatches,
  tableSearchIndex,
  type DelimitedPreview,
} from './table-data';
import { errorMessage } from '../../domain/errors';

let parsed: DelimitedPreview | undefined;
let index: string[][] | undefined;
self.onmessage = (
  event: MessageEvent<{
    id: number;
    action: 'parse' | 'filter';
    text?: string;
    delimiter?: string;
    query?: string;
  }>,
) => {
  const request = event.data;
  try {
    if (request.action === 'parse') {
      parsed = delimitedPreview(request.text!, request.delimiter!);
      index = undefined;
      self.postMessage({ id: request.id, value: parsed });
    } else {
      if (!parsed) throw new Error('Open the table before filtering it.');
      index ??= tableSearchIndex(parsed.rows);
      const value = tableMatches(index, request.query!);
      self.postMessage({ id: request.id, value }, { transfer: [value.buffer] });
    }
  } catch (error) {
    self.postMessage({ id: request.id, error: errorMessage(error) });
  }
};
