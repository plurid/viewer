// Every interleaving retains its displaced entries. The production recovery code has no erasure.
#include <dirent.h>
#include <fcntl.h>
#include <unistd.h>
#include <chrono>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <thread>
#include <sys/resource.h>

static bool closeOnExec = true;
static unsigned directoryReads = 0;
static DIR* checkedDirectory(int descriptor) {
  ++directoryReads;
  closeOnExec = closeOnExec && (fcntl(descriptor, F_GETFD) & FD_CLOEXEC);
  return fdopendir(descriptor);
}
#define fdopendir checkedDirectory
#include "exclusive-rename.h"
#undef fdopendir

static std::string scenario;
static std::string retained;
static std::string otherIdentity;
static int reservations = 0, commits = 0, claims = 0, restores = 0;

static int unsupported(int, const char*, int, const char*) {
  errno = scenario == "exclusive-io" ? EIO : ENOTSUP;
  return -1;
}

static void replace(int parent, const char* name, bool directory, const std::string& kind,
                    const std::string& phase) {
  if (kind != "fill") {
    const auto kept = retained + "/" + phase + " reservation";
    if (renameat(parent, name, AT_FDCWD, kept.c_str()) != 0) std::abort();
    if (kind == "folder" || kind == "folder-fill") {
      if (mkdirat(parent, name, 0700) != 0) std::abort();
    } else if (kind == "link" || kind == "dangling") {
      const auto link = retained + (kind == "link" ? "/Sentinel.txt" : "/Missing");
      if (symlinkat(link.c_str(), parent, name) != 0) std::abort();
    } else {
      viewer_rename::FD file(openat(parent, name, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0600));
      const std::string bytes = kind == "empty" ? "" : "other process content";
      if (file.value < 0 || write(file.value, bytes.data(), bytes.size()) != static_cast<ssize_t>(bytes.size())) std::abort();
    }
  }
  if (kind == "fill" || kind == "folder-fill") {
    const bool inFolder = kind == "folder-fill" || directory;
    viewer_rename::FD folder(inFolder ? openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC) : -1);
    viewer_rename::FD file(inFolder
      ? openat(folder.value, "Other.txt", O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0600)
      : openat(parent, name, O_WRONLY | O_NOFOLLOW | O_CLOEXEC));
    if (file.value < 0 || write(file.value, "other", 5) != 5) std::abort();
  }
  struct stat info{};
  if (fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW) != 0) std::abort();
  otherIdentity = viewer_rename::identity(info);
}

static void opened(int parent, const char* name, int descriptor, bool directory) {
  closeOnExec = closeOnExec && (fcntl(descriptor, F_GETFD) & FD_CLOEXEC);
  if (scenario == "opened-folder-swap" && directory && reservations == 0)
    replace(parent, name, true, "folder", "Opened");
}

static void reserved(int parent, const char* name, bool directory) {
  ++reservations;
  if (scenario == "pause") std::this_thread::sleep_for(std::chrono::milliseconds(100));
  if (scenario.rfind("swap-", 0) == 0)
    replace(parent, name, directory, scenario.substr(5), "Before check");
  if (scenario == "fill") replace(parent, name, directory, "fill", "Before check");
}

static int commit(int from, const char* source, int to, const char* target) {
  ++commits;
  if (scenario == "commit-exdev") { errno = EXDEV; return -1; }
  if (scenario == "fail" || scenario == "cleanup-fail" || scenario.rfind("cleanup-", 0) == 0) { errno = EIO; return -1; }
  return renameat(from, source, to, target);
}

static void recovering(int parent, const char* name, bool directory) {
  if (scenario.rfind("cleanup-", 0) != 0 || scenario == "cleanup-fail") return;
  auto kind = scenario.substr(8);
  for (const std::string suffix : {"-occupied", "-restore-fail", "-restore-late"})
    if (kind.size() > suffix.size() && kind.compare(kind.size() - suffix.size(), suffix.size(), suffix) == 0)
      kind.resize(kind.size() - suffix.size());
  replace(parent, name, directory, kind, "Cleanup");
}

static int claim(int from, const char* source, int to, const char* target) {
  ++claims;
  if (scenario == "cleanup-fail") { errno = EACCES; return -1; }
  return renameat(from, source, to, target);
}

static void claimed(int parent, const char* name, int, const char*) {
  if (scenario.find("-occupied") == std::string::npos) return;
  viewer_rename::FD occupant(openat(parent, name, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0600));
  if (occupant.value < 0 || write(occupant.value, "new occupant", 12) != 12) std::abort();
}

static int restore(int from, const char* source, int to, const char* target) {
  ++restores;
  if (scenario.find("-restore-late") != std::string::npos)
    replace(to, target, false, "file", "Restoration");
  if (scenario.find("-restore-") != std::string::npos) { errno = EIO; return -1; }
  return renameat(from, source, to, target);
}

int main(int count, char** args) {
  if (count != 6) return 2;
  scenario = args[4];
  retained = args[3];
  viewer_rename::System system;
  if (scenario != "native") system.exclusive = unsupported;
  system.opened = opened;
  system.reserved = reserved;
  system.commit = commit;
  system.claim = claim;
  system.recovering = recovering;
  system.claimed = claimed;
  system.restore = restore;
  if (scenario.rfind("open-fail-", 0) == 0) {
    const auto maximum = static_cast<rlim_t>(std::stoul(scenario.substr(10)));
    const rlimit limit{maximum, maximum};
    if (setrlimit(RLIMIT_NOFILE, &limit) != 0) std::abort();
  }
  const auto result = viewer_rename::move(args[1], args[2], std::string(args[5]) == "reserve", system);
  std::cout << "{\"error\":" << result.error << ",\"cleanupError\":" << result.cleanupError
    << ",\"reservations\":" << reservations << ",\"commits\":" << commits
    << ",\"claims\":" << claims << ",\"restores\":" << restores
    << ",\"discards\":0,\"unsafeDiscards\":0,\"closeOnExec\":" << (closeOnExec ? "true" : "false")
    << ",\"directoryReads\":" << directoryReads << ",\"otherIdentity\":" << std::quoted(otherIdentity)
    << ",\"entries\":[";
  bool first = true;
  for (const auto& entry : result.entries) {
    if (!first) std::cout << ',';
    first = false;
    const char* kind = entry.kind == viewer_rename::RecoveryKind::Reservation ? "reservation"
      : entry.kind == viewer_rename::RecoveryKind::Restored ? "restored" : "kept";
    std::cout << "{\"kind\":" << std::quoted(kind) << ",\"path\":" << std::quoted(entry.path)
      << ",\"identity\":" << std::quoted(viewer_rename::identity(entry.info))
      << ",\"directory\":" << (S_ISDIR(entry.info.st_mode) ? "true" : "false") << '}';
  }
  std::cout << "],\"containers\":[";
  first = true;
  for (const auto& container : result.containers) {
    if (!first) std::cout << ',';
    first = false;
    std::cout << "{\"path\":" << std::quoted(container.path) << ",\"identity\":"
      << std::quoted(viewer_rename::identity(container.info)) << '}';
  }
  std::cout << "]}\n";
  return 0;
}
