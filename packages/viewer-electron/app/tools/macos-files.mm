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
#include <sys/clonefile.h>
#include <stdio.h>
#include <fcntl.h>
#include <algorithm>
#include <sys/attr.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/acl.h>
#include <membership.h>
#include <grp.h>
#include <pwd.h>
#include <vector>
#include <array>

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
#include "file-review.h"
#include "exclusive-rename.h"

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

enum class Kind { Metadata, LinkMetadata, Rename, Trash, Volumes, Eject, Alias, DatesAdded, Clone, HiddenFolder, HiddenFile, GuestACL };
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
  bool hidden = false;
  bool allowReservation = false;
  bool deferRestrictions = false;
  bool cloneDeferred = false;
  viewer_rename::Result renameResult;
  NSArray<NSDictionary *> *volumes = nil;
  NSArray<NSString *> *files = nil;
  NSArray<NSDictionary *> *dates = nil;
  std::optional<ReviewedFileVersion> reviewed;
};
// One bulk walk avoids a second per-item syscall from JavaScript during a large listing.
static NSArray<NSString *> *hiddenNames(NSString *folder, int *failure) {
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  int descriptor = open(folder.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (descriptor < 0) { *failure = errno; return nil; }
  struct attrlist attributes{};
  attributes.bitmapcount = ATTR_BIT_MAP_COUNT;
  attributes.commonattr = ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_NAME | ATTR_CMN_FLAGS;
  struct __attribute__((packed, aligned(4))) Record {
    uint32_t length;
    attribute_set_t returned;
    attrreference_t name;
    uint32_t flags;
  };
  alignas(8) char buffer[64 * 1024];
  bool fallback = false;
  for (;;) {
    int count = getattrlistbulk(descriptor, &attributes, buffer, sizeof(buffer), FSOPT_PACK_INVAL_ATTRS);
    if (count < 0) {
      if (errno == ENOTSUP || errno == EINVAL || errno == ENOSYS) fallback = true;
      else *failure = errno;
      break;
    }
    if (!count) break;
    size_t offset = 0;
    for (int index = 0; index < count; ++index) {
      if (offset + sizeof(uint32_t) > sizeof(buffer)) { *failure = EIO; break; }
      const Record *record = reinterpret_cast<const Record *>(buffer + offset);
      if (record->length < sizeof(uint32_t) || record->length > sizeof(buffer) - offset) { *failure = EIO; break; }
      if (record->length < sizeof(Record) || !(record->returned.commonattr & ATTR_CMN_NAME)) { offset += record->length; continue; }
      int64_t nameOffset = offsetof(Record, name) + (int64_t)record->name.attr_dataoffset;
      size_t nameLength = record->name.attr_length;
      if (nameOffset < (int64_t)sizeof(Record) || !nameLength ||
          (uint64_t)nameOffset + nameLength > record->length) { offset += record->length; continue; }
      const char *name = buffer + offset + nameOffset;
      if (name[nameLength - 1] != '\0' || strnlen(name, nameLength) != nameLength - 1 || strchr(name, '/')) { offset += record->length; continue; }
      uint32_t flags = record->flags;
      if (!(record->returned.commonattr & ATTR_CMN_FLAGS)) {
        struct stat info{};
        if (fstatat(descriptor, name, &info, AT_SYMLINK_NOFOLLOW) != 0) {
          offset += record->length; continue;
        }
        flags = info.st_flags;
      }
      if (flags & UF_HIDDEN) {
        NSString *value = [NSFileManager.defaultManager stringWithFileSystemRepresentation:name length:nameLength - 1];
        if (value) [names addObject:value];
      }
      offset += record->length;
    }
    if (*failure) break;
  }
  if (fallback) {
    // Filesystems without bulk attributes still use the flag, never a filename guess.
    close(descriptor);
    DIR *directory = opendir(folder.fileSystemRepresentation);
    if (!directory) { *failure = errno; return nil; }
    [names removeAllObjects];
    for (;;) {
      errno = 0;
      struct dirent *item = readdir(directory);
      if (!item) { if (errno) *failure = errno; break; }
      if (!strcmp(item->d_name, ".") || !strcmp(item->d_name, "..")) continue;
      struct stat info{};
      if (fstatat(dirfd(directory), item->d_name, &info, AT_SYMLINK_NOFOLLOW) != 0) {
        continue;
      }
      if (info.st_flags & UF_HIDDEN) {
        NSString *value = [NSFileManager.defaultManager stringWithFileSystemRepresentation:item->d_name length:strlen(item->d_name)];
        if (value) [names addObject:value];
      }
    }
    closedir(directory);
  } else close(descriptor);
  return *failure ? nil : names;
}
#include "guest-access.h"
static void execute(napi_env, void *data) {
  Work *task = static_cast<Work *>(data);
  @autoreleasepool { @try {
    NSError *error = nil;
    if (task->kind == Kind::GuestACL) {
      task->result = guestACLState(task->file);
    } else if (task->kind == Kind::HiddenFolder) {
      task->files = hiddenNames(task->file, &task->errorNumber);
      if (!task->files) task->error = @"Could not read hidden file flags.";
    } else if (task->kind == Kind::HiddenFile) {
      struct stat info{};
      if (lstat(task->file.fileSystemRepresentation, &info) != 0) {
        task->errorNumber = errno; task->error = @"Could not read the hidden file flag.";
      } else task->hidden = (info.st_flags & UF_HIDDEN) != 0;
    } else if (task->kind == Kind::DatesAdded) {
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
    } else if (task->kind == Kind::Clone) {
      // An APFS clone shares the source's blocks until either changes. When staging a root item
      // that will be renamed out of its private stage, defer ACLs and rename-blocking flags until
      // after publication so immutable or deny-delete sources can be published cleanly.
      bool defer = false;
      bool inspected = true;
      if (task->deferRestrictions) {
        struct stat sourceStat{};
        if (fstat(task->source, &sourceStat) != 0) {
          task->errorNumber = errno;
          task->error = [NSString stringWithFormat:@"Could not inspect the file before cloning: %s", std::strerror(errno)];
          inspected = false;
        } else {
          acl_t acl = acl_get_fd_np(task->source, ACL_TYPE_EXTENDED);
          bool hasACL = false;
          if (acl) {
            acl_entry_t entry{};
            hasACL = acl_get_entry(acl, ACL_FIRST_ENTRY, &entry) == 0;
            acl_free(acl);
          }
          defer = hasACL || (sourceStat.st_flags & (UF_IMMUTABLE | UF_APPEND)) != 0;
        }
      }
      if (inspected) {
        const uint32_t cloneFlags = defer
          ? (CLONE_NOFOLLOW | CLONE_NOOWNERCOPY)
          : (CLONE_NOFOLLOW | CLONE_NOOWNERCOPY | CLONE_ACL);
        if (fclonefileat(task->source, AT_FDCWD, task->targetFile.fileSystemRepresentation, cloneFlags) != 0) {
          task->errorNumber = errno;
          task->error = [NSString stringWithFormat:@"Could not clone the file: %s", std::strerror(errno)];
        } else if (defer) {
          int fd = open(task->targetFile.fileSystemRepresentation, O_EVTONLY | O_NOFOLLOW | O_CLOEXEC);
          if (fd < 0) {
            task->errorNumber = errno;
            task->error = [NSString stringWithFormat:@"Could not prepare the staged clone: %s", std::strerror(errno)];
          } else {
            struct stat clonedStat{};
            if (fstat(fd, &clonedStat) != 0) {
              task->errorNumber = errno;
              task->error = [NSString stringWithFormat:@"Could not inspect the staged clone: %s", std::strerror(errno)];
            } else if ((clonedStat.st_flags & (UF_IMMUTABLE | UF_APPEND)) != 0 &&
              fchflags(fd, clonedStat.st_flags & ~(UF_IMMUTABLE | UF_APPEND)) != 0) {
              task->errorNumber = errno;
              task->error = [NSString stringWithFormat:@"Could not unlock the staged clone: %s", std::strerror(errno)];
            } else if ((clonedStat.st_mode & (S_IRUSR | S_IWUSR)) != (S_IRUSR | S_IWUSR) &&
              fchmod(fd, (clonedStat.st_mode & 07777) | S_IRUSR | S_IWUSR) != 0) {
              task->errorNumber = errno;
              task->error = [NSString stringWithFormat:@"Could not make the staged clone writable for metadata restoration: %s", std::strerror(errno)];
            } else {
              task->cloneDeferred = true;
            }
            close(fd);
          }
        }
      }
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
        const auto moved = viewer_rename::move(from.fileSystemRepresentation, to.fileSystemRepresentation, task->allowReservation);
        task->renameResult = moved;
        if (moved.error) {
          task->errorNumber = moved.error;
          task->error = [NSString stringWithFormat:@"Could not move the item: %s", std::strerror(moved.error)];
          if (moved.cleanupError)
            task->error = [task->error stringByAppendingFormat:@". Recovery could not finish: %s", std::strerror(moved.cleanupError)];
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
        ReviewedFileHandle reviewed;
        NSString *reviewError = nil;
        if (task->reviewed && !reviewed.matches(url, *task->reviewed, &reviewError)) {
          task->error = reviewError;
          task->errorNumber = ESTALE;
          return;
        }
        NSURL *result = nil; NSError *trashError = nil;
        if (![NSFileManager.defaultManager trashItemAtURL:url resultingItemURL:&result error:&trashError]) {
          task->error = trashError.localizedDescription ?: @"The item could not be moved to Trash.";
          // A volume without a Trash, as many network shares are. Only this failure is ENOTSUP.
          if ([trashError.domain isEqualToString:NSCocoaErrorDomain] && trashError.code == NSFeatureUnsupportedError) task->errorNumber = ENOTSUP;
        } else {
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
        bool ignoreOwnership = false;
        if (![url.path isEqualToString:@"/"]) {
          struct statfs volume{};
          if (statfs(url.fileSystemRepresentation, &volume) == 0) {
            ignoreOwnership = (volume.f_flags & MNT_IGNORE_OWNERSHIP) != 0 ||
              std::strcmp(volume.f_fstypename, "exfat") == 0 ||
              std::strcmp(volume.f_fstypename, "msdos") == 0;
          }
        }
        [volumes addObject:@{
          @"path": url.path, @"name": values[NSURLVolumeNameKey] ?: url.lastPathComponent,
          @"total": values[NSURLVolumeTotalCapacityKey] ?: @0,
          @"available": values[NSURLVolumeAvailableCapacityKey] ?: @0,
          @"removable": values[NSURLVolumeIsRemovableKey] ?: @NO,
          @"ejectable": values[NSURLVolumeIsEjectableKey] ?: @NO,
          @"readOnly": values[NSURLVolumeIsReadOnlyKey] ?: @NO,
          @"ignoreOwnership": @(ignoreOwnership)
        }];
      }
      task->volumes = volumes;
    }
  } @catch (NSException *error) { task->error = error.reason ?: @"macOS file service failed."; } }
}
static napi_value renameRecovery(napi_env env, const viewer_rename::Result& recovery) {
  napi_value result, entries, containers;
  napi_create_object(env, &result);
  napi_create_array(env, &entries);
  napi_create_array(env, &containers);
  uint32_t index = 0;
  for (const auto& entry : recovery.entries) {
    napi_value item; napi_create_object(env, &item);
    const char* kind = entry.kind == viewer_rename::RecoveryKind::Reservation ? "reservation"
      : entry.kind == viewer_rename::RecoveryKind::Restored ? "restored" : "kept";
    property(env, item, "kind", text(env, [NSString stringWithUTF8String:kind]));
    property(env, item, "path", text(env, [NSString stringWithUTF8String:entry.path.c_str()]));
    if (entry.kind == viewer_rename::RecoveryKind::Reservation) {
      property(env, item, "identity", text(env, [NSString stringWithUTF8String:viewer_rename::identity(entry.info).c_str()]));
      property(env, item, "directory", boolean(env, S_ISDIR(entry.info.st_mode)));
    }
    napi_set_element(env, entries, index++, item);
  }
  index = 0;
  for (const auto& container : recovery.containers) {
    napi_value item; napi_create_object(env, &item);
    property(env, item, "path", text(env, [NSString stringWithUTF8String:container.path.c_str()]));
    property(env, item, "identity", text(env, [NSString stringWithUTF8String:viewer_rename::identity(container.info).c_str()]));
    napi_set_element(env, containers, index++, item);
  }
  property(env, result, "entries", entries);
  property(env, result, "containers", containers);
  return result;
}
static void complete(napi_env env, napi_status status, void *data) {
  Work *task = static_cast<Work *>(data);
  if (status != napi_ok || task->error) {
    NSString* message = task->error ?: @"macOS file work was cancelled.";
    const bool recovery = !task->renameResult.entries.empty() || !task->renameResult.containers.empty();
    if (recovery) {
      for (const auto& entry : task->renameResult.entries)
        message = [message stringByAppendingFormat:@". Recovery path: %@", [NSString stringWithUTF8String:entry.path.c_str()]];
      for (const auto& container : task->renameResult.containers)
        message = [message stringByAppendingFormat:@". Recovery folder: %@", [NSString stringWithUTF8String:container.path.c_str()]];
    }
    napi_value error; napi_create_error(env, nullptr, text(env, message), &error);
    if (recovery) {
      property(env, error, "renameMessage", text(env, task->error));
      property(env, error, "renameRecovery", renameRecovery(env, task->renameResult));
    }
    if (task->errorNumber) {
      const char *code = task->errorNumber == EACCES ? "EACCES" : task->errorNumber == EPERM ? "EPERM" : task->errorNumber == ENOTDIR ? "ENOTDIR" : task->errorNumber == EXDEV ? "EXDEV" : task->errorNumber == EEXIST ? "EEXIST" : task->errorNumber == ENOENT ? "ENOENT" : task->errorNumber == EBUSY ? "EBUSY" : task->errorNumber == ENOTSUP ? "ENOTSUP" : task->errorNumber == EOPNOTSUPP ? "EOPNOTSUPP" : task->errorNumber == EINVAL ? "EINVAL" : task->errorNumber == ENOSYS ? "ENOSYS" : "EIO";
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
        for (NSString *key in @[@"removable", @"ejectable", @"readOnly", @"ignoreOwnership"]) property(env, item, key.UTF8String, boolean(env, [volume[key] boolValue]));
        napi_set_element(env, result, index++, item);
      }
    }
    if (task->kind == Kind::Clone && task->deferRestrictions) result = boolean(env, task->cloneDeferred);
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
    if (task->kind == Kind::HiddenFile) result = boolean(env, task->hidden);
    if (task->kind == Kind::GuestACL) result = text(env, task->result);
    if (task->kind == Kind::HiddenFolder) {
      napi_create_array(env, &result); uint32_t index = 0;
      for (NSString *name in task->files) napi_set_element(env, result, index++, text(env, name));
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
static napi_value clone(napi_env env, napi_callback_info info) {
  size_t count = 3; napi_value args[3]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  int32_t source;
  NSString *target = count >= 2 ? stringArg(env, args[1]) : nil;
  if (count < 2 || count > 3 || napi_get_value_int32(env, args[0], &source) != napi_ok || source < 0 || !target.isAbsolutePath) return invalid(env);
  bool deferRestrictions = false;
  if (count == 3) {
    napi_valuetype type;
    if (napi_typeof(env, args[2], &type) != napi_ok) return invalid(env);
    if (type != napi_undefined && napi_get_value_bool(env, args[2], &deferRestrictions) != napi_ok) return invalid(env);
  }
  Work *task = new Work{}; task->kind = Kind::Clone; task->source = source; task->targetFile = target; task->deferRestrictions = deferRestrictions; return queue(env, task);
}
static napi_value fileWork(napi_env env, napi_callback_info info, Kind kind) {
  size_t count = 3; napi_value args[3]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *file = count >= 1 ? stringArg(env, args[0]) : nil;
  if (!file.isAbsolutePath) return invalid(env);
  Work *task = new Work{};
  task->kind = kind;
  task->file = file;
  task->purpose = count > 1 ? stringArg(env, args[1]) : nil;
  if (kind == Kind::Trash && count > 2) {
    napi_valuetype type;
    if (napi_typeof(env, args[2], &type) != napi_ok) {
      delete task;
      return invalid(env);
    }
    if (type != napi_undefined) {
      ReviewedFileVersion expected;
      if (!readReviewedFileVersion(env, args[2], expected)) {
        delete task;
        return invalid(env);
      }
      task->reviewed = expected;
    }
  }
  return queue(env, task);
}
static napi_value trash(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::Trash); }
static napi_value pairWork(napi_env env, napi_callback_info info, Kind kind) {
  size_t count = 4; napi_value args[4]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *source = count >= 2 ? stringArg(env, args[0]) : nil;
  NSString *target = count >= 2 ? stringArg(env, args[1]) : nil;
  if (!source.isAbsolutePath || !target.isAbsolutePath) return invalid(env);
  bool allowReservation = false;
  if (kind == Kind::Rename && count > 3 && napi_get_value_bool(env, args[3], &allowReservation) != napi_ok) return invalid(env);
  Work *task = new Work{}; task->kind = kind; task->file = source; task->targetFile = target; task->purpose = count > 2 ? stringArg(env, args[2]) : nil; task->allowReservation = allowReservation; return queue(env, task);
}
static napi_value linkMetadata(napi_env env, napi_callback_info info) { return pairWork(env, info, Kind::LinkMetadata); }
static napi_value renameExclusive(napi_env env, napi_callback_info info) { return pairWork(env, info, Kind::Rename); }
static napi_value alias(napi_env env, napi_callback_info info) { return pairWork(env, info, Kind::Alias); }
static napi_value eject(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::Eject); }
static napi_value hiddenEntries(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::HiddenFolder); }
static napi_value fileHidden(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::HiddenFile); }
static napi_value guestACL(napi_env env, napi_callback_info info) { return fileWork(env, info, Kind::GuestACL); }
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
static napi_value sharingMounts(napi_env env, napi_callback_info) {
  @autoreleasepool {
  struct statfs *mounts = nullptr;
  // Cached kernel mount data must not ask a sleeping or disconnected filesystem for metadata.
  int count = getmntinfo(&mounts, MNT_NOWAIT);
  if (count <= 0 || count > 2048) {
    napi_throw_error(env, nullptr, "Could not read mounted filesystems.");
    return nullptr;
  }
  napi_value result;
  napi_create_array_with_length(env, count, &result);
  for (int index = 0; index < count; ++index) {
    napi_value item;
    napi_create_object(env, &item);
    NSString *mount = [NSFileManager.defaultManager stringWithFileSystemRepresentation:mounts[index].f_mntonname length:strlen(mounts[index].f_mntonname)];
    if (!mount.isAbsolutePath) {
      napi_throw_error(env, nullptr, "Could not decode a mounted filesystem path.");
      return nullptr;
    }
    property(env, item, "path", text(env, mount));
    property(env, item, "local", boolean(env, (mounts[index].f_flags & MNT_LOCAL) != 0));
    napi_set_element(env, result, index, item);
  }
  return result;
  }
}
static napi_value volumes(napi_env env, napi_callback_info) { Work *task = new Work{}; task->kind = Kind::Volumes; return queue(env, task); }
#include "file-information.h"
#include "file-panels.h"
#include "pdf-printing.h"
#include "window-fullscreen.h"
#include "quarantine.h"
#include "remote-prompt.h"
static napi_value init(napi_env env, napi_value exports) {
  registerFileCoordination(env, exports);
  registerFileInformation(env, exports);
  registerFilePanels(env, exports);
  registerPDFPrinting(env, exports);
  registerWindowFullscreen(env, exports);
  registerQuarantine(env, exports);
  registerRemotePrompt(env, exports);
  napi_property_descriptor methods[] = {
    {"renameRecoveryVersion", nullptr, nullptr, nullptr, nullptr, number(env, 1), napi_default, nullptr},
    {"cloneStageVersion", nullptr, nullptr, nullptr, nullptr, number(env, 1), napi_default, nullptr},
    {"trashConfirmation", nullptr, trashConfirmation, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clipboardVersion", nullptr, clipboardVersion, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clipboardRead", nullptr, clipboardRead, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clipboardWrite", nullptr, clipboardWrite, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"copyMetadata", nullptr, metadata, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"clone", nullptr, clone, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"copyLinkMetadata", nullptr, linkMetadata, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"renameExclusive", nullptr, renameExclusive, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"alias", nullptr, alias, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"trash", nullptr, trash, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"volumes", nullptr, volumes, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"datesAdded", nullptr, datesAdded, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"hiddenEntries", nullptr, hiddenEntries, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"fileHidden", nullptr, fileHidden, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"guestACL", nullptr, guestACL, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"sharingMounts", nullptr, sharingMounts, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"eject", nullptr, eject, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods)/sizeof(methods[0]), methods); return exports;
}
NAPI_MODULE(viewer_macos_files, init)
