export const speechRuntimeVersion = '1.9.5';
export const speechRuntimeArchive = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-b5454-xcframework.zip',
  sha256: 'e57f8c48933000acabc13bb913fbe82805d483a2deff692cc6738836bd92393b',
  bytes: 65816082,
  commit: 'd1be6fde11ac6e0407606b4e42fe72d34add8037',
} as const;
export const speechRuntimeName = (arch: string = process.arch) => 'viewer-speech-v1-darwin-' + arch;
