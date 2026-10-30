/** Names for a layout's output; the operations service makes a taken name free. */
import { transformExtension } from '../operations/transforms';
import type { LayoutFormat, LayoutTransform } from './plan';
import type { LayoutSettings, PlannedMode } from './settings';
import type { LayoutSource } from './sources';

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || name;
/** One file's name, or a count of them: "Report", "3 PDFs". */
function subject(sources: readonly LayoutSource[]): string {
  if (sources.length === 1) return stem(sources[0]!.name);
  const photos = sources.every((source) => source.kind === 'image');
  const documents = sources.every((source) => source.kind === 'pdf');
  return `${sources.length} ${photos ? 'photos' : documents ? 'PDFs' : 'files'}`;
}

export function layoutName(
  settings: LayoutSettings,
  mode: PlannedMode,
  sources: readonly LayoutSource[],
  perSheet?: number,
): string {
  const photos = sources.filter((source) => source.kind === 'image');
  const up = perSheet ? ` ${perSheet} up` : '';
  const name = (() => {
    switch (mode) {
      case 'collage':
        return photos.length === 1
          ? `Collage of ${stem(photos[0]!.name)}`
          : `Collage of ${photos.length} photos`;
      case 'contact-sheet':
        return `Contact sheet of ${subject(sources)}`;
      case 'n-up':
        return `${subject(sources)}${up}`;
      case 'booklet':
        return `Booklet of ${subject(sources)}`;
      case 'poster':
        return `Poster of ${subject(sources)}`;
      case 'step-repeat': {
        const item = settings['step-repeat'].item;
        if (item.startsWith('business-card')) return `Cards${up}`;
        if (item.startsWith('passport')) return `Passport photos${up}`;
        if (item.startsWith('label')) return `Labels${up}`;
        if (item.startsWith('photo')) return `Prints of ${subject(sources)}`;
        return `${subject(sources)}${up}`;
      }
    }
  })();
  // a name is one path component
  return name
    .replace(/[/\\:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
/** The output name without the extension a person may have typed. */
const outputStem = (name: string) => name.trim().replace(/\.(?:pdf|png|jpe?g)$/i, '');
export const layoutFileName = (name: string, format: LayoutFormat) =>
  outputStem(name) + '.' + transformExtension(format);
/** The plan as saved under `name`: a PDF is titled with the name the person chose, which a PDF
 * reader shows in place of its file name. */
export function titledPlan(plan: LayoutTransform, name: string): LayoutTransform {
  const title = outputStem(name).slice(0, 200);
  return plan.format === 'pdf' && title ? { ...plan, title } : plan;
}
