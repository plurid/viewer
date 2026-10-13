#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <copyfile.h>
#include <cerrno>
#include <string>
#include <cstring>
#include <sys/stat.h>
#include <stdio.h>
#include <fcntl.h>

// A small in-process bridge: dynamic PowerBox grants belong to this process.
// Filesystem work runs on N-API's bounded pool, never the Cocoa/renderer thread.
static napi_value text(napi_env env, NSString *value) {
  napi_value output; napi_create_string_utf8(env, (value ?: @"").UTF8String, NAPI_AUTO_LENGTH, &output); return output;
}
static napi_value number(napi_env env, double value) {
  napi_value output; napi_create_double(env, value, &output); return output;
}
static napi_value boolean(napi_env env, bool value) {
  napi_value output; napi_get_boolean(env, value, &output); return output;
}
static void property(napi_env env, napi_value object, const char *name, napi_value value) {
  napi_set_named_property(env, object, name, value);
}
static NSString *stringArg(napi_env env, napi_value value) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size > 32768) return nil;
  std::string bytes(size + 1, '\0');
  napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &size);
  if (std::strlen(bytes.c_str()) != size) return nil;
  return [[NSString alloc] initWithBytes:bytes.data() length:size encoding:NSUTF8StringEncoding];
}
static napi_value invalid(napi_env env) {
  napi_throw_type_error(env, nullptr, "Invalid native file argument."); return nullptr;
}

static napi_value clipboardVersion(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 1; napi_value args[1]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    bool drag = false;
    if (count && napi_get_value_bool(env, args[0], &drag) != napi_ok) return invalid(env);
    NSPasteboard *board = drag ? [NSPasteboard pasteboardWithName:NSPasteboardNameDrag] : NSPasteboard.generalPasteboard;
    return number(env, board.changeCount);
  }
}
static napi_value clipboardRead(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 1; napi_value args[1]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    bool drag = false;
    if (count && napi_get_value_bool(env, args[0], &drag) != napi_ok) return invalid(env);
    NSPasteboard *board = drag ? [NSPasteboard pasteboardWithName:NSPasteboardNameDrag] : NSPasteboard.generalPasteboard;
    const NSInteger version = board.changeCount;
    NSArray<NSURL *> *urls = [board readObjectsForClasses:@[NSURL.class] options:@{NSPasteboardURLReadingFileURLsOnlyKey: @YES}] ?: @[];
    if (urls.count > 10000) { napi_throw_error(env, nullptr, "Select at most 10,000 items at a time."); return nullptr; }
    napi_value output, files; napi_create_object(env, &output); napi_create_array(env, &files);
    uint32_t index = 0; NSUInteger bookmarkBytes = 0;
    for (NSURL *url in urls) {
      if (index >= 10000 || !url.isFileURL) break;
      NSNumber *directory; [url getResourceValue:&directory forKey:NSURLIsDirectoryKey error:nil];
      NSData *bookmark = [url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope includingResourceValuesForKeys:nil relativeToURL:nil error:nil];
      bookmarkBytes += bookmark.length;
      if (bookmark.length > 49152 || bookmarkBytes > 12 * 1024 * 1024) { napi_throw_error(env, nullptr, "Native selection exceeds the bookmark budget. Choose its parent folder."); return nullptr; }
      napi_value item; napi_create_object(env, &item);
      property(env, item, "path", text(env, url.path));
      property(env, item, "directory", boolean(env, directory.boolValue));
      if (bookmark) property(env, item, "bookmark", text(env, [bookmark base64EncodedStringWithOptions:0]));
      napi_set_element(env, files, index++, item);
    }
    property(env, output, "files", files);
    if (board.changeCount != version) { napi_throw_error(env, nullptr, "The native file selection changed while reading. Copy the items again."); return nullptr; }
    property(env, output, "changeCount", number(env, version));
    return output;
  }
}
static napi_value clipboardWrite(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 1; napi_value args[1]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    bool array = false; uint32_t length = 0;
    if (count != 1 || napi_is_array(env, args[0], &array) != napi_ok || !array || napi_get_array_length(env, args[0], &length) != napi_ok || !length || length > 10000) return invalid(env);
    NSMutableArray<NSURL *> *urls = [NSMutableArray array];
    NSMutableArray<NSString *> *paths = [NSMutableArray array];
    for (uint32_t index = 0; index < length; ++index) {
      napi_value item; napi_get_element(env, args[0], index, &item);
      NSString *file = stringArg(env, item);
      if (!file.isAbsolutePath) return invalid(env);
      [urls addObject:[NSURL fileURLWithPath:file]]; [paths addObject:file];
    }
    NSPasteboard *board = NSPasteboard.generalPasteboard;
    [board clearContents];
    if (![board writeObjects:urls]) { napi_throw_error(env, nullptr, "Could not copy files to the macOS clipboard."); return nullptr; }
    [board setString:[paths componentsJoinedByString:@"\n"] forType:NSPasteboardTypeString];
    return number(env, board.changeCount);
  }
}

