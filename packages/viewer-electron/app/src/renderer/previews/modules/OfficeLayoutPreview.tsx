import type { PreviewContext } from '../contracts';
import { useOfficeLayout } from '../useOfficeLayout';
import { usePreviewState } from '../state';
import { WorksheetTabs } from '../WorksheetTabs';
import { Empty, Loading } from '../../ui/primitives';
import PDFPreview from './PDFPreview';

export default function OfficeLayoutPreview(context: PreviewContext) {
  const [sheet, setSheet] = usePreviewState(context, 'office.sheet', '');
  const workbook = ['xls', 'xlsx'].includes(context.resource.entry.extension);
  const load = useOfficeLayout(context, workbook ? sheet : undefined);
  const selected = sheet || load.metadata?.selectedSheet || '';
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
      ) : load.resource ? (
        <PDFPreview
          {...context}
          resource={load.resource}
          signal={load.signal}
          optimize={undefined}
          editPDF={undefined}
        />
      ) : (
        <Loading label={context.active ? 'Rendering Office layout…' : 'Layout paused'} />
      )}
    </div>
  );
}
