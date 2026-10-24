#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>
#include <optional>

enum class ViewerFullscreenPhase { Entering, Exiting };

struct ViewerFullscreenState {
  NSMapTable<NSWindow *, NSNumber *> *phases = [NSMapTable weakToStrongObjectsMapTable];
  NSMutableArray<id> *observers = [NSMutableArray array];
};

static void observeFullscreen(
  ViewerFullscreenState *state,
  NSNotificationName name,
  std::optional<ViewerFullscreenPhase> phase
) {
  id observer = [NSNotificationCenter.defaultCenter
    addObserverForName:name
    object:nil
    queue:nil
    usingBlock:^(NSNotification *notification) {
      if (!NSThread.isMainThread || ![notification.object isKindOfClass:NSWindow.class]) return;
      NSWindow *window = notification.object;
      if (phase) [state->phases setObject:@(static_cast<int>(*phase)) forKey:window];
      else [state->phases removeObjectForKey:window];
    }];
  [state->observers addObject:observer];
}

static void fullscreenCleanup(void *data) {
  auto state = static_cast<ViewerFullscreenState *>(data);
  for (id observer in state->observers)
    [NSNotificationCenter.defaultCenter removeObserver:observer];
  delete state;
}

static napi_value windowFullscreenPhase(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 1;
    napi_value args[1];
    void *context = nullptr;
    napi_get_cb_info(env, info, &count, args, nullptr, &context);
    if (!context || !NSThread.isMainThread) {
      napi_throw_error(env, nullptr, "Read native window transitions on the application thread.");
      return nullptr;
    }
    bool buffer = false;
    size_t length = 0;
    void *bytes = nullptr;
    void *handle = nullptr;
    if (
      count != 1 ||
      napi_is_buffer(env, args[0], &buffer) != napi_ok || !buffer ||
      napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok ||
      length != sizeof(handle)
    ) {
      napi_throw_type_error(env, nullptr, "Use a live Viewer window's native handle.");
      return nullptr;
    }
    std::memcpy(&handle, bytes, sizeof(handle));
    // Electron supplies an NSView pointer. Compare its bytes with owned, live
    // content views instead of dereferencing an arbitrary or stale pointer.
    NSWindow *owned = nil;
    for (NSWindow *window in NSApp.windows) {
      if (handle && (__bridge void *)window.contentView == handle) {
        owned = window;
        break;
      }
    }
    if (!owned) {
      napi_throw_error(env, nullptr, "The native Viewer window is no longer available.");
      return nullptr;
    }
    auto state = static_cast<ViewerFullscreenState *>(context);
    NSNumber *phase = [state->phases objectForKey:owned];
    const char *value = !phase ? "idle" :
      phase.intValue == static_cast<int>(ViewerFullscreenPhase::Entering) ? "entering" : "exiting";
    napi_value output;
    napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &output);
    return output;
  }
}

/** Observe public AppKit notifications before any application fullscreen request. */
static void registerWindowFullscreen(napi_env env, napi_value exports) {
  ViewerFullscreenState *state = nullptr;
  if (NSThread.isMainThread) {
    state = new ViewerFullscreenState();
    observeFullscreen(state, NSWindowWillEnterFullScreenNotification, ViewerFullscreenPhase::Entering);
    observeFullscreen(state, NSWindowWillExitFullScreenNotification, ViewerFullscreenPhase::Exiting);
    observeFullscreen(state, NSWindowDidEnterFullScreenNotification, std::nullopt);
    observeFullscreen(state, NSWindowDidExitFullScreenNotification, std::nullopt);
    observeFullscreen(state, NSWindowWillCloseNotification, std::nullopt);
    napi_add_env_cleanup_hook(env, fullscreenCleanup, state);
  }
  napi_property_descriptor method = {
    "windowFullscreenPhase", nullptr, windowFullscreenPhase,
    nullptr, nullptr, nullptr, napi_default, state
  };
  napi_define_properties(env, exports, 1, &method);
}
