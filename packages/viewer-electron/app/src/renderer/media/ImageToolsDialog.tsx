import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileEntry, ViewerAPI } from '../../domain/contracts';
import { imagePresetPlan } from '../../domain/operations/export-presets';
import type { ImageExportPreset } from '../../domain/operations/export-presets';
import { imageTransformSchema, transformExtension } from '../../domain/operations/transforms';
import type { ImageTransform } from '../../domain/operations/transforms';
import { sourceVersion } from '../../domain/files/inspection';
import { baseName } from '../../domain/workspaces/planes';
import { Dialog, Failure, Loading } from '../ui/primitives';
import { plural } from '../../domain/plural';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { DestinationField } from '../ui/DestinationField';
import { FileNameField, fileNameError } from '../ui/FileNameField';
import { FormField } from '../ui/FormField';
import { NumberField } from '../ui/NumberField';
import { useHomeText } from '../ui/PathLabel';
import { measureLocalPoint } from '../ui/projectedResize';
import type { Point } from '../ui/projectedResize';
import { report, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import './image-tools.css';
import { isActiveJob } from '../../domain/operations/jobs';
import { errorMessage } from '../../domain/errors';

type CropGesture =
  | {
      local(point: Point): Point | undefined;
      start: Point;
      before?: ImageTransform['crop'];
    }
  | undefined;

function exportDimensions(width: number, height: number, plan: ImageTransform) {
  const sourceWidth = plan.crop?.width ?? width;
  const sourceHeight = plan.crop?.height ?? height;
  let scaleX = plan.width ? plan.width / sourceWidth : 1;
  let scaleY = plan.height ? plan.height / sourceHeight : 1;
  if (plan.fit !== 'fill') {
    const scale =
      plan.width && plan.height
        ? plan.fit === 'cover'
          ? Math.max(scaleX, scaleY)
          : Math.min(scaleX, scaleY)
        : plan.width
          ? scaleX
          : scaleY;
    scaleX = scale;
    scaleY = scale;
  }
  const resizedWidth = Math.max(1, Math.round(sourceWidth * Math.min(1, scaleX)));
  const resizedHeight = Math.max(1, Math.round(sourceHeight * Math.min(1, scaleY)));
  const outputWidth =
    plan.fit === 'cover' && plan.width ? Math.min(plan.width, resizedWidth) : resizedWidth;
  const outputHeight =
    plan.fit === 'cover' && plan.height ? Math.min(plan.height, resizedHeight) : resizedHeight;
  return {
    width: outputWidth,
    height: outputHeight,
    keepsSize:
      (scaleX > 1 || scaleY > 1) && outputWidth === sourceWidth && outputHeight === sourceHeight,
  };
}

export function ImageToolsDialog({
  files,
  paneID,
  onClose,
  initial,
}: {
  files: FileEntry[];
  paneID?: string;
  onClose(): void;
  initial?: ImageExportPreset;
}) {
  const workspace = useWorkspace();
  const [plan, setPlan] = useState(() => imagePresetPlan(initial));
  const [inspection, setInspection] = useState<Awaited<ReturnType<ViewerAPI['imageInspect']>>>();
  const [decoded, setDecoded] = useState<HTMLImageElement>(),
    [previewError, setPreviewError] = useState(''),
    [previewAttempt, setPreviewAttempt] = useState(0);
  const [folder, setFolder] = useState(files[0]!.parent),
    [name, setName] = useState(baseName(files[0]!.path).replace(/\.[^.]+$/, '') + ' converted');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [cropMode, setCropMode] = useState(false),
    [jobID, setJobID] = useState<string>();
  const preview = useRef<HTMLDivElement>(null),
    imageBox = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [bounds, setBounds] = useState({ width: 640, height: 420 });
  const drag = useRef<CropGesture>(undefined);
  const extension = transformExtension(plan.format);
  const nameError = fileNameError(name, extension);
  const job = useViewer((state) => state.jobs.find((job) => job.id === jobID));
  const working = busy || (!!job && isActiveJob(job));
  useEffect(() => {
    let live = true,
      resource: string | undefined;
    setInspection(undefined);
    setPreviewError('');
    void window.viewer
      .imageInspect(files[0]!.path)
      .then((value) => {
        if (!live) {
          void window.viewer.release(value.preview.id);
          return;
        }
        resource = value.preview.id;
        setInspection(value);
      })
      .catch((error) => {
        if (live) setPreviewError(String(error.message || error));
      });
    const off = window.viewer.onEvent((event) => {
      if (
        event.type === 'file-access' &&
        files.some(
          (file) =>
            file.path === event.path || file.path.startsWith(event.path.replace(/\/$/, '') + '/'),
        )
      ) {
        setInspection(undefined);
        setPreviewError('File access changed. Try again to check the image.');
        if (resource) void window.viewer.release(resource).catch(() => {});
      }
    });
    return () => {
      live = false;
      off();
      if (resource) void window.viewer.release(resource).catch(() => {});
    };
  }, [files, previewAttempt]);
  useEffect(() => {
    if (!preview.current) return;
    const observer = new ResizeObserver(() =>
      setBounds({ width: preview.current!.clientWidth, height: preview.current!.clientHeight }),
    );
    observer.observe(preview.current);
    return () => observer.disconnect();
  }, []);
  const swapped = plan.rotate === 90 || plan.rotate === 270;
  const width = inspection ? (swapped ? inspection.height : inspection.width) : 1,
    height = inspection ? (swapped ? inspection.width : inspection.height) : 1;
  const scale = Math.max(
    0.001,
    Math.min((bounds.width - 36) / width, (bounds.height - 36) / height),
  );
  useEffect(() => {
    setDecoded(undefined);
    if (!inspection) return;
    const image = new Image();
    let live = true;
    const timer = setTimeout(() => {
      if (live) setPreviewError('The image preview is taking longer than expected.');
    }, 15000);
    image.onload = () => {
      if (!live) return;
      clearTimeout(timer);
      setPreviewError('');
      setDecoded(image);
    };
    image.onerror = () => {
      if (!live) return;
      clearTimeout(timer);
      setPreviewError("Viewer couldn't read this image.");
    };
    image.src = inspection.preview.url;
    return () => {
      live = false;
      clearTimeout(timer);
      image.src = '';
    };
  }, [inspection]);
  useLayoutEffect(() => {
    if (!decoded || !canvas.current) return;
    const element = canvas.current;
    const paint = () => {
      element.width = swapped ? decoded.naturalHeight : decoded.naturalWidth;
      element.height = swapped ? decoded.naturalWidth : decoded.naturalHeight;
      const context = element.getContext('2d');
      if (!context) {
        setPreviewError("Viewer couldn't draw the preview.");
        return;
      }
      context.translate(element.width / 2, element.height / 2);
      context.rotate((plan.rotate * Math.PI) / 180);
      context.drawImage(decoded, -decoded.naturalWidth / 2, -decoded.naturalHeight / 2);
    };
    paint();
    const appearance = new MutationObserver(paint);
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-look'],
    });
    return () => appearance.disconnect();
  }, [decoded, plan.rotate, swapped, bounds.width, bounds.height]);
  const exportImages = async () => {
    setBusy(true);
    setError('');
    try {
      const normalized = imageTransformSchema.parse(plan);
      const extension = transformExtension(normalized.format);
      const filename = name + '.' + extension;
      const id = await window.viewer.operate({
        kind: 'convert',
        sources: files.map((file) => file.path),
        destination: folder,
        ...(files.length === 1 ? { name: filename } : {}),
        transform: normalized,
        expectedSources: files.map((file) => ({ path: file.path, version: sourceVersion(file) })),
      });
      setJobID(id);
    } catch (error) {
      setError(String(errorMessage(error) || error));
    } finally {
      setBusy(false);
    }
  };
  const crop = plan.crop;
  const output = inspection ? exportDimensions(width, height, plan) : undefined;
  const shownError = useHomeText(error);
  const status = useHomeText(job ? `${job.status}${job.detail ? ' · ' + job.detail : ''}` : '');
  return (
    <Dialog
      title={
        files.length === 1
          ? `Image Tools · ${files[0]!.name}`
          : `Image Tools · ${plural(files.length, 'image')}`
      }
      onClose={onClose}
      wide
      className="image-tools-dialog"
    >
      <div className="image-tools-body">
        <div className="image-tools-preview" ref={preview}>
          {previewError ? (
            <Failure
              title="Can't show the image preview"
              detail={previewError}
              onRetry={() => setPreviewAttempt((value) => value + 1)}
            />
          ) : !inspection || !decoded ? (
            <Loading label="Reading image…" />
          ) : (
            <div
              ref={imageBox}
              className={`image-tools-canvas ${cropMode ? 'is-cropping' : ''}`}
              style={{ width: width * scale, height: height * scale }}
              onPointerDown={(event) => {
                if (!cropMode || event.button !== 0) return;
                event.preventDefault();
                const local = measureLocalPoint(event.currentTarget),
                  start = local({ x: event.clientX, y: event.clientY });
                if (!start) return;
                drag.current = { local, start, before: crop };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const gesture = drag.current;
                if (!gesture) return;
                const current = gesture.local({ x: event.clientX, y: event.clientY });
                if (!current) return;
                const clamp = (value: number, maximum: number) =>
                  Math.max(0, Math.min(maximum, Math.round(value / scale)));
                const left = clamp(Math.min(gesture.start.x, current.x), width),
                  right = clamp(Math.max(gesture.start.x, current.x), width);
                const top = clamp(Math.min(gesture.start.y, current.y), height),
                  bottom = clamp(Math.max(gesture.start.y, current.y), height);
                const x = left,
                  y = top,
                  cropWidth = right - left,
                  cropHeight = bottom - top;
                if (cropWidth > 0 && cropHeight > 0)
                  setPlan((plan) => ({
                    ...plan,
                    crop: { x, y, width: cropWidth, height: cropHeight },
                  }));
              }}
              onPointerUp={() => {
                drag.current = undefined;
              }}
              onPointerCancel={() => {
                const before = drag.current?.before;
                drag.current = undefined;
                setPlan((plan) => ({ ...plan, crop: before }));
              }}
            >
              <canvas ref={canvas} aria-label="Source image and crop" />
              {crop && (
                <div
                  className="image-tools-crop"
                  style={{
                    left: (crop.x / width) * 100 + '%',
                    top: (crop.y / height) * 100 + '%',
                    width: (crop.width / width) * 100 + '%',
                    height: (crop.height / height) * 100 + '%',
                  }}
                />
              )}
            </div>
          )}
        </div>
        <div className="image-tools-options dialog-form">
          <FormField label="Format">
            <ChoiceButton
              label="Image output format"
              value={plan.format}
              choices={[
                { value: 'webp', label: 'WebP' },
                { value: 'avif', label: 'AVIF' },
                { value: 'jpeg', label: 'JPEG' },
                { value: 'png', label: 'PNG' },
              ]}
              onChoose={(format) =>
                setPlan((plan) => ({ ...plan, format: format as ImageTransform['format'] }))
              }
            />
          </FormField>
          {plan.format !== 'png' && (
            <FormField label={`Quality · ${plan.quality}`}>
              <input
                aria-label="Image quality"
                type="range"
                min={1}
                max={100}
                value={plan.quality}
                onChange={(event) =>
                  setPlan((plan) => ({ ...plan, quality: Number(event.target.value) }))
                }
              />
            </FormField>
          )}
          <div className="image-size-controls">
            {inspection && (
              <p className="muted">
                {files.length > 1 ? 'First image: ' : ''}
                {inspection.width} × {inspection.height} px{inspection.alpha ? ', transparent' : ''}
              </p>
            )}
            <div className="image-tools-dimensions">
              <FormField label="Width">
                <NumberField
                  aria-label="Output width"
                  empty
                  min={1}
                  max={32768}
                  placeholder="Original"
                  value={plan.width}
                  onCommit={(width) => setPlan((plan) => ({ ...plan, width }))}
                />
              </FormField>
              <FormField label="Height">
                <NumberField
                  aria-label="Output height"
                  empty
                  min={1}
                  max={32768}
                  placeholder="Original"
                  value={plan.height}
                  onCommit={(height) => setPlan((plan) => ({ ...plan, height }))}
                />
              </FormField>
            </div>
            {output && (
              <>
                <p role="status">
                  {files.length > 1 ? 'First image exports' : 'Exports'} {output.width} ×{' '}
                  {output.height} px {plan.format === 'webp' ? 'WebP' : plan.format.toUpperCase()}
                </p>
                {output.keepsSize && (
                  <p className="muted">
                    Already smaller than the target; keeps {output.width} × {output.height}.
                  </p>
                )}
              </>
            )}
          </div>
          <FormField label="Resize">
            <ChoiceButton
              label="Image resize fit"
              value={plan.fit}
              choices={[
                { value: 'inside', label: 'Fit · keep aspect ratio' },
                { value: 'cover', label: 'Fill and crop' },
                { value: 'fill', label: 'Stretch to size' },
              ]}
              onChoose={(fit) =>
                setPlan((plan) => ({ ...plan, fit: fit as ImageTransform['fit'] }))
              }
            />
          </FormField>
          <div className="image-tools-crop-actions">
            <button
              aria-pressed={cropMode}
              disabled={!inspection}
              onClick={() => {
                setCropMode((value) => !value);
                if (!crop && !cropMode)
                  setPlan((plan) => ({ ...plan, crop: { x: 0, y: 0, width, height } }));
              }}
            >
              Crop
            </button>
            <button
              disabled={!crop}
              onClick={() => {
                setCropMode(false);
                setPlan((plan) => ({ ...plan, crop: undefined }));
              }}
            >
              Reset Crop
            </button>
            <button
              onClick={() =>
                setPlan((plan) => ({
                  ...plan,
                  rotate: ((plan.rotate + 90) % 360) as ImageTransform['rotate'],
                  crop: undefined,
                }))
              }
            >
              Rotate
            </button>
          </div>
          {crop && files.length > 1 && <p className="muted">The crop applies to every image.</p>}
          {crop && (
            <div className="image-tools-dimensions">
              {(['x', 'y', 'width', 'height'] as const).map((field) => (
                <FormField key={field} label={'Crop ' + field}>
                  <NumberField
                    aria-label={'Crop ' + field}
                    min={field === 'x' || field === 'y' ? 0 : 1}
                    max={
                      field === 'x'
                        ? width - crop.width
                        : field === 'y'
                          ? height - crop.height
                          : field === 'width'
                            ? width - crop.x
                            : height - crop.y
                    }
                    value={crop[field]}
                    onCommit={(value) =>
                      setPlan((plan) => ({ ...plan, crop: { ...crop, [field]: value } }))
                    }
                  />
                </FormField>
              ))}
            </div>
          )}
          <FormField label="Metadata">
            <ChoiceButton
              label="Image metadata policy"
              value={plan.metadata}
              choices={[
                { value: 'safe', label: 'Keep color and credit · remove GPS' },
                { value: 'strip', label: 'Remove metadata' },
                { value: 'all', label: 'Keep all · includes location' },
              ]}
              onChoose={(metadata) =>
                setPlan((plan) => ({ ...plan, metadata: metadata as ImageTransform['metadata'] }))
              }
            />
          </FormField>
          {plan.format === 'jpeg' && (
            <FormField label="Transparency background">
              <input
                type="color"
                aria-label="JPEG background color"
                value={plan.background}
                onChange={(event) =>
                  setPlan((plan) => ({ ...plan, background: event.target.value }))
                }
              />
            </FormField>
          )}
          {files.length === 1 && (
            <FileNameField
              value={name}
              extension={extension}
              onChange={setName}
              folder={folder}
              disabled={working}
            />
          )}
          <DestinationField path={folder} onChange={setFolder} disabled={working} />
        </div>
      </div>
      {error && (
        <p className="dialog-error" role="alert">
          {shownError}
        </p>
      )}
      <footer>
        <span className="muted">{job ? status : 'Originals are kept.'}</span>
        <span className="toolbar-spacer" />
        {job?.completed[0]?.destination && (
          <button
            onClick={() =>
              void workspace
                .openPath(job.completed[0]!.destination!, {
                  paneID,
                  linked: !!paneID,
                  activate: true,
                })
                .then(onClose)
                .catch(report)
            }
          >
            Open Result
          </button>
        )}
        <button onClick={onClose}>Close</button>
        {job && isActiveJob(job) && (
          <button onClick={() => void window.viewer.cancelJob(job.id).catch(report)}>
            Cancel Export
          </button>
        )}
        <button
          className="primary"
          disabled={
            working ||
            !inspection ||
            !!previewError ||
            !folder.trim() ||
            (files.length === 1 && !!nameError)
          }
          onClick={() => void exportImages()}
        >
          {busy
            ? 'Preparing…'
            : `Export ${files.length === 1 ? 'Image' : `${files.length.toLocaleString('en-US')} Images`}`}
        </button>
      </footer>
    </Dialog>
  );
}