enum class Kind { Metadata, LinkMetadata, Rename, Trash, Volumes, Eject };
struct Work {
  napi_async_work work; napi_deferred deferred; Kind kind;
  int source = -1, target = -1;
  NSString *file = nil;
  NSString *targetFile = nil;
  NSString *error = nil;
  int errorNumber = 0;
  NSString *result = nil;
  NSString *bookmark = nil;
  bool directory = false;
  NSArray<NSDictionary *> *volumes = nil;
};
static void execute(napi_env, void *data) {
  Work *task = static_cast<Work *>(data);
  @autoreleasepool { @try {
    NSError *error = nil;
    if (task->kind == Kind::Metadata) {
      if (fcopyfile(task->source, task->target, nullptr, COPYFILE_METADATA) != 0)
        task->error = [NSString stringWithFormat:@"Could not preserve macOS file metadata: %s", std::strerror(errno)];
    } else if (task->kind == Kind::LinkMetadata) {
      struct stat source{}, target{};
      if (lstat(task->file.fileSystemRepresentation, &source) != 0 || lstat(task->targetFile.fileSystemRepresentation, &target) != 0 || !S_ISLNK(source.st_mode) || !S_ISLNK(target.st_mode)) task->error = @"A symbolic link changed during the transfer.";
      else if (copyfile(task->file.fileSystemRepresentation, task->targetFile.fileSystemRepresentation, nullptr, COPYFILE_METADATA | COPYFILE_NOFOLLOW_SRC | COPYFILE_NOFOLLOW_DST) != 0) task->error = [NSString stringWithFormat:@"Could not preserve symbolic link metadata: %s", std::strerror(errno)];
    } else if (task->kind == Kind::Rename) {
      if (renameatx_np(AT_FDCWD, task->file.fileSystemRepresentation, AT_FDCWD, task->targetFile.fileSystemRepresentation, RENAME_EXCL) != 0) {
        task->errorNumber = errno;
        task->error = [NSString stringWithFormat:@"Could not move the item: %s", std::strerror(errno)];
      }
    } else if (task->kind == Kind::Trash) {
      NSURL *result = nil;
      if (![NSFileManager.defaultManager trashItemAtURL:[NSURL fileURLWithPath:task->file] resultingItemURL:&result error:&error]) task->error = error.localizedDescription ?: @"The item could not be moved to Trash.";
      else {
        task->result = result.path;
        NSNumber *directory; [result getResourceValue:&directory forKey:NSURLIsDirectoryKey error:nil]; task->directory = directory.boolValue;
        NSData *bookmark = [result bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope includingResourceValuesForKeys:nil relativeToURL:nil error:nil];
        if (bookmark) task->bookmark = [bookmark base64EncodedStringWithOptions:0];
      }
    } else if (task->kind == Kind::Eject) {
      if (![NSWorkspace.sharedWorkspace unmountAndEjectDeviceAtURL:[NSURL fileURLWithPath:task->file] error:&error]) {
        if (([error.domain isEqualToString:NSOSStatusErrorDomain] && error.code == -47) || ([error.domain isEqualToString:NSPOSIXErrorDomain] && error.code == EBUSY)) {
          task->error = @"This disk is in use. Close files or terminals on it, then try again.";
          task->errorNumber = EBUSY;
        } else task->error = error.localizedDescription ?: @"The volume could not be ejected. Close files on it and try again.";
      }
    } else {
      NSArray *keys = @[NSURLVolumeNameKey, NSURLVolumeTotalCapacityKey, NSURLVolumeAvailableCapacityKey, NSURLVolumeIsRemovableKey, NSURLVolumeIsEjectableKey, NSURLVolumeIsReadOnlyKey];
      NSArray<NSURL *> *urls = [NSFileManager.defaultManager mountedVolumeURLsIncludingResourceValuesForKeys:keys options:NSVolumeEnumerationSkipHiddenVolumes];
      NSMutableArray *volumes = [NSMutableArray array];
      for (NSURL *url in urls) {
        if (volumes.count >= 512) break;
        NSDictionary *values = [url resourceValuesForKeys:keys error:nil];
        [volumes addObject:@{
          @"path": url.path, @"name": values[NSURLVolumeNameKey] ?: url.lastPathComponent,
          @"total": values[NSURLVolumeTotalCapacityKey] ?: @0,
          @"available": values[NSURLVolumeAvailableCapacityKey] ?: @0,
          @"removable": values[NSURLVolumeIsRemovableKey] ?: @NO,
          @"ejectable": values[NSURLVolumeIsEjectableKey] ?: @NO,
          @"readOnly": values[NSURLVolumeIsReadOnlyKey] ?: @NO
        }];
      }
      task->volumes = volumes;
    }
  } @catch (NSException *error) { task->error = error.reason ?: @"macOS file service failed."; } }
}
static void complete(napi_env env, napi_status status, void *data) {
  Work *task = static_cast<Work *>(data);
  if (status != napi_ok || task->error) {
    napi_value error; napi_create_error(env, nullptr, text(env, task->error ?: @"macOS file work was cancelled."), &error);
    if (task->errorNumber) {
      const char *code = task->errorNumber == EXDEV ? "EXDEV" : task->errorNumber == EEXIST ? "EEXIST" : task->errorNumber == ENOENT ? "ENOENT" : task->errorNumber == EBUSY ? "EBUSY" : "EIO";
      property(env, error, "code", text(env, [NSString stringWithUTF8String:code]));
    }
    napi_reject_deferred(env, task->deferred, error);
  } else {
    napi_value result; napi_get_undefined(env, &result);
    if (task->kind == Kind::Trash) {
      napi_create_object(env, &result);
      property(env, result, "path", text(env, task->result));
      property(env, result, "directory", boolean(env, task->directory));
      if (task->bookmark) property(env, result, "bookmark", text(env, task->bookmark));
    }
    if (task->kind == Kind::Volumes) {
      napi_create_array(env, &result); uint32_t index = 0;
      for (NSDictionary *volume in task->volumes) {
        napi_value item; napi_create_object(env, &item);
        property(env, item, "path", text(env, volume[@"path"])); property(env, item, "name", text(env, volume[@"name"]));
        property(env, item, "total", number(env, [volume[@"total"] doubleValue])); property(env, item, "available", number(env, [volume[@"available"] doubleValue]));
        for (NSString *key in @[@"removable", @"ejectable", @"readOnly"]) property(env, item, key.UTF8String, boolean(env, [volume[key] boolValue]));
        napi_set_element(env, result, index++, item);
      }
    }
    napi_resolve_deferred(env, task->deferred, result);
  }
  napi_delete_async_work(env, task->work); delete task;
}
static napi_value queue(napi_env env, Work *task) {
  napi_value promise;
  if (napi_create_promise(env, &task->deferred, &promise) != napi_ok || napi_create_async_work(env, nullptr, text(env, @"Viewer macOS files"), execute, complete, task, &task->work) != napi_ok) {
    delete task; napi_throw_error(env, nullptr, "Could not start macOS file work."); return nullptr;
  }
  if (napi_queue_async_work(env, task->work) != napi_ok) {
    napi_delete_async_work(env, task->work); delete task; napi_throw_error(env, nullptr, "Could not queue macOS file work."); return nullptr;
  }
  return promise;
}
static napi_value metadata(napi_env env, napi_callback_info info) {
  size_t count = 2; napi_value args[2]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  int32_t source, target;
  if (count != 2 || napi_get_value_int32(env, args[0], &source) != napi_ok || napi_get_value_int32(env, args[1], &target) != napi_ok || source < 0 || target < 0 || source == target) return invalid(env);
  Work *task = new Work{}; task->kind = Kind::Metadata; task->source = source; task->target = target; return queue(env, task);
}
static napi_value fileWork(napi_env env, napi_callback_info info, Kind kind) {
  size_t count = 1; napi_value args[1]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *file = count == 1 ? stringArg(env, args[0]) : nil;
  if (!file.isAbsolutePath) return invalid(env);
  Work *task = new Work{}; task->kind = kind; task->file = file; return queue(env, task);
}
static napi_value trash(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::Trash); }
static napi_value pairWork(napi_env env, napi_callback_info info, Kind kind) {
  size_t count = 2; napi_value args[2]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *source = count == 2 ? stringArg(env, args[0]) : nil;
  NSString *target = count == 2 ? stringArg(env, args[1]) : nil;
  if (!source.isAbsolutePath || !target.isAbsolutePath) return invalid(env);
  Work *task = new Work{}; task->kind = kind; task->file = source; task->targetFile = target; return queue(env, task);
}
static napi_value linkMetadata(napi_env env, napi_callback_info info) { return pairWork(env, info, Kind::LinkMetadata); }
static napi_value renameExclusive(napi_env env, napi_callback_info info) { return pairWork(env, info, Kind::Rename); }
static napi_value eject(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::Eject); }
static napi_value volumes(napi_env env, napi_callback_info) { Work *task = new Work{}; task->kind = Kind::Volumes; return queue(env, task); }
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"clipboardVersion", nullptr, clipboardVersion, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clipboardRead", nullptr, clipboardRead, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clipboardWrite", nullptr, clipboardWrite, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"copyMetadata", nullptr, metadata, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"copyLinkMetadata", nullptr, linkMetadata, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"renameExclusive", nullptr, renameExclusive, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"trash", nullptr, trash, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"volumes", nullptr, volumes, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"eject", nullptr, eject, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods)/sizeof(methods[0]), methods); return exports;
}
NAPI_MODULE(viewer_macos_files, init)
