import { boundedText } from './text';

export const viewerErrorCodes = [
  'FILE_ACCESS_REQUIRED',
  'MODEL_DATA_PERMISSION_REQUIRED',
  'VIEWER_NO_TRASH',
  'STATE_RETAINED',
  'FOLDER_HISTORY_REFRESH',
  'PERSISTENCE_FAILED',
  'PERSISTENCE_TIMEOUT',
  'PERSISTENCE_SEND_FAILED',
  'PERSISTENCE_WINDOW_CLOSED',
  'TEST_REMOVAL_BLOCKED',
] as const;

// Prefix matching would let a private value disguised as an ERR_* code cross the boundary.
export const nodeErrorCodes = [
  'ERR_ASSERTION',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_ARG_VALUE',
  'ERR_INVALID_RETURN_VALUE',
  'ERR_OUT_OF_RANGE',
  'ERR_MISSING_ARGS',
  'ERR_BUFFER_TOO_LARGE',
  'ERR_STRING_TOO_LONG',
  'ERR_ENCODING_INVALID_ENCODED_DATA',
  'ERR_UNKNOWN_ENCODING',
  'ERR_INVALID_URL',
  'ERR_INVALID_URL_SCHEME',
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_UNSUPPORTED_DIR_IMPORT',
  'ERR_REQUIRE_ESM',
  'ERR_REQUIRE_ASYNC_MODULE',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'ERR_PACKAGE_IMPORT_NOT_DEFINED',
  'ERR_METHOD_NOT_IMPLEMENTED',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_STREAM_WRITE_AFTER_END',
  'ERR_STREAM_NULL_VALUES',
  'ERR_STREAM_CANNOT_PIPE',
  'ERR_STREAM_PUSH_AFTER_EOF',
  'ERR_STREAM_UNSHIFT_AFTER_END_EVENT',
  'ERR_WORKER_NOT_RUNNING',
  'ERR_WORKER_OUT_OF_MEMORY',
  'ERR_WORKER_UNSUPPORTED_OPERATION',
  'ERR_SOCKET_CLOSED',
  'ERR_SOCKET_CLOSED_BEFORE_CONNECTION',
  'ERR_SOCKET_BAD_PORT',
  'ERR_IPC_CHANNEL_CLOSED',
  'ERR_IPC_DISCONNECTED',
  'ERR_MISSING_PASSPHRASE',
  'ERR_OSSL_BAD_DECRYPT',
  'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE',
  'ERR_CRYPTO_INVALID_KEYLEN',
  'ERR_CRYPTO_OPERATION_FAILED',
  'ERR_HTTP_HEADERS_SENT',
  'ERR_HTTP_INVALID_HEADER_VALUE',
  'ERR_INVALID_HTTP_TOKEN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
] as const;

const knownCodes = new Set<string>([...viewerErrorCodes, ...nodeErrorCodes]);
const errorNames = new Set([
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'InternalError',
  'SystemError',
  'AssertionError',
  'AbortError',
  'DOMException',
  'TimeoutError',
  'CompileError',
  'LinkError',
  'RuntimeError',
  'LineError',
  'QueryError',
  'FontError',
  'CLIUsageError',
  'EPSIPreviewLimitError',
  'OperationCancelled',
  'NotEditable',
  'WebPreviewError',
  'Stopped',
  'CheckHTTPError',
  'ReceiptFailure',
  'NoTrash',
  'UpdateError',
  'LicenseError',
  'CLIOperationError',
  'CLIConnectionError',
  'CLIServiceError',
  'ProviderResponseError',
  'SamMaskError',
  'ModelPermissionRequired',
  'FileAccessRequired',
]);

export interface DiagnosticErrorFields {
  errorClass?: string;
  code?: string;
  /** Only the stack suffix after the complete error header, including its multiline message. */
  stack?: string;
}

export interface DiagnosticFailure extends DiagnosticErrorFields {
  detail: string;
}

export type DiagnosticInput = string | DiagnosticFailure;

export function knownErrorName(value: unknown): string | undefined {
  return typeof value === 'string' && errorNames.has(value) ? value : undefined;
}

export function knownErrorCode(value: unknown, errno: ReadonlySet<string>): string | undefined {
  return typeof value === 'string' && (errno.has(value) || knownCodes.has(value))
    ? value
    : undefined;
}

/** Capture before string conversion: a message can contain counterfeit frames and identifiers. */
export function diagnosticFailure(value: unknown): DiagnosticFailure {
  try {
    if (!(value instanceof Error)) return { detail: boundedText(String(value)) };
    const message = value.message;
    const stack = typeof value.stack === 'string' ? value.stack : undefined;
    const candidate = (value as Error & { code?: unknown }).code;
    const code = typeof candidate === 'string' && candidate.length <= 64 ? candidate : undefined;
    const description = message ? ': ' + message : '';
    const header = value.name + description;
    const headers = code ? [header, value.name + ' [' + code + ']' + description] : [header];
    const complete = headers.find((header) => stack?.startsWith(header + '\n'));
    const suffix = complete ? stack!.slice(complete.length + 1) : undefined;
    return {
      detail: boundedText(stack ?? header),
      errorClass:
        knownErrorName(value.name === 'Error' ? value.constructor.name : value.name) ?? 'Error',
      code,
      stack: suffix ? boundedText(suffix) : undefined,
    };
  } catch {
    return { detail: 'The failure could not be described.', errorClass: 'Error' };
  }
}
