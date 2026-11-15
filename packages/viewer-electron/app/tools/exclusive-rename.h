#pragma once
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>

namespace viewer_rename {

struct FD {
  int value = -1;
  explicit FD(int value) : value(value) {}
  ~FD() { if (value >= 0) close(value); }
  FD(const FD&) = delete;
  FD& operator=(const FD&) = delete;
};

struct Result {
  int error = 0;
  int cleanupError = 0;
};

static int exclusive(int from, const char* source, int to, const char* target) {
  return renameatx_np(from, source, to, target, RENAME_EXCL);
}

// The native regression runner supplies interleavings and retains discarded reservations.
// Production always uses the operating system calls and has no post-reservation callback.
struct System {
  int (*exclusive)(int, const char*, int, const char*) = viewer_rename::exclusive;
  int (*commit)(int, const char*, int, const char*) = ::renameat;
  int (*discard)(int, const char*, int) = ::unlinkat;
  void (*reserved)(int, const char*, bool) = nullptr;
};

static bool same(const struct stat& left, const struct stat& right) {
  return left.st_dev == right.st_dev && left.st_ino == right.st_ino &&
    (left.st_mode & S_IFMT) == (right.st_mode & S_IFMT);
}

static bool emptyDirectory(int descriptor) {
  FD reader(openat(descriptor, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  if (reader.value < 0) return false;
  const int duplicate = dup(reader.value);
  if (duplicate < 0) return false;
  DIR* directory = fdopendir(duplicate);
  if (!directory) {
    const int failure = errno;
    close(duplicate);
    errno = failure;
    return false;
  }
  bool empty = true;
  errno = 0;
  while (dirent* entry = readdir(directory)) {
    if (std::strcmp(entry->d_name, ".") && std::strcmp(entry->d_name, "..")) {
      empty = false;
      break;
    }
  }
  const int failure = errno;
  closedir(directory);
  if (!empty || failure) { errno = failure ? failure : ENOTEMPTY; return false; }
  return true;
}

static bool ownsEmpty(int parent, const char* name, int descriptor, const struct stat& owned) {
  struct stat opened{}, current{};
  if (fstat(descriptor, &opened) != 0) return false;
  if (!same(opened, owned)) { errno = EEXIST; return false; }
  if (S_ISREG(opened.st_mode)) {
    if (opened.st_size != 0 || opened.st_nlink != 1) { errno = EEXIST; return false; }
  } else if (!S_ISDIR(opened.st_mode) || !emptyDirectory(descriptor)) return false;
  // This is the last path lookup before rename or cleanup. It never follows a final link.
  if (fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) != 0) return false;
  if (!same(current, owned) || (S_ISREG(current.st_mode) && current.st_size != 0)) {
    errno = EEXIST;
    return false;
  }
  return true;
}

static Result clear(int parent, const char* name, int descriptor, const struct stat& owned,
                    int failure, const System& system) {
  struct stat opened{}, current{};
  if (descriptor >= 0) {
    if (fstat(descriptor, &opened) != 0) return {failure, errno};
    if (!same(opened, owned)) return {failure};
  }
  if (fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) != 0)
    return {failure, errno == ENOENT ? 0 : errno};
  if (!same(current, owned)) return {failure};
  const bool directory = S_ISDIR(current.st_mode);
  if (!directory) {
    if (descriptor < 0 || !S_ISREG(current.st_mode) || opened.st_size != 0 ||
        current.st_size != 0 || opened.st_nlink != 1 || current.st_nlink != 1)
      return {failure, EEXIST};
  } else if (descriptor >= 0 && !emptyDirectory(descriptor) && errno == ENOTEMPTY) {
    return {failure, ENOTEMPTY};
  }
  // Descriptor exhaustion must not strand a directory placeholder. AT_REMOVEDIR verifies
  // emptiness atomically even when enumeration cannot open a reader; it never removes contents.
  if (system.discard(parent, name, directory ? AT_REMOVEDIR : 0) != 0)
    return {failure, errno};
  return {failure};
}

static Result move(const char* source, const char* target, bool allowReservation,
                   const System& system = {}) {
  if (system.exclusive(AT_FDCWD, source, AT_FDCWD, target) == 0) return {};
  const int unsupported = errno;
  if (!allowReservation || (unsupported != ENOTSUP && unsupported != EOPNOTSUPP))
    return {unsupported};

  struct stat input{};
  if (lstat(source, &input) != 0) return {errno};
  const bool directory = S_ISDIR(input.st_mode);
  if (!directory && !S_ISREG(input.st_mode) && !S_ISLNK(input.st_mode)) return {EINVAL};
  const std::string destination(target);
  const auto separator = destination.find_last_of('/');
  if (separator == std::string::npos) return {EINVAL};
  const auto folder = destination.substr(0, separator);
  const auto name = destination.substr(separator + 1);
  if (name.empty() || name == "." || name == "..") return {EINVAL};
  FD parent(open(folder.empty() ? "/" : folder.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  if (parent.value < 0) return {errno};

  struct stat owned{};
  int descriptor = -1;
  if (directory) {
    if (mkdirat(parent.value, name.c_str(), 0700) != 0) return {errno};
    if (fstatat(parent.value, name.c_str(), &owned, AT_SYMLINK_NOFOLLOW) != 0)
      return {errno, errno};
    descriptor = openat(parent.value, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  } else {
    descriptor = openat(parent.value, name.c_str(), O_CREAT | O_EXCL | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (descriptor < 0) return {errno};
    if (fstat(descriptor, &owned) != 0) {
      const int failure = errno;
      close(descriptor);
      return {failure, failure};
    }
  }
  FD reservation(descriptor);
  int failure = 0;
  if (descriptor < 0) failure = errno;
  else {
    if (system.reserved) system.reserved(parent.value, name.c_str(), directory);
    // The exclusive creation and retained descriptor identify this empty Viewer reservation.
    // Another process can replace it between this check and rename. This unavoidable race on
    // volumes without RENAME_EXCL is accepted to publish complete content without streaming at
    // the final name; descriptor checks and synchronous adjacent syscalls minimize the window.
    if (!ownsEmpty(parent.value, name.c_str(), descriptor, owned))
      failure = errno == ENOTEMPTY ? EEXIST : errno;
    else if (system.commit(AT_FDCWD, source, parent.value, name.c_str()) == 0) return {};
    else failure = errno;
  }

  // Only our same, still-empty reservation may be discarded. A changed item is left untouched.
  return clear(parent.value, name.c_str(), descriptor, owned, failure, system);
}

}
