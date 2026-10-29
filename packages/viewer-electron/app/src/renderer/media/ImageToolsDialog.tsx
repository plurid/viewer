import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileEntry, ViewerAPI } from '../../domain/contracts';
import { imagePresetPlan, type ImageExportPreset } from '../../domain/operations/export-presets';
import {
  imageTransformSchema,
  transformExtension,
  type ImageTransform,
} from '../../domain/operations/transforms';
import { sourceVersion } from '../../domain/files/inspection';
import { baseName } from '../../domain/workspaces/planes';
import { Dialog, Empty, Loading } from '../ui/primitives';
import { ChoiceButton } from '../ui/ChoiceMenu';
import { measureLocalPoint, type Point } from '../ui/projectedResize';
import { report, useViewer } from '../state/store';
import { useWorkspace } from '../workspace/context';
import './image-tools.css';
import { isActiveJob } from '../../domain/operations/jobs';

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
    [name, setName] = useState(
      baseName(files[0]!.path).replace(/\.[^.]+$/, '') + ' converted.webp',
    );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [cropMode, setCropMode] = useState(false),
    [jobID, setJobID] = useState<string>();
  const preview = useRef<HTMLDivElement>(null),
    imageBox = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [bounds, setBounds] = useState({ width: 640, height: 420 });
  const drag = useRef<
    | { local(point: Point): Point | undefined; start: Point; before?: ImageTransform['crop'] }
    | undefined
  >(undefined);
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
        setPreviewError('File access changed. Retry to check the source.');
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
      setPreviewError('The source image preview could not be decoded.');
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
        setPreviewError('The image drawing surface is unavailable.');
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
      const filename = name.replace(/\.[^.]+$/, '') + '.' + extension;
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
      setError(String((error as Error).message || error));
    } finally {
      setBusy(false);
    }
  };
  const crop = plan.crop;
  return (
    <Dialog
      title={
        files.length === 1
          ? `Image tools · ${files[0]!.name}`
          : `Image tools · ${files.length} images`
      }
      onClose={onClose}
      wide
      className="image-tools-dialog"
    >
      <div className="image-tools-body">
        <div className="image-tools-preview" ref={preview}>
          {previewError ? (
            <Empty icon="warning" title="Image preview unavailable" detail={previewError}>
              <button onClick={() => setPreviewAttempt((value) => value + 1)}>
                Retry image preview
              </button>
            </Empty>
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
        <div className="image-tools-options">
          <label>
            Format
            <ChoiceButton
              label="Image output format"
              value={plan.format}
              choices={[
                { value: 'webp', label: 'WebP' },
                { value: 'avif', label: 'AVIF' },
                { value: 'jpeg', label: 'JPEG' },
                { value: 'png', label: 'PNG' },
              ]}
              onChoose={(format) => {
                setPlan((plan) => ({ ...plan, format: format as ImageTransform['format'] }));
                setName(
                  name.replace(/\.[^.]+$/, '') +
                    '.' +
                    transformExtension(format as ImageTransform['format']),
                );
              }}
            />
          </label>
          {plan.format !== 'png' && (
            <label>
              Quality · {plan.quality}
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
            </label>
          )}
          <div className="image-tools-dimensions">
            <label>
              Width
              <input
                aria-label="Output width"
                type="number"
                min={1}
                max={32768}
                placeholder="Original"
                value={plan.width ?? ''}
                onChange={(event) =>
                  setPlan((plan) => ({ ...plan, width: Number(event.target.value) || undefined }))
                }
              />
            </label>
            <label>
              Height
              <input
                aria-label="Output height"
                type="number"
                min={1}
                max={32768}
                placeholder="Original"
                value={plan.height ?? ''}
                onChange={(event) =>
                  setPlan((plan) => ({ ...plan, height: Number(event.target.value) || undefined }))
                }
              />
            </label>
          </div>
          <label>
            Resize
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
          </label>
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
              Reset crop
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
          {crop && (
            <p className="muted">
              Crop {crop.width} × {crop.height} at {crop.x}, {crop.y}
              {files.length > 1 ? ' · applied to every image' : ''}
            </p>
          )}
          {crop && (
            <div className="image-tools-dimensions">
              {(['x', 'y', 'width', 'height'] as const).map((field) => (
                <label key={field}>
                  Crop {field}
                  <input
                    aria-label={'Crop ' + field}
                    type="number"
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
                    onChange={(event) => {
                      const maximum =
                        field === 'x'
                          ? width - crop.width
                          : field === 'y'
                            ? height - crop.height
                            : field === 'width'
                              ? width - crop.x
                              : height - crop.y;
                      const value = Math.max(
                        field === 'x' || field === 'y' ? 0 : 1,
                        Math.min(maximum, Number(event.target.value) || 0),
                      );
                      setPlan((plan) => ({ ...plan, crop: { ...crop, [field]: value } }));
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <label>
            Metadata
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
          </label>
          {plan.format === 'jpeg' && (
            <label>
              Transparency background
              <input
                type="color"
                aria-label="JPEG background color"
                value={plan.background}
                onChange={(event) =>
                  setPlan((plan) => ({ ...plan, background: event.target.value }))
                }
              />
            </label>
          )}
          {files.length === 1 && (
            <label>
              Filename
              <input
                aria-label="Image output filename"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <label>
            Save in
            <div className="media-destination">
              <input
                aria-label="Image output folder"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
              />
              <button
                onClick={() =>
                  void window.viewer
                    .chooseFolder(folder)
                    .then((value) => {
                      if (value) setFolder(value);
                    })
                    .catch(report)
                }
              >
                Choose…
              </button>
            </div>
          </label>
          {inspection && (
            <p className="muted">
              Source {inspection.width} × {inspection.height}
              {inspection.alpha ? ' · transparency' : ''}. Orientation is normalized. Smaller images
              keep their original size.
            </p>
          )}
        </div>
      </div>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <span className="muted">
          {job
            ? `${job.status}${job.detail ? ' · ' + job.detail : ''}`
            : 'Creates new files. Your originals are kept.'}
        </span>
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
            Open result
          </button>
        )}
        <button onClick={onClose}>Close</button>
        {job && isActiveJob(job) && (
          <button onClick={() => void window.viewer.cancelJob(job.id).catch(report)}>
            Cancel export
          </button>
        )}
        <button
          className="primary"
          disabled={
            working ||
            !inspection ||
            !!previewError ||
            !folder.trim() ||
            (files.length === 1 && !name.trim())
          }
          onClick={() => void exportImages()}
        >
          {busy
            ? 'Preparing…'
            : `Export ${files.length === 1 ? 'image' : `${files.length} images`}`}
        </button>
      </footer>
    </Dialog>
  );
}
