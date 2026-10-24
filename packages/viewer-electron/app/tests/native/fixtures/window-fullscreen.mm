// The native visibility probe loads only this read-only public AppKit adapter.
#include "../../../tools/window-fullscreen.h"

static napi_value init(napi_env env, napi_value exports) {
  registerWindowFullscreen(env, exports);
  return exports;
}

NAPI_MODULE(viewer_window_fullscreen, init)
