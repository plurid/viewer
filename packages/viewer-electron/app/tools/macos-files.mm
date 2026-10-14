#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <Security/SecTask.h>
#include <node_api.h>
#include <copyfile.h>
#include <cerrno>
#include <string>
#include <cstring>
#include <sys/stat.h>
#include <sys/mount.h>
#include <stdio.h>
#include <fcntl.h>
#include <algorithm>

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
static NSString *coordinatedItemPath(NSURL *url) {
  // Resolve ancestry aliases while preserving a symbolic link as the item.
  return [[url URLByDeletingLastPathComponent].URLByResolvingSymlinksInPath URLByAppendingPathComponent:url.lastPathComponent].path;
}
static bool sameCoordinatedItem(NSURL *url, NSString *original) {
  NSString *returned = coordinatedItemPath(url);
  if ([returned isEqualToString:original]) return true;
  if (![returned.precomposedStringWithCanonicalMapping isEqualToString:original.precomposedStringWithCanonicalMapping]) return false;
  struct stat before{}, after{};
  int first = lstat(original.fileSystemRepresentation, &before), firstError = errno;
  int second = lstat(returned.fileSystemRepresentation, &after), secondError = errno;
  if (first == 0 && second == 0) return before.st_dev == after.st_dev && before.st_ino == after.st_ino;
  // New Unicode names also come back decomposed. Only APFS/HFS guarantee
  // canonical Unicode lookup equivalence; do not assume it on a remote volume.
  struct statfs volume{};
  return first != 0 && firstError == ENOENT && second != 0 && secondError == ENOENT &&
    statfs(original.stringByDeletingLastPathComponent.fileSystemRepresentation, &volume) == 0 &&
    (std::strcmp(volume.f_fstypename, "apfs") == 0 || std::strcmp(volume.f_fstypename, "hfs") == 0);
}
static bool sandboxedProcess() {
  static const bool sandboxed = [] {
    SecTaskRef task = SecTaskCreateFromSelf(nullptr);
    if (!task) return false;
    CFTypeRef value = SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.security.app-sandbox"), nullptr);
    bool enabled = value && CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue((CFBooleanRef)value);
    if (value) CFRelease(value);
    CFRelease(task);
    return enabled;
  }();
  return sandboxed;
}
#include "trash-ui.h"
#include "file-coordination.h"

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

