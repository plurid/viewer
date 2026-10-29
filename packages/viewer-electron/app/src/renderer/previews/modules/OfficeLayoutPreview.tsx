import { useCallback, useEffect, useState } from 'react';
import type { PreviewContext } from '../contracts';
import { useOfficeLayout } from '../useOfficeLayout';
import { usePreviewState } from '../state';
import { WorksheetTabs } from '../WorksheetTabs';
import { FirstPagePicture, useFirstPagePicture } from '../FirstPagePicture';
import { Empty, Loading } from '../../ui/primitives';
import PDFPreview from './PDFPreview';
import { officeFamily } from '../../../domain/previews/documents/layout';

/** How long a layout may take to paint its first page before it shows over the picture. */
const pictureHold = 1000;

export default function OfficeLayoutPreview(context: PreviewContext) {
  const [sheet, setSheet] = usePreviewState(context, 'office.sheet', '');
  const workbook = officeFamily(context.resource.entry.extension) === 'workbook';
  const load = useOfficeLayout(context, workbook ? sheet : undefined);
  const selected = sheet || load.metadata?.selectedSheet || '';
  // The document's own picture of its first page stands in until the layout has painted that
  // page; a view that reopens on another page or worksheet waits for the layout.
  const [painted, setPainted] = useState(false);
  const firstPage = !sheet && (Number(context.state?.get('pdf.page')) || 1) === 1;
  const picture = useFirstPagePicture(context, !painted && firstPage);
  const paint = useCallback(() => setPainted(true), []);
  const laidOut = load.resource?.id;
  useEffect(() => {
    if (!laidOut || painted) return;
    // a layout PDF.js refuses or cannot paint shows its own state
    const timer = setTimeout(() => setPainted(true), pictureHold);
    return () => clearTimeout(timer);
  }, [laidOut, painted]);
  const progress = context.active ? 'Rendering Office layout…' : 'Layout paused';
  return (
    <div className="office-viewer" data-office-layout>
      {workbook && !!load.metadata?.sheets.length && (
        <WorksheetTabs sheets={load.metadata.sheets} value={selected} choose={setSheet} />
      )}
      {load.metadata?.limited && (
        <p className="inline-warning">The first 256 worksheets are listed.</p>
      )}
      {load.error ? (
        <Empty icon="file" title="Office layout unavailable" detail={load.error}>
          <button onClick={load.retry}>Try again</button>
          {workbook && (
            <button
              onClick={() => {
                setSheet('');
                load.retry();
              }}
            >
              First worksheet
            </button>
          )}
        </Empty>
      ) : (
        <div className="office-layout-stage">
          {load.resource && (
            <PDFPreview
              {...context}
              resource={load.resource}
              signal={load.signal}
              optimize={undefined}
              editPDF={undefined}
              onPaint={paint}
            />
          )}
          {picture ? (
            <FirstPagePicture picture={picture} state={context.state} label={progress} />
          ) : (
            !load.resource && <Loading label={progress} />
          )}
        </div>
      )}
    </div>
  );
}
