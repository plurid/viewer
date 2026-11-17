// A secure sheet for a server's sign-in question, attached to the window that clicked Connect.
// The answer goes straight back to the main process's promise: never to a renderer, a log or a
// window event. Included by macos-files.mm, which defines stringArg.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>

static NSMutableDictionary<NSString *, NSAlert *> *viewerRemotePrompts = nil;

struct ViewerRemoteAnswer {
  napi_deferred deferred;
  NSString *answer;
};

static void remoteAnswerJS(napi_env env, napi_value, void *, void *data) {
  auto result = static_cast<ViewerRemoteAnswer *>(data);
  if (env) {
    napi_value answer;
    if (result->answer) {
      napi_create_string_utf8(env, result->answer.UTF8String, NAPI_AUTO_LENGTH, &answer);
    } else {
      napi_get_null(env, &answer);
    }
    napi_resolve_deferred(env, result->deferred, answer);
  }
  result->answer = nil;
  delete result;
}

static NSWindow *remotePromptOwner(napi_env env, napi_value value) {
  bool buffer = false;
  void *bytes = nullptr, *handle = nullptr;
  size_t length = 0;
  if (napi_is_buffer(env, value, &buffer) != napi_ok || !buffer ||
      napi_get_buffer_info(env, value, &bytes, &length) != napi_ok || length != sizeof(handle)) {
    return nil;
  }
  std::memcpy(&handle, bytes, sizeof(handle));
  for (NSWindow *window in NSApp.windows) {
    if (handle && (__bridge void *)window.contentView == handle) return window;
  }
  return nil;
}

// remotePrompt(id, handle, title, prompt, placeholder): resolves the typed answer, or null.
static napi_value remotePrompt(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 5;
    napi_value args[5];
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSString *id = count == 5 ? stringArg(env, args[0]) : nil;
    NSString *title = count == 5 ? stringArg(env, args[2]) : nil;
    NSString *prompt = count == 5 ? stringArg(env, args[3]) : nil;
    NSString *placeholder = count == 5 ? stringArg(env, args[4]) : nil;
    // 2,000 characters of up to two UTF-16 units each, inside quotation marks.
    if (!NSThread.isMainThread || !id || !title || !prompt || !placeholder || prompt.length > 4002) {
      napi_throw_type_error(env, nullptr, "Use a live Viewer window for the server prompt.");
      return nullptr;
    }
    NSWindow *owner = remotePromptOwner(env, args[1]);
    if (!owner || viewerRemotePrompts[id] || viewerRemotePrompts.count >= 8) {
      napi_throw_error(env, nullptr, "The server prompt's window is unavailable or busy.");
      return nullptr;
    }
    NSAlert *alert = [NSAlert new];
    alert.messageText = title;
    alert.informativeText = prompt;
    [alert addButtonWithTitle:@"Continue"];
    [alert addButtonWithTitle:@"Cancel"];
    NSSecureTextField *field = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 300, 24)];
    field.placeholderString = placeholder;
    alert.accessoryView = field;
    auto result = new ViewerRemoteAnswer{};
    napi_value promise, name;
    napi_create_promise(env, &result->deferred, &promise);
    napi_create_string_utf8(env, "Viewer server secure prompt", NAPI_AUTO_LENGTH, &name);
    napi_threadsafe_function notify;
    if (napi_create_threadsafe_function(env, nullptr, nullptr, name, 1, 1, nullptr, nullptr,
                                        nullptr, remoteAnswerJS, &notify) != napi_ok) {
      delete result;
      napi_throw_error(env, nullptr, "Could not open the secure server prompt.");
      return nullptr;
    }
    if (!viewerRemotePrompts) viewerRemotePrompts = [NSMutableDictionary dictionary];
    viewerRemotePrompts[id] = alert;
    [alert beginSheetModalForWindow:owner completionHandler:^(NSModalResponse response) {
      result->answer = response == NSAlertFirstButtonReturn ? [field.stringValue copy] : nil;
      // The field's text does not outlive the sheet.
      field.stringValue = @"";
      [viewerRemotePrompts removeObjectForKey:id];
      napi_status status = napi_call_threadsafe_function(notify, result, napi_tsfn_nonblocking);
      if (status != napi_ok) delete result;
      napi_release_threadsafe_function(notify, napi_tsfn_release);
    }];
    [alert.window makeFirstResponder:field];
    return promise;
  }
}

// cancelRemotePrompt(id): ends the sheet as if Cancel was chosen.
static napi_value cancelRemotePrompt(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *id = count == 1 ? stringArg(env, args[0]) : nil;
  NSAlert *alert = id ? viewerRemotePrompts[id] : nil;
  if (NSThread.isMainThread && alert) {
    [alert.window.sheetParent endSheet:alert.window returnCode:NSModalResponseCancel];
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static void registerRemotePrompt(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"remotePrompt", nullptr, remotePrompt, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"cancelRemotePrompt", nullptr, cancelRemotePrompt, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
}
