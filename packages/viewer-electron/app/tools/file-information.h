#include <sys/xattr.h>
#include <pwd.h>
#include <grp.h>
#include <unistd.h>

// Metadata I/O uses a pinned descriptor. Symlinks/devices are deliberately
// rejected; no editor can follow a replaced leaf outside its granted root.
struct InfoDescriptor {
  int fd;
  explicit InfoDescriptor(NSString *file) : fd(open(file.fileSystemRepresentation, O_EVTONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)) {}
  ~InfoDescriptor() { if (fd >= 0) close(fd); }
};
static NSString *infoRevision(const struct stat &value) {
  return [NSString stringWithFormat:@"%llu:%llu:%lld:%ld",
    (unsigned long long)value.st_dev, (unsigned long long)value.st_ino,
    (long long)value.st_ctimespec.tv_sec, value.st_ctimespec.tv_nsec];
}
static NSData *infoAttribute(int fd, const char *name, bool &supported, NSString *__strong *error, bool *readable = nullptr) {
  ssize_t size = fgetxattr(fd, name, nullptr, 0, 0, 0);
  if (size < 0) {
    if (errno == ENOATTR) return nil;
    if (errno == ENOTSUP) { supported = false; return nil; }
    if (errno == EACCES && readable) { *readable = false; return nil; }
    *error = [NSString stringWithFormat:@"Could not read file metadata: %s", std::strerror(errno)]; return nil;
  }
  if (size > 1024 * 1024) { *error = @"This file's metadata is too large to edit."; return nil; }
  NSMutableData *data = [NSMutableData dataWithLength:size];
  if (fgetxattr(fd, name, data.mutableBytes, data.length, 0, 0) != size) {
    *error = @"The file metadata changed while reading. Reload its information."; return nil;
  }
  return data;
}
static bool infoSetAttribute(int fd, const char *name, NSData *data) {
  if (data) return fsetxattr(fd, name, data.bytes, data.length, 0, 0) == 0;
  return fremovexattr(fd, name, 0) == 0 || errno == ENOATTR;
}
static NSString *infoOwner(uid_t uid) {
  struct passwd value{}, *found = nullptr; char buffer[16384];
  if (getpwuid_r(uid, &value, buffer, sizeof(buffer), &found) == 0 && found)
    return [NSString stringWithUTF8String:found->pw_name];
  return [NSString stringWithFormat:@"%u", uid];
}
static NSString *infoGroup(gid_t gid) {
  struct group value{}, *found = nullptr; char buffer[16384];
  if (getgrgid_r(gid, &value, buffer, sizeof(buffer), &found) == 0 && found)
    return [NSString stringWithUTF8String:found->gr_name];
  return [NSString stringWithFormat:@"%u", gid];
}
static NSDictionary *infoRead(int fd, NSString *file, NSString *__strong *error) {
  struct stat info{};
  if ((fd >= 0 ? fstat(fd, &info) : lstat(file.fileSystemRepresentation, &info)) != 0 || (!S_ISREG(info.st_mode) && !S_ISDIR(info.st_mode))) {
    *error = @"Choose a regular file or folder."; return nil;
  }
  bool supported = true, readable = fd >= 0;
  NSData *tagData = fd >= 0 ? infoAttribute(fd, "com.apple.metadata:_kMDItemUserTags", supported, error, &readable) : nil;
  NSData *commentData = fd >= 0 ? infoAttribute(fd, "com.apple.metadata:kMDItemFinderComment", supported, error, &readable) : nil;
  if (*error) return nil;
  id rawTags = tagData ? [NSPropertyListSerialization propertyListWithData:tagData options:NSPropertyListImmutable format:nil error:nil] : @[];
  id comment = commentData ? [NSPropertyListSerialization propertyListWithData:commentData options:NSPropertyListImmutable format:nil error:nil] : @"";
  if (![rawTags isKindOfClass:NSArray.class] || [rawTags count] > 256 || ![comment isKindOfClass:NSString.class]) {
    *error = @"The Finder metadata could not be read. Existing metadata was preserved."; return nil;
  }
  NSMutableArray *tags = [NSMutableArray array];
  for (id raw in rawTags) {
    if (![raw isKindOfClass:NSString.class]) { *error = @"A Finder tag could not be read."; return nil; }
    NSString *name = raw; NSInteger color = 0;
    NSRange line = [name rangeOfString:@"\n" options:NSBackwardsSearch];
    if (line.location != NSNotFound) {
      NSString *suffix = [name substringFromIndex:line.location + 1];
      if (suffix.length == 1 && [suffix characterAtIndex:0] >= '0' && [suffix characterAtIndex:0] <= '7') {
        color = suffix.integerValue; name = [name substringToIndex:line.location];
      }
    }
    [tags addObject:@{@"name": name, @"color": @(color)}];
  }
  NSURL *url = [NSURL fileURLWithPath:file];
  NSDictionary *resources = [url resourceValuesForKeys:@[NSURLIsPackageKey, NSURLVolumeIsReadOnlyKey, NSURLTagNamesKey, NSURLIsAliasFileKey] error:nil];
  return @{
    @"path": file, @"identity": [NSString stringWithFormat:@"%llu:%llu", (unsigned long long)info.st_dev, (unsigned long long)info.st_ino],
    @"revision": infoRevision(info), @"tags": tags, @"comment": comment,
    @"locked": @((info.st_flags & UF_IMMUTABLE) != 0), @"mode": @(info.st_mode & 0777),
    @"owner": infoOwner(info.st_uid), @"group": infoGroup(info.st_gid),
    @"allocatedSize": @((double)info.st_blocks * 512), @"package": resources[NSURLIsPackageKey] ?: @NO,
    @"readOnly": resources[NSURLVolumeIsReadOnlyKey] ?: @NO,
    @"canEdit": @((info.st_uid == geteuid() || geteuid() == 0) && ![resources[NSURLVolumeIsReadOnlyKey] boolValue]),
    @"metadataSupported": @(supported),
    @"metadataReadable": @(readable),
    @"systemTagNames": resources[NSURLTagNamesKey] ?: @[],
    @"alias": resources[NSURLIsAliasFileKey] ?: @NO,
  };
}
struct InfoWork {
  napi_async_work work; napi_deferred deferred;
  NSString *file = nil, *revision = nil, *json = nil, *result = nil, *error = nil;
};
static void infoExecute(napi_env, void *data) {
  InfoWork *task = static_cast<InfoWork *>(data);
  @autoreleasepool { @try {
    InfoDescriptor descriptor(task->file);
    if (descriptor.fd < 0 && errno != EACCES) {
      task->error = [NSString stringWithFormat:@"Could not open file information: %s", std::strerror(errno)]; return;
    }
    NSDictionary *before = infoRead(descriptor.fd, task->file, &task->error);
    if (!before) return;
    if (task->json) {
      if (![before[@"revision"] isEqualToString:task->revision]) { task->error = @"The file changed since you opened its information. Reload before saving."; return; }
      if (![before[@"canEdit"] boolValue]) { task->error = @"You do not have permission to edit this item's information."; return; }
      NSDictionary *patch = [NSJSONSerialization JSONObjectWithData:[task->json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
      if (![patch isKindOfClass:NSDictionary.class] || !patch.count) { task->error = @"Invalid file information changes."; return; }
      for (NSString *key in patch) if (![@[@"tags", @"comment", @"locked", @"mode"] containsObject:key]) { task->error = @"Unknown file information field."; return; }
      NSArray *tags = patch[@"tags"]; NSString *comment = patch[@"comment"];
      NSMutableArray *rawTags = tags ? [NSMutableArray array] : nil;
      if (tags && (![tags isKindOfClass:NSArray.class] || tags.count > 64)) { task->error = @"Choose at most 64 tags."; return; }
      NSMutableSet *names = [NSMutableSet set];
      for (id tag in tags) {
        if (![tag isKindOfClass:NSDictionary.class]) { task->error = @"Invalid Finder tag."; return; }
        NSString *name = tag[@"name"]; id color = tag[@"color"];
        if (![name isKindOfClass:NSString.class] || !name.length || name.length > 160 || [name rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound ||
          ![color isKindOfClass:NSNumber.class] || [color doubleValue] != [color integerValue] || [color integerValue] < 0 || [color integerValue] > 7 ||
          [names containsObject:name.precomposedStringWithCanonicalMapping]) { task->error = @"Choose different, non-empty tag names and valid colors."; return; }
        [names addObject:name.precomposedStringWithCanonicalMapping];
        [rawTags addObject:[NSString stringWithFormat:@"%@\n%ld", name, (long)[color integerValue]]];
      }
      if (comment && (![comment isKindOfClass:NSString.class] || comment.length > 8192 || [comment rangeOfString:[NSString stringWithFormat:@"%C", (unichar)0]].location != NSNotFound)) { task->error = @"Choose a comment of at most 8192 characters."; return; }
      id locked = patch[@"locked"], mode = patch[@"mode"];
      if (locked && CFGetTypeID((__bridge CFTypeRef)locked) != CFBooleanGetTypeID()) { task->error = @"Invalid locked status."; return; }
      if (mode && (![mode isKindOfClass:NSNumber.class] || [mode doubleValue] != [mode integerValue] || [mode integerValue] < 0 || [mode integerValue] > 0777)) { task->error = @"Invalid permissions."; return; }
      if (descriptor.fd < 0) {
        // Owners can restore permissions even when opening a read descriptor is
        // denied. Coordinate this narrow recovery; never follow a symlink leaf.
        struct stat current{};
        if (patch.count != 1 || !mode || lstat(task->file.fileSystemRepresentation, &current) != 0 ||
          (!S_ISREG(current.st_mode) && !S_ISDIR(current.st_mode)) || ![infoRevision(current) isEqualToString:task->revision]) {
          task->error = @"Restore Read permission before editing other file information."; return;
        }
        if (fchmodat(AT_FDCWD, task->file.fileSystemRepresentation, (current.st_mode & 07000) | [mode integerValue], AT_SYMLINK_NOFOLLOW) != 0) {
          task->error = [NSString stringWithFormat:@"Could not restore permissions: %s", std::strerror(errno)]; return;
        }
        descriptor.fd = open(task->file.fileSystemRepresentation, O_EVTONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC);
        NSDictionary *restored = infoRead(descriptor.fd, task->file, &task->error);
        if (restored) task->result = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:restored options:0 error:nil] encoding:NSUTF8StringEncoding];
        return;
      }
      bool supported = true;
      NSData *oldTags = tags ? infoAttribute(descriptor.fd, "com.apple.metadata:_kMDItemUserTags", supported, &task->error) : nil;
      NSData *oldComment = comment ? infoAttribute(descriptor.fd, "com.apple.metadata:kMDItemFinderComment", supported, &task->error) : nil;
      if (task->error) return;
      if (!supported && (tags || comment)) { task->error = @"This filesystem does not support Finder tags or comments."; return; }
      struct stat original{}, current{};
      if (fstat(descriptor.fd, &original) != 0 || lstat(task->file.fileSystemRepresentation, &current) != 0 ||
        current.st_dev != original.st_dev || current.st_ino != original.st_ino || ![infoRevision(original) isEqualToString:task->revision]) {
        task->error = @"The file changed while preparing its information. Reload before saving."; return;
      }
      if ((original.st_flags & UF_IMMUTABLE) && (!locked || [locked boolValue])) {
        task->error = @"Unlock the item before editing its tags, comments or permissions."; return;
      }
      NSData *newTags = tags ? [NSPropertyListSerialization dataWithPropertyList:rawTags format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil] : nil;
      NSData *newComment = comment.length ? [NSPropertyListSerialization dataWithPropertyList:comment format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil] : nil;
      bool success = true;
      if ((original.st_flags & UF_IMMUTABLE) && locked) success = fchflags(descriptor.fd, original.st_flags & ~UF_IMMUTABLE) == 0;
      if (success && tags) success = infoSetAttribute(descriptor.fd, "com.apple.metadata:_kMDItemUserTags", newTags);
      if (success && comment) success = infoSetAttribute(descriptor.fd, "com.apple.metadata:kMDItemFinderComment", newComment);
      if (success && mode) success = fchmod(descriptor.fd, (original.st_mode & 07000) | [mode integerValue]) == 0;
      if (success && locked) success = fchflags(descriptor.fd, [locked boolValue] ? original.st_flags | UF_IMMUTABLE : original.st_flags & ~UF_IMMUTABLE) == 0;
      if (!success) {
        int failure = errno;
        // Never leave a failed multi-field edit half applied. Preserve every
        // unrelated flag/attribute and report a restoration failure honestly.
        bool restored = fchflags(descriptor.fd, original.st_flags & ~UF_IMMUTABLE) == 0;
        if (tags) restored = infoSetAttribute(descriptor.fd, "com.apple.metadata:_kMDItemUserTags", oldTags) && restored;
        if (comment) restored = infoSetAttribute(descriptor.fd, "com.apple.metadata:kMDItemFinderComment", oldComment) && restored;
        if (mode) restored = fchmod(descriptor.fd, original.st_mode & 07777) == 0 && restored;
        restored = fchflags(descriptor.fd, original.st_flags) == 0 && restored;
        task->error = [NSString stringWithFormat:@"Could not save file information: %s.%@", std::strerror(failure),
          restored ? @" Original metadata was restored." : @" Some metadata could not be restored. Reload and review this item."];
        return;
      }
    }
    NSDictionary *after = infoRead(descriptor.fd, task->file, &task->error);
    if (after) task->result = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:after options:0 error:nil] encoding:NSUTF8StringEncoding];
  } @catch (NSException *error) { task->error = error.reason ?: @"Could not read file information."; } }
}
static void infoComplete(napi_env env, napi_status status, void *data) {
  InfoWork *task = static_cast<InfoWork *>(data);
  if (status != napi_ok || task->error || !task->result) {
    napi_value error; napi_create_error(env, nullptr, text(env, task->error ?: @"File information was cancelled."), &error);
    napi_reject_deferred(env, task->deferred, error);
  } else napi_resolve_deferred(env, task->deferred, text(env, task->result));
  napi_delete_async_work(env, task->work); delete task;
}
static napi_value informationWork(napi_env env, napi_callback_info info, bool update) {
  size_t count = 3; napi_value args[3]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  NSString *file = count ? stringArg(env, args[0]) : nil;
  NSString *revision = update && count == 3 ? stringArg(env, args[1]) : nil;
  NSString *json = update && count == 3 ? stringArg(env, args[2]) : nil;
  if (!file.isAbsolutePath || (update && (!revision.length || !json.length))) return invalid(env);
  InfoWork *task = new InfoWork{}; task->file = file; task->revision = revision; task->json = json;
  napi_value promise;
  if (napi_create_promise(env, &task->deferred, &promise) != napi_ok ||
    napi_create_async_work(env, nullptr, text(env, @"Viewer file information"), infoExecute, infoComplete, task, &task->work) != napi_ok) {
    delete task; napi_throw_error(env, nullptr, "Could not start file information."); return nullptr;
  }
  if (napi_queue_async_work(env, task->work) != napi_ok) {
    napi_delete_async_work(env, task->work); delete task; napi_throw_error(env, nullptr, "Could not queue file information."); return nullptr;
  }
  return promise;
}
static napi_value information(napi_env env, napi_callback_info info) { return informationWork(env, info, false); }
static napi_value updateInformation(napi_env env, napi_callback_info info) { return informationWork(env, info, true); }
static void registerFileInformation(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"information", nullptr, information, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"updateInformation", nullptr, updateInformation, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods)/sizeof(methods[0]), methods);
}
