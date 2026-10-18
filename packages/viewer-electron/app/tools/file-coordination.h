#pragma once
#import <Foundation/Foundation.h>
#include <node_api.h>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <string>
#include <cstring>

// Keep a real accessor claim until JS closes its readers and writers. Batch
// preparation alone does not hold a read lock. These bounded Cocoa queues are
// separate from libuv's pool and from each other, so previews cannot occupy all
// mutation workers or prevent metadata/descriptor cleanup.
struct FileCoordinationState;
struct FileCoordinationLease {
  std::weak_ptr<FileCoordinationState> state;
  std::string id;
  NSFileCoordinator *coordinator;
  NSArray<NSURL *> *urls;
  NSArray<NSString *> *modes;
  NSCondition *condition;
  NSString *purpose;
  napi_deferred start = nullptr;
  napi_deferred end = nullptr;
  napi_threadsafe_function notify = nullptr;
  bool released = false;
  bool cancelled = false;
};
struct FileCoordinationState {
  std::mutex mutex;
  std::unordered_map<std::string, std::shared_ptr<FileCoordinationLease>> leases;
  NSOperationQueue *readers;
  NSOperationQueue *writers;
  NSOperationQueue *nested;
};
struct FileCoordinationEvent {
  std::shared_ptr<FileCoordinationLease> lease;
  bool done;
  NSString *error;
  NSString *code;
  NSArray<NSString *> *paths;
};
static void coordinationJS(napi_env env, napi_value, void *, void *data) {
  std::unique_ptr<FileCoordinationEvent> event(static_cast<FileCoordinationEvent *>(data));
  auto lease = event->lease;
  if (env) {
    if (event->done) {
      if (lease->end) {
        napi_value value; napi_get_undefined(env, &value);
        napi_resolve_deferred(env, lease->end, value); lease->end = nullptr;
      }
    } else if (event->error) {
      napi_value error, value, code;
      napi_create_string_utf8(env, event->error.UTF8String, NAPI_AUTO_LENGTH, &value);
      napi_create_error(env, nullptr, value, &error);
      napi_create_string_utf8(env, event->code.UTF8String, NAPI_AUTO_LENGTH, &code);
      napi_set_named_property(env, error, "code", code);
      napi_reject_deferred(env, lease->start, error); lease->start = nullptr;
    } else {
      napi_value paths; napi_create_array_with_length(env, event->paths.count, &paths);
      uint32_t index = 0;
      for (NSString *file in event->paths) {
        napi_value value; napi_create_string_utf8(env, file.UTF8String, NAPI_AUTO_LENGTH, &value);
        napi_set_element(env, paths, index++, value);
      }
      napi_resolve_deferred(env, lease->start, paths); lease->start = nullptr;
    }
  }
  if (event->done) if (auto state = lease->state.lock()) {
    std::lock_guard<std::mutex> lock(state->mutex); state->leases.erase(lease->id);
  }
}
static void coordinationNotify(std::shared_ptr<FileCoordinationLease> lease, bool done,
                               NSString *error = nil, NSString *code = nil,
                               NSArray<NSString *> *paths = nil) {
  if (!lease->notify) return;
  auto event = new FileCoordinationEvent{lease, done, error, code, paths};
  napi_status status = napi_call_threadsafe_function(lease->notify, event, napi_tsfn_nonblocking);
  if (status != napi_ok) delete event;
  // Worker teardown can close the TSFN while Cocoa finishes its accessor.
  // napi_closing consumes this thread's acquisition; the handle may already be
  // destroyed, so neither another notification nor Release may use it again.
  if (status == napi_closing) lease->notify = nullptr;
}
static NSString *coordinationString(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || !length || length > 32768) return nil;
  std::string bytes(length + 1, '\0');
  napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &length);
  if (std::strlen(bytes.c_str()) != length) return nil;
  return [[NSString alloc] initWithBytes:bytes.data() length:length encoding:NSUTF8StringEncoding];
}
static std::shared_ptr<FileCoordinationState> coordinationState(napi_env env) {
  void *data = nullptr; napi_get_instance_data(env, &data);
  return *static_cast<std::shared_ptr<FileCoordinationState> *>(data);
}
static bool coordinationRead(NSString *mode) {
  return [mode isEqualToString:@"read"] || [mode isEqualToString:@"metadata"];
}
static NSUInteger coordinationOptions(NSString *mode) {
  if ([mode isEqualToString:@"metadata"]) return NSFileCoordinatorReadingImmediatelyAvailableMetadataOnly;
  if ([mode isEqualToString:@"move"]) return NSFileCoordinatorWritingForMoving;
  if ([mode isEqualToString:@"delete"]) return NSFileCoordinatorWritingForDeleting;
  return 0;
}
static napi_value coordinateStart(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 4; napi_value args[4]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSString *id = count >= 3 ? coordinationString(env, args[0]) : nil;
    NSString *purpose = count >= 3 ? coordinationString(env, args[2]) : nil;
    bool nested = false;
    if (count == 4 && napi_get_value_bool(env, args[3], &nested) != napi_ok) {
      napi_throw_type_error(env, nullptr, "Invalid coordination nesting flag."); return nullptr;
    }
    bool array = false; uint32_t length = 0;
    if (!id || !purpose || napi_is_array(env, args[1], &array) != napi_ok || !array ||
        napi_get_array_length(env, args[1], &length) != napi_ok || !length || length > 2) {
      napi_throw_type_error(env, nullptr, "Coordinate one item or a source/destination pair."); return nullptr;
    }
    NSMutableArray<NSURL *> *urls = [NSMutableArray array];
    NSMutableArray<NSString *> *modes = [NSMutableArray array];
    for (uint32_t index = 0; index < length; ++index) {
      napi_value item, fileValue, modeValue; napi_get_element(env, args[1], index, &item);
      napi_get_named_property(env, item, "path", &fileValue); napi_get_named_property(env, item, "mode", &modeValue);
      NSString *file = coordinationString(env, fileValue), *mode = coordinationString(env, modeValue);
      if (!file.isAbsolutePath || !mode || ![@[@"read", @"metadata", @"write", @"move", @"delete"] containsObject:mode]) {
        napi_throw_type_error(env, nullptr, "Invalid file coordination intent."); return nullptr;
      }
      [urls addObject:[NSURL fileURLWithPath:file]]; [modes addObject:mode];
    }
    if (length == 2 && coordinationRead(modes[0]) && coordinationRead(modes[1])) {
      napi_throw_type_error(env, nullptr, "A coordinated pair must contain a write intent."); return nullptr;
    }
    auto state = coordinationState(env);
    auto lease = std::make_shared<FileCoordinationLease>();
    lease->id = id.UTF8String; lease->state = state;
    lease->condition = [[NSCondition alloc] init]; lease->urls = urls; lease->modes = modes; lease->purpose = purpose;
    {
      std::lock_guard<std::mutex> lock(state->mutex);
      if (state->leases.size() >= 128 || state->leases.count(lease->id)) {
        napi_throw_error(env, nullptr, "Too many pending file coordination requests."); return nullptr;
      }
      state->leases.emplace(lease->id, lease);
    }
    napi_value promise, name; napi_create_promise(env, &lease->start, &promise);
    napi_create_string_utf8(env, "Viewer coordinated file access", NAPI_AUTO_LENGTH, &name);
    if (napi_create_threadsafe_function(env, nullptr, nullptr, name, 0, 1, nullptr, nullptr,
                                      nullptr, coordinationJS, &lease->notify) != napi_ok) {
      std::lock_guard<std::mutex> lock(state->mutex); state->leases.erase(lease->id);
      napi_throw_error(env, nullptr, "Could not start coordinated file access."); return nullptr;
    }
    NSOperationQueue *queue = nested ? state->nested : coordinationRead(modes[0]) && length == 1 ? state->readers : state->writers;
    [queue addOperationWithBlock:^{
      @autoreleasepool {
        __block bool entered = false;
        NSError *error = nil;
        @try {
          NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
          coordinator.purposeIdentifier = lease->purpose;
          [lease->condition lock]; lease->coordinator = coordinator;
          bool cancelled = lease->cancelled; [lease->condition unlock];
          if (cancelled) [coordinator cancel];
          void (^accessor)(NSArray<NSString *> *) = ^(NSArray<NSString *> *paths) {
            entered = true;
            coordinationNotify(lease, false, nil, nil, paths);
            [lease->condition lock];
            while (!lease->released) [lease->condition wait];
            [lease->condition unlock];
          };
          if (length == 1) {
            if (coordinationRead(modes[0]))
              [coordinator coordinateReadingItemAtURL:urls[0] options:coordinationOptions(modes[0]) error:&error byAccessor:^(NSURL *url) { accessor(@[url.path]); }];
            else
              [coordinator coordinateWritingItemAtURL:urls[0] options:coordinationOptions(modes[0]) error:&error byAccessor:^(NSURL *url) { accessor(@[url.path]); }];
          } else if (!coordinationRead(modes[0]) && !coordinationRead(modes[1])) {
            [coordinator coordinateWritingItemAtURL:urls[0] options:coordinationOptions(modes[0]) writingItemAtURL:urls[1] options:coordinationOptions(modes[1]) error:&error byAccessor:^(NSURL *first, NSURL *second) { accessor(@[first.path, second.path]); }];
          } else {
            NSUInteger readIndex = coordinationRead(modes[0]) ? 0 : 1, writeIndex = 1 - readIndex;
            [coordinator coordinateReadingItemAtURL:urls[readIndex] options:coordinationOptions(modes[readIndex]) writingItemAtURL:urls[writeIndex] options:coordinationOptions(modes[writeIndex]) error:&error byAccessor:^(NSURL *read, NSURL *write) { accessor(readIndex == 0 ? @[read.path, write.path] : @[write.path, read.path]); }];
          }
        } @catch (NSException *exception) {
          if (!entered) coordinationNotify(lease, false, exception.reason ?: @"File coordination failed.", @"FILE_COORDINATION_FAILED");
          entered = true;
        }
        if (!entered)
          coordinationNotify(lease, false, error.localizedDescription ?: @"The file provider could not make this item available.",
            [error.domain isEqualToString:NSCocoaErrorDomain] && error.code == NSUserCancelledError ? @"ABORT_ERR" : @"FILE_COORDINATION_FAILED");
        // Synchronous coordination has returned: its claim really is released.
        coordinationNotify(lease, true);
        if (lease->notify) {
          napi_release_threadsafe_function(lease->notify, napi_tsfn_release);
          lease->notify = nullptr;
        }
      }
    }];
    return promise;
  }
}
static std::shared_ptr<FileCoordinationLease> coordinationLease(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value args[1]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *id = count == 1 ? coordinationString(env, args[0]) : nil;
  if (!id) { napi_throw_type_error(env, nullptr, "Invalid file coordination identity."); return {}; }
  auto state = coordinationState(env); std::lock_guard<std::mutex> lock(state->mutex);
  auto entry = state->leases.find(id.UTF8String);
  return entry == state->leases.end() ? nullptr : entry->second;
}
static void coordinationCancelLease(std::shared_ptr<FileCoordinationLease> lease) {
  [lease->condition lock]; lease->cancelled = true; NSFileCoordinator *coordinator = lease->coordinator; [lease->condition unlock];
  // Apple explicitly permits cancel from any thread. It does not end an
  // accessor that already started; JS still closes its handles before release.
  [coordinator cancel];
}
static napi_value coordinateCancel(napi_env env, napi_callback_info info) {
  if (auto lease = coordinationLease(env, info)) coordinationCancelLease(lease);
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value coordinateEnd(napi_env env, napi_callback_info info) {
  auto lease = coordinationLease(env, info);
  napi_value promise;
  if (!lease) {
    napi_deferred deferred; napi_value result; napi_create_promise(env, &deferred, &promise);
    napi_get_undefined(env, &result); napi_resolve_deferred(env, deferred, result);
  } else {
    if (lease->end) { napi_throw_error(env, nullptr, "The file coordination claim is already closing."); return nullptr; }
    napi_create_promise(env, &lease->end, &promise);
    [lease->condition lock]; lease->released = true; [lease->condition broadcast]; [lease->condition unlock];
  }
  return promise;
}
static void coordinationCleanup(void *data) {
  auto state = *static_cast<std::shared_ptr<FileCoordinationState> *>(data);
  std::lock_guard<std::mutex> lock(state->mutex);
  for (auto &[id, lease] : state->leases) {
    coordinationCancelLease(lease);
    [lease->condition lock]; lease->released = true; [lease->condition broadcast]; [lease->condition unlock];
  }
}
static napi_value coordinateSameItem(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 2; napi_value args[2]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSString *original = count == 2 ? coordinationString(env, args[0]) : nil;
    NSString *returned = count == 2 ? coordinationString(env, args[1]) : nil;
    if (!original.isAbsolutePath || !returned.isAbsolutePath) {
      napi_throw_type_error(env, nullptr, "Compare absolute coordinated item paths."); return nullptr;
    }
    napi_value result;
    napi_get_boolean(env, sameCoordinatedItem([NSURL fileURLWithPath:returned], coordinatedItemPath([NSURL fileURLWithPath:original])), &result);
    return result;
  }
}
static void registerFileCoordination(napi_env env, napi_value exports) {
  auto state = std::make_shared<FileCoordinationState>();
  state->readers = [[NSOperationQueue alloc] init]; state->readers.name = @"com.pluridviewer.app.file-readers"; state->readers.maxConcurrentOperationCount = 16;
  state->writers = [[NSOperationQueue alloc] init]; state->writers.name = @"com.pluridviewer.app.file-writers"; state->writers.maxConcurrentOperationCount = 4;
  // Parent claims can occupy every root writer thread. Their one bounded
  // intermediate claim must still be able to enter and release the parent.
  state->nested = [[NSOperationQueue alloc] init]; state->nested.name = @"com.pluridviewer.app.file-intermediates"; state->nested.maxConcurrentOperationCount = 4;
  auto data = new std::shared_ptr<FileCoordinationState>(state);
  napi_set_instance_data(env, data, [](napi_env, void *data, void *) {
    delete static_cast<std::shared_ptr<FileCoordinationState> *>(data);
  }, nullptr);
  napi_add_env_cleanup_hook(env, coordinationCleanup, data);
  napi_property_descriptor methods[] = {
    {"coordinateStart", nullptr, coordinateStart, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"coordinateCancel", nullptr, coordinateCancel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"coordinateEnd", nullptr, coordinateEnd, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"coordinateSameItem", nullptr, coordinateSameItem, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 4, methods);
}