enum class Kind { Metadata, LinkMetadata, Rename, Trash, Volumes, Eject, Alias, DatesAdded };
struct Work {
  napi_async_work work; napi_deferred deferred; Kind kind;
  int source = -1, target = -1;
  NSString *file = nil;
  NSString *targetFile = nil;
  NSString *purpose = nil;
  NSString *error = nil;
  int errorNumber = 0;
  NSString *result = nil;
  NSString *bookmark = nil;
  bool directory = false;
  NSArray<NSDictionary *> *volumes = nil;
  NSArray<NSString *> *files = nil;
  NSArray<NSDictionary *> *dates = nil;
};
static void execute(napi_env, void *data) {
  Work *task = static_cast<Work *>(data);
  @autoreleasepool { @try {
    NSError *error = nil;
    if (task->kind == Kind::DatesAdded) {
      NSMutableArray *dates = [NSMutableArray array];
      for (NSString *file in task->files) {
        @autoreleasepool {
          struct stat before{}, after{};
          if (lstat(file.fileSystemRepresentation, &before) != 0 ||
            (!S_ISREG(before.st_mode) && !S_ISDIR(before.st_mode))) continue;
          NSURL *url = [NSURL fileURLWithPath:file];
          NSDictionary *values = [url resourceValuesForKeys:@[NSURLAddedToDirectoryDateKey] error:nil];
          if (lstat(file.fileSystemRepresentation, &after) != 0 ||
            before.st_dev != after.st_dev || before.st_ino != after.st_ino || before.st_mode != after.st_mode ||
            before.st_size != after.st_size || before.st_mtimespec.tv_sec != after.st_mtimespec.tv_sec ||
            before.st_mtimespec.tv_nsec != after.st_mtimespec.tv_nsec || before.st_ctimespec.tv_sec != after.st_ctimespec.tv_sec ||
            before.st_ctimespec.tv_nsec != after.st_ctimespec.tv_nsec) continue;
          NSMutableDictionary *date = [@{
            @"path": file,
            @"identity": [NSString stringWithFormat:@"%llu:%llu", (unsigned long long)after.st_dev, (unsigned long long)after.st_ino],
            @"size": @(after.st_size),
            @"modified": @(after.st_mtimespec.tv_sec * 1000.0 + after.st_mtimespec.tv_nsec / 1000000.0)
          } mutableCopy];
          id added = values[NSURLAddedToDirectoryDateKey];
          if ([added isKindOfClass:NSDate.class]) date[@"added"] = @([added timeIntervalSince1970] * 1000.0);
          [dates addObject:date];
        }
      }
      task->dates = dates;
    } else if (task->kind == Kind::Alias) {
      NSURL *source = [NSURL fileURLWithPath:task->file], *destination = [NSURL fileURLWithPath:task->targetFile];
      NSData *bookmark = [source bookmarkDataWithOptions:NSURLBookmarkCreationSuitableForBookmarkFile includingResourceValuesForKeys:nil relativeToURL:nil error:&error];
      // The operation owns a mode-0700 staging directory and exclusively
      // publishes its output afterward. Never write directly over user files.
      struct stat existing{};
      if (lstat(task->targetFile.fileSystemRepresentation, &existing) == 0) {
        task->error = @"The alias staging file already exists."; task->errorNumber = EEXIST;
      } else if (errno != ENOENT || !bookmark || ![NSURL writeBookmarkData:bookmark toURL:destination options:0 error:&error])
        task->error = error.localizedDescription ?: @"Could not create the Finder alias.";
    } else if (task->kind == Kind::Metadata) {
      if (fcopyfile(task->source, task->target, nullptr, COPYFILE_METADATA) != 0)
        task->error = [NSString stringWithFormat:@"Could not preserve macOS file metadata: %s", std::strerror(errno)];
    } else if (task->kind == Kind::LinkMetadata) {
      struct stat source{}, target{};
      if (lstat(task->file.fileSystemRepresentation, &source) != 0 || lstat(task->targetFile.fileSystemRepresentation, &target) != 0 || !S_ISLNK(source.st_mode) || !S_ISLNK(target.st_mode)) task->error = @"A symbolic link changed during the transfer.";
      else if (copyfile(task->file.fileSystemRepresentation, task->targetFile.fileSystemRepresentation, nullptr, COPYFILE_METADATA | COPYFILE_NOFOLLOW_SRC | COPYFILE_NOFOLLOW_DST) != 0) task->error = [NSString stringWithFormat:@"Could not preserve symbolic link metadata: %s", std::strerror(errno)];
    } else if (task->kind == Kind::Rename) {
      NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
      if (task->purpose) coordinator.purposeIdentifier = task->purpose;
      NSURL *source = [NSURL fileURLWithPath:task->file], *target = [NSURL fileURLWithPath:task->targetFile];
      NSString *sourcePath = coordinatedItemPath(source);
      NSString *targetPath = coordinatedItemPath(target);
      __block bool entered = false;
      [coordinator coordinateWritingItemAtURL:source options:NSFileCoordinatorWritingForMoving writingItemAtURL:target options:NSFileCoordinatorWritingForReplacing error:&error byAccessor:^(NSURL *from, NSURL *to) {
        entered = true;
        if (!sameCoordinatedItem(from, sourcePath) || !sameCoordinatedItem(to, targetPath)) {
          task->error = @"The item moved while waiting for its file provider. Refresh the folder and retry.";
          return;
        }
        if (sandboxedProcess()) [coordinator itemAtURL:from willMoveToURL:to];
        if (renameatx_np(AT_FDCWD, from.fileSystemRepresentation, AT_FDCWD, to.fileSystemRepresentation, RENAME_EXCL) != 0) {
          task->errorNumber = errno;
          task->error = [NSString stringWithFormat:@"Could not move the item: %s", std::strerror(errno)];
        } else [coordinator itemAtURL:from didMoveToURL:to];
      }];
      if (!entered) task->error = error.localizedDescription ?: @"The file provider could not prepare this move.";
    } else if (task->kind == Kind::Trash) {
      NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
      if (task->purpose) coordinator.purposeIdentifier = task->purpose;
      NSURL *source = [NSURL fileURLWithPath:task->file];
      NSString *sourcePath = coordinatedItemPath(source);
      __block bool entered = false;
      [coordinator coordinateWritingItemAtURL:source options:NSFileCoordinatorWritingForDeleting error:&error byAccessor:^(NSURL *url) {
        entered = true;
        if (!sameCoordinatedItem(url, sourcePath)) {
          task->error = @"The item moved while waiting for its file provider. Refresh the folder and retry.";
          return;
        }
        NSURL *result = nil; NSError *trashError = nil;
        if (![NSFileManager.defaultManager trashItemAtURL:url resultingItemURL:&result error:&trashError]) task->error = trashError.localizedDescription ?: @"The item could not be moved to Trash.";
        else {
          task->result = result.path;
          NSNumber *directory; [result getResourceValue:&directory forKey:NSURLIsDirectoryKey error:nil]; task->directory = directory.boolValue;
          NSData *bookmark = [result bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope includingResourceValuesForKeys:nil relativeToURL:nil error:nil];
          if (bookmark) task->bookmark = [bookmark base64EncodedStringWithOptions:0];
        }
      }];
      if (!entered) task->error = error.localizedDescription ?: @"The file provider could not prepare this deletion.";
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
    if (task->kind == Kind::DatesAdded) {
      napi_create_array(env, &result); uint32_t index = 0;
      for (NSDictionary *date in task->dates) {
        napi_value item; napi_create_object(env, &item);
        property(env, item, "path", text(env, date[@"path"]));
        property(env, item, "identity", text(env, date[@"identity"]));
        for (NSString *key in @[@"size", @"modified", @"added"]) {
          if (date[key]) property(env, item, key.UTF8String, number(env, [date[key] doubleValue]));
        }
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
  size_t count = 2; napi_value args[2]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *file = count >= 1 ? stringArg(env, args[0]) : nil;
  if (!file.isAbsolutePath) return invalid(env);
  Work *task = new Work{}; task->kind = kind; task->file = file; task->purpose = count > 1 ? stringArg(env, args[1]) : nil; return queue(env, task);
}
static napi_value trash(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::Trash); }
static napi_value pairWork(napi_env env, napi_callback_info info, Kind kind) {
  size_t count = 3; napi_value args[3]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *source = count >= 2 ? stringArg(env, args[0]) : nil;
  NSString *target = count >= 2 ? stringArg(env, args[1]) : nil;
  if (!source.isAbsolutePath || !target.isAbsolutePath) return invalid(env);
  Work *task = new Work{}; task->kind = kind; task->file = source; task->targetFile = target; task->purpose = count > 2 ? stringArg(env, args[2]) : nil; return queue(env, task);
}
static napi_value linkMetadata(napi_env env, napi_callback_info info) { return pairWork(env, info, Kind::LinkMetadata); }
static napi_value renameExclusive(napi_env env, napi_callback_info info) { return pairWork(env, info, Kind::Rename); }
static napi_value alias(napi_env env, napi_callback_info info) { return pairWork(env, info, Kind::Alias); }
static napi_value eject(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::Eject); }
static napi_value datesAdded(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 1; napi_value args[1]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    bool array = false; uint32_t length = 0;
    if (count != 1 || napi_is_array(env, args[0], &array) != napi_ok || !array ||
      napi_get_array_length(env, args[0], &length) != napi_ok || length > 4000) return invalid(env);
    NSMutableArray<NSString *> *files = [NSMutableArray array];
    for (uint32_t index = 0; index < length; ++index) {
      napi_value item; napi_get_element(env, args[0], index, &item);
      NSString *file = stringArg(env, item);
      if (!file.isAbsolutePath) return invalid(env);
      [files addObject:file];
    }
    Work *task = new Work{}; task->kind = Kind::DatesAdded; task->files = files; return queue(env, task);
  }
}
static napi_value volumes(napi_env env, napi_callback_info) { Work *task = new Work{}; task->kind = Kind::Volumes; return queue(env, task); }
#include "file-information.h"
#include "file-panels.h"
static napi_value init(napi_env env, napi_value exports) {
  registerFileCoordination(env, exports);
  registerFileInformation(env, exports);
  registerFilePanels(env, exports);
  napi_property_descriptor methods[] = {
    {"trashConfirmation", nullptr, trashConfirmation, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clipboardVersion", nullptr, clipboardVersion, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clipboardRead", nullptr, clipboardRead, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clipboardWrite", nullptr, clipboardWrite, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"copyMetadata", nullptr, metadata, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"copyLinkMetadata", nullptr, linkMetadata, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"renameExclusive", nullptr, renameExclusive, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"alias", nullptr, alias, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"trash", nullptr, trash, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"volumes", nullptr, volumes, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"datesAdded", nullptr, datesAdded, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"eject", nullptr, eject, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods)/sizeof(methods[0]), methods); return exports;
}
NAPI_MODULE(viewer_macos_files, init)
