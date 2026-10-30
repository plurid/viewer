import type { PreviewContext } from '../contracts';
import { HexView } from '../HexView';

/** Any file's bytes, shown in place of its preview with Show as hex. */
export default function HexPreview(context: PreviewContext) {
  return <HexView context={context} />;
}
