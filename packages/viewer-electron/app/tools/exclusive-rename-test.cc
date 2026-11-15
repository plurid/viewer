// Runs the production reservation algorithm with deterministic filesystem interleavings.
// Discarding a verified reservation moves it into the retained fixture, never deletes it.
#include "exclusive-rename.h"
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <thread>
#include <sys/resource.h>

static std::string scenario;
static std::string retained;
static int reservations = 0, commits = 0, discards = 0;

static int unsupported(int, const char*, int, const char*) {
  errno = scenario == "exclusive-io" ? EIO : ENOTSUP;
  return -1;
}

static void reserved(int parent, const char* name, bool directory) {
  ++reservations;
  if (scenario == "pause") std::this_thread::sleep_for(std::chrono::milliseconds(100));
  if (scenario.rfind("swap-", 0) == 0) {
    const auto kept = retained + "/Reservation";
    if (renameat(parent, name, AT_FDCWD, kept.c_str()) != 0) std::abort();
    if (scenario == "swap-folder") {
      if (mkdirat(parent, name, 0700) != 0) std::abort();
    } else if (scenario == "swap-link" || scenario == "swap-dangling") {
      const auto link = retained + (scenario == "swap-link" ? "/Sentinel.txt" : "/Missing");
      if (symlinkat(link.c_str(), parent, name) != 0) std::abort();
    } else {
      viewer_rename::FD file(openat(parent, name, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600));
      if (file.value < 0 || write(file.value, "other", 5) != 5) std::abort();
    }
  }
  if (scenario == "fill") {
    viewer_rename::FD folder(directory ? openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW) : -1);
    viewer_rename::FD file(directory
      ? openat(folder.value, "Other.txt", O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600)
      : openat(parent, name, O_WRONLY | O_NOFOLLOW));
    if (file.value < 0 || write(file.value, "other", 5) != 5) std::abort();
  }
}

static int commit(int from, const char* source, int to, const char* target) {
  ++commits;
  if (scenario == "fail" || scenario == "cleanup-fail") { errno = EIO; return -1; }
  return renameat(from, source, to, target);
}

static int discard(int parent, const char* name, int flags) {
  if (scenario == "cleanup-fail") { errno = EACCES; return -1; }
  struct stat info{};
  if (fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW) != 0 ||
      (flags == AT_REMOVEDIR ? !S_ISDIR(info.st_mode) : !S_ISREG(info.st_mode) || info.st_size != 0))
    std::abort();
  ++discards;
  const auto kept = retained + "/Discarded reservation";
  return renameat(parent, name, AT_FDCWD, kept.c_str());
}

int main(int count, char** args) {
  if (count != 6) return 2;
  scenario = args[4];
  retained = args[3];
  viewer_rename::System system;
  if (scenario != "native") system.exclusive = unsupported;
  system.reserved = reserved;
  system.commit = commit;
  system.discard = discard;
  if (scenario.rfind("open-fail-", 0) == 0) {
    const auto maximum = static_cast<rlim_t>(std::stoul(scenario.substr(10)));
    const rlimit limit{maximum, maximum};
    if (setrlimit(RLIMIT_NOFILE, &limit) != 0) std::abort();
  }
  const auto result = viewer_rename::move(args[1], args[2], std::string(args[5]) == "reserve", system);
  std::cout << "{\"error\":" << result.error << ",\"cleanupError\":" << result.cleanupError
    << ",\"reservations\":" << reservations << ",\"commits\":" << commits
    << ",\"discards\":" << discards << "}\n";
  return 0;
}
