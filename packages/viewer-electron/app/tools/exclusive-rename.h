#pragma once
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>
#include <array>
#include <cstdlib>
#include <vector>

namespace viewer_rename {

struct FD {
  int value = -1;
  explicit FD(int value) : value(value) {}
  ~FD() { if (value >= 0) close(value); }
  FD(const FD&) = delete;
  FD& operator=(const FD&) = delete;
};

enum class RecoveryKind { Reservation, Kept, Restored };

struct RecoveryEntry {
  RecoveryKind kind;
  std::string path;
  struct stat info{};
};

struct RecoveryContainer {
  std::string path;
  struct stat info{};
};

struct Result {
  int error = 0;
  int cleanupError = 0;
  std::vector<RecoveryEntry> entries;
  std::vector<RecoveryContainer> containers;
  Result(int error = 0, int cleanupError = 0) : error(error), cleanupError(cleanupError) {}
};

static int exclusive(int from, const char* source, int to, const char* target) {
  return renameatx_np(from, source, to, target, RENAME_EXCL);
}

// Only the standalone test build supplies interleavings. No callback is exposed through N-API.
struct System {
  int (*exclusive)(int, const char*, int, const char*) = viewer_rename::exclusive;
  int (*commit)(int, const char*, int, const char*) = ::renameat;
  int (*claim)(int, const char*, int, const char*) = ::renameat;
  int (*restore)(int, const char*, int, const char*) = ::renameat;
  void (*opened)(int, const char*, int, bool) = nullptr;
  void (*reserved)(int, const char*, bool) = nullptr;
  void (*recovering)(int, const char*, bool) = nullptr;
  void (*claimed)(int, const char*, int, const char*) = nullptr;
};

static std::string identity(const struct stat& info) {
  return std::to_string(static_cast<unsigned long long>(info.st_dev)) + ":" +
    std::to_string(static_cast<unsigned long long>(info.st_ino));
}

static bool same(const struct stat& left, const struct stat& right) {
  return left.st_dev == right.st_dev && left.st_ino == right.st_ino &&
    (left.st_mode & S_IFMT) == (right.st_mode & S_IFMT);
}

static bool emptyDirectory(int descriptor) {
  FD reader(openat(descriptor, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  if (reader.value < 0) return false;
  const int duplicate = fcntl(reader.value, F_DUPFD_CLOEXEC, 0);
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
  } else {
    if (!S_ISDIR(opened.st_mode)) { errno = EEXIST; return false; }
    if (!emptyDirectory(descriptor)) return false;
  }
  // This is the last path lookup before publication. It never follows a final link.
  if (fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) != 0) return false;
  if (!same(current, owned) || (S_ISREG(current.st_mode) && current.st_size != 0)) {
    errno = EEXIST;
    return false;
  }
  return true;
}

struct Reservation {
  FD descriptor{-1};
  struct stat info{};
  bool created = false;
  bool known = false;
};

static int reserve(int parent, const char* name, bool directory, Reservation& reservation,
                   const System& system) {
  if (directory) {
    if (mkdirat(parent, name, 0700) != 0) return errno;
    reservation.created = true;
    reservation.descriptor.value = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  } else {
    reservation.descriptor.value = openat(parent, name, O_CREAT | O_EXCL | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
    reservation.created = reservation.descriptor.value >= 0;
  }
  if (reservation.descriptor.value < 0) return errno;
  if (system.opened) system.opened(parent, name, reservation.descriptor.value, directory);
  // A path lookup after mkdir can identify a replacement. The retained no-follow descriptor
  // binds the folder identity used by publication and by recovery instead.
  if (fstat(reservation.descriptor.value, &reservation.info) != 0) return errno;
  reservation.known = true;
  return 0;
}

static std::string privateName() {
  std::array<unsigned char, 16> bytes{};
  arc4random_buf(bytes.data(), bytes.size());
  static const char digits[] = "0123456789abcdef";
  std::string name = ".viewer-rename-";
  for (const auto byte : bytes) {
    name += digits[byte >> 4];
    name += digits[byte & 15];
  }
  return name;
}

static void capture(Result& result, int parent, const char* name, const std::string& original,
                    const std::string& captured,
                    int holder, const char* child, const Reservation& reservation,
                    const System& system) {
  if (system.claim(parent, name, holder, child) != 0) {
    const int failure = errno;
    if (failure != ENOENT) {
      result.cleanupError = failure;
      result.entries.push_back({RecoveryKind::Kept, original});
    }
    return;
  }
  if (reservation.known && ownsEmpty(holder, child, reservation.descriptor.value, reservation.info))
    result.entries.push_back({RecoveryKind::Reservation, captured, reservation.info});
  else result.entries.push_back({RecoveryKind::Kept, captured});
}

static bool restore(int holder, const char* item, int parent, const char* name,
                    const std::string& destination, const std::string& holding,
                    Result& result, const System& system) {
  if (system.exclusive(holder, item, parent, name) == 0) return true;
  if (errno != ENOTSUP && errno != EOPNOTSUPP) { result.cleanupError = errno; return false; }
  struct stat source{};
  if (fstatat(holder, item, &source, AT_SYMLINK_NOFOLLOW) != 0) {
    result.cleanupError = errno;
    return false;
  }
  Reservation reservation;
  int failure = reserve(parent, name, S_ISDIR(source.st_mode), reservation, system);
  if (!failure) {
    if (!ownsEmpty(parent, name, reservation.descriptor.value, reservation.info)) failure = errno;
    else if (system.restore(holder, item, parent, name) == 0) return true;
    else failure = errno;
  }
  result.cleanupError = failure;
  if (reservation.created) {
    const char* child = "restore-reservation";
    // Recovery is bounded: a second racing entry is retained and reported, never chased by an
    // unbounded series of moves or passed to the Trash without proof that it is our empty entry.
    capture(result, parent, name, destination, holding + "/" + child, holder, child, reservation, system);
    struct stat remaining{};
    if (fstatat(parent, name, &remaining, AT_SYMLINK_NOFOLLOW) == 0)
      result.entries.push_back({RecoveryKind::Kept, destination});
  }
  return false;
}

static Result recover(int parent, const char* name, const std::string& folder,
                      const Reservation& reservation, int failure, const System& system) {
  Result result{failure};
  const std::string destination = folder + "/" + name;
  std::string hidden;
  for (int attempt = 0; attempt < 8; ++attempt) {
    hidden = privateName();
    if (mkdirat(parent, hidden.c_str(), 0700) == 0) break;
    if (errno != EEXIST || attempt == 7) {
      result.cleanupError = errno;
      result.entries.push_back({RecoveryKind::Kept, destination});
      return result;
    }
  }
  const std::string holding = folder + "/" + hidden;
  FD holder(openat(parent, hidden.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  struct stat holderInfo{};
  if (holder.value < 0 || fstat(holder.value, &holderInfo) != 0) {
    result.cleanupError = errno;
    result.entries.push_back({RecoveryKind::Kept, destination});
    result.entries.push_back({RecoveryKind::Kept, holding});
    return result;
  }
  result.containers.push_back({holding, holderInfo});
  if (system.recovering) system.recovering(parent, name, S_ISDIR(reservation.info.st_mode));
  // The public name is never a disposal target. Claim whatever is there before inspecting it:
  // a competing writer can change that name at any instant, but this move destroys no content.
  if (system.claim(parent, name, holder.value, "item") != 0) {
    if (errno != ENOENT) {
      result.cleanupError = errno;
      result.entries.push_back({RecoveryKind::Kept, destination});
    }
    return result;
  }
  if (system.claimed) system.claimed(parent, name, holder.value, "item");
  const std::string captured = holding + "/item";
  if (reservation.known && ownsEmpty(holder.value, "item", reservation.descriptor.value, reservation.info)) {
    result.entries.push_back({RecoveryKind::Reservation, captured, reservation.info});
  } else if (!reservation.known) {
    result.entries.push_back({RecoveryKind::Kept, captured});
  } else if (restore(holder.value, "item", parent, name, destination, holding, result, system)) {
    result.entries.push_back({RecoveryKind::Restored, destination});
  } else result.entries.push_back({RecoveryKind::Kept, captured});
  return result;
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

  Reservation reservation;
  int failure = reserve(parent.value, name.c_str(), directory, reservation, system);
  if (failure && !reservation.created) return {failure};
  if (failure) return recover(parent.value, name.c_str(), folder, reservation, failure, system);
  else {
    if (system.reserved) system.reserved(parent.value, name.c_str(), directory);
    // The exclusive creation and retained descriptor identify this empty Viewer reservation.
    // A file, empty file, link, empty folder or bytes written into this reservation after the
    // final check can be overwritten by rename: that entry's content is lost. A non-empty folder
    // or file/folder type mismatch makes rename fail and is kept. This race also applies to
    // restoration. It is accepted because exFAT lacks exclusive rename and hard links; adjacent
    // synchronous checks and rename minimize the window while publishing complete content.
    if (!ownsEmpty(parent.value, name.c_str(), reservation.descriptor.value, reservation.info))
      failure = errno == ENOTEMPTY ? EEXIST : errno;
    else if (system.commit(AT_FDCWD, source, parent.value, name.c_str()) == 0) return {};
    else failure = errno;
  }

  return recover(parent.value, name.c_str(), folder, reservation, failure, system);
}

}
