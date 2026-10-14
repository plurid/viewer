// macOS Trash erasure belongs exclusively to the native confirmation's result.
// No erasure function, approval token or confirmation response is exported to JS.
#include <dirent.h>
#include <unistd.h>
#include <pwd.h>
#include <vector>
#include <memory>
#include <stdexcept>
#include <cmath>

namespace viewer_trash {
struct FD {
  int value;
  explicit FD(int value) : value(value) { if (value < 0) throw std::runtime_error("Trash could not be opened safely."); }
  ~FD() { close(value); }
  FD(const FD&) = delete;
};
struct Node {
  std::string name;
  struct stat version;
  std::vector<Node> children;
};
struct Root {
  std::string path;
  std::shared_ptr<FD> fd;
  struct stat version;
  std::vector<Node> children;
};
static bool busy = false;
static bool identity(const struct stat& a, const struct stat& b) {
  return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_mode == b.st_mode && a.st_uid == b.st_uid && a.st_gid == b.st_gid;
}
static bool version(const struct stat& a, const struct stat& b) {
  return identity(a, b) && a.st_size == b.st_size &&
    a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
    a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
}
static std::string identifier(const struct stat& info) {
  return std::to_string((uint64_t)info.st_dev) + ":" + std::to_string((uint64_t)info.st_ino);
}
static std::vector<std::string> names(int fd, bool root = false) {
  // A fresh open file description: dup() would share and advance the directory offset.
  FD copy(openat(fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  int duplicate = dup(copy.value);
  if (duplicate < 0) throw std::runtime_error("Trash contents could not be read.");
  DIR* directory = fdopendir(duplicate);
  if (!directory) { close(duplicate); throw std::runtime_error("Trash contents could not be read."); }
  std::vector<std::string> output;
  errno = 0;
  while (auto* item = readdir(directory)) {
    std::string name(item->d_name);
    if (name == "." || name == ".." || (root && name == ".DS_Store")) continue;
    output.push_back(name);
    if (output.size() > 100000) { closedir(directory); throw std::runtime_error("Trash is too large to review safely in Viewer."); }
  }
  int error = errno;
  closedir(directory);
  if (error) throw std::runtime_error("Trash contents changed or could not be read.");
  std::sort(output.begin(), output.end());
  return output;
}
static struct stat info(int parent, const std::string& name) {
  struct stat output{};
  if (fstatat(parent, name.c_str(), &output, AT_SYMLINK_NOFOLLOW))
    throw std::runtime_error("An item in Trash changed or could not be read.");
  return output;
}
static Node inspect(int parent, const std::string& name, dev_t device, size_t& count, unsigned depth) {
  if (++count > 100000 || depth > 64) throw std::runtime_error("Trash is too large or deep to review safely in Viewer.");
  Node node{name, info(parent, name), {}};
  if (node.version.st_dev != device) throw std::runtime_error("A mounted filesystem was found inside Trash. Nothing was erased.");
  if (S_ISDIR(node.version.st_mode)) {
    FD directory(openat(parent, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
    struct stat opened{};
    if (fstat(directory.value, &opened) || !version(node.version, opened)) throw std::runtime_error("A folder in Trash changed.");
    for (const auto& child : names(directory.value)) node.children.push_back(inspect(directory.value, child, device, count, depth + 1));
    if (!version(node.version, info(parent, name))) throw std::runtime_error("A folder in Trash changed while being reviewed.");
  }
  return node;
}
static void unchanged(int parent, const Node& node) {
  if (!version(node.version, info(parent, node.name))) throw std::runtime_error("Trash changed after review. Open Trash again before emptying it.");
  if (!S_ISDIR(node.version.st_mode)) return;
  FD directory(openat(parent, node.name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  const auto current = names(directory.value);
  if (current.size() != node.children.size()) throw std::runtime_error("A folder in Trash changed after review.");
  for (size_t i = 0; i < current.size(); ++i) {
    if (current[i] != node.children[i].name) throw std::runtime_error("A folder in Trash changed after review.");
    unchanged(directory.value, node.children[i]);
  }
}
static void stillInside(const Root& root, int fd) {
  struct stat current{};
  if (lstat(root.path.c_str(), &current) || !identity(root.version, current)) throw std::runtime_error("The Trash location changed.");
  char actual[PATH_MAX];
  if (fcntl(fd, F_GETPATH, actual)) throw std::runtime_error("The Trash location could not be verified.");
  const std::string currentPath(actual);
  if (currentPath != root.path && currentPath.rfind(root.path + "/", 0) != 0)
    throw std::runtime_error("A folder moved outside Trash. It was preserved.");
}
// Handle-relative operations never follow symlinks or recursively remove a path
// supplied by the renderer. Every directory is identity checked and confined to
// the current private Trash root, including if another process renames it.
static void remove(const Root& root, int parent, const Node& node) {
  stillInside(root, parent);
  if (!version(node.version, info(parent, node.name))) throw std::runtime_error("An item changed during emptying. Remaining items were preserved.");
  if (S_ISDIR(node.version.st_mode)) {
    FD directory(openat(parent, node.name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
    struct stat opened{};
    if (fstat(directory.value, &opened) || !version(node.version, opened)) throw std::runtime_error("A folder changed during emptying.");
    for (const auto& child : node.children) remove(root, directory.value, child);
    stillInside(root, directory.value);
    if (!names(directory.value).empty() || !identity(node.version, info(parent, node.name)))
      throw std::runtime_error("A folder changed during emptying. Remaining items were preserved.");
    stillInside(root, parent);
    if (unlinkat(parent, node.name.c_str(), AT_REMOVEDIR)) throw std::runtime_error("A trashed folder could not be erased. Remaining items were preserved.");
  } else if (unlinkat(parent, node.name.c_str(), 0)) {
    throw std::runtime_error("A trashed item could not be erased. Remaining items were preserved.");
  }
}
static std::vector<Root> review(NSArray* requested) {
  if (!requested.count || requested.count > 128) throw std::runtime_error("Invalid Trash locations.");
  NSMutableSet<NSString*>* allowed = [NSMutableSet set];
  struct passwd* user = getpwuid(getuid());
  if (!user) throw std::runtime_error("The current user could not be verified.");
  NSString* home = [NSString stringWithUTF8String:user->pw_dir];
  [allowed addObject:[home stringByAppendingPathComponent:@".Trash"]];
  for (NSURL* volume in [NSFileManager.defaultManager mountedVolumeURLsIncludingResourceValuesForKeys:nil options:0])
    if (![volume.path isEqualToString:@"/"])
      [allowed addObject:[volume.path stringByAppendingPathComponent:[NSString stringWithFormat:@".Trashes/%u", getuid()]]];
  std::vector<Root> roots;
  size_t count = 0;
  for (NSDictionary* item in requested) {
    if (![item isKindOfClass:NSDictionary.class] || ![item[@"path"] isKindOfClass:NSString.class] || ![item[@"identity"] isKindOfClass:NSString.class] || ![item[@"items"] isKindOfClass:NSArray.class])
      throw std::runtime_error("Invalid Trash review.");
    NSString* file = item[@"path"];
    if (![allowed containsObject:file]) throw std::runtime_error("Only the current user's system Trash can be emptied.");
    char canonical[PATH_MAX];
    if (!realpath(file.fileSystemRepresentation, canonical) || strcmp(canonical, file.fileSystemRepresentation))
      throw std::runtime_error("A Trash location is unavailable or contains a symbolic link.");
    if (![file isEqualToString:[home stringByAppendingPathComponent:@".Trash"]]) {
      struct stat shared{};
      if (lstat(file.stringByDeletingLastPathComponent.fileSystemRepresentation, &shared) || !S_ISDIR(shared.st_mode) || !(shared.st_mode & S_ISVTX))
        throw std::runtime_error("The volume's shared Trash could not be verified.");
    }
    Root root{std::string(canonical), std::make_shared<FD>(open(canonical, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)), {}, {}};
    if (fstat(root.fd->value, &root.version) || root.version.st_uid != getuid() || (root.version.st_mode & 0077) ||
      identifier(root.version) != std::string([item[@"identity"] UTF8String] ?: ""))
      throw std::runtime_error("The private Trash folder changed or belongs to another user.");
    NSArray* expected = item[@"items"];
    const auto current = names(root.fd->value, true);
    if (expected.count != current.size()) throw std::runtime_error("Trash changed. Refresh it before emptying.");
    NSMutableDictionary* byName = [NSMutableDictionary dictionary];
    for (NSDictionary* entry in expected) {
      if (![entry isKindOfClass:NSDictionary.class] || ![entry[@"name"] isKindOfClass:NSString.class] || ![entry[@"identity"] isKindOfClass:NSString.class] ||
        ![entry[@"size"] isKindOfClass:NSNumber.class] || ![entry[@"modified"] isKindOfClass:NSNumber.class]) throw std::runtime_error("Invalid Trash review.");
      byName[entry[@"name"]] = entry;
    }
    for (const auto& name : current) {
      NSDictionary* expectedItem = byName[[NSString stringWithUTF8String:name.c_str()]];
      Node node = inspect(root.fd->value, name, root.version.st_dev, count, 0);
      double modified = node.version.st_mtimespec.tv_sec * 1000.0 + node.version.st_mtimespec.tv_nsec / 1000000.0;
      if (!expectedItem || identifier(node.version) != std::string([expectedItem[@"identity"] UTF8String]) ||
        node.version.st_size != [expectedItem[@"size"] longLongValue] || std::abs(modified - [expectedItem[@"modified"] doubleValue]) > 0.001)
        throw std::runtime_error("An item in Trash changed. Refresh it before emptying.");
      root.children.push_back(std::move(node));
    }
    stillInside(root, root.fd->value);
    roots.push_back(std::move(root));
  }
  return roots;
}
static void showError(NSString* message) {
  NSAlert* alert = [[NSAlert alloc] init];
  alert.alertStyle = NSAlertStyleWarning;
  alert.messageText = @"Trash could not be emptied";
  alert.informativeText = message;
  [alert addButtonWithTitle:@"OK"];
  [alert runModal];
}
} // namespace viewer_trash

#ifndef VIEWER_TRASH_GUARD_TESTS
@interface ViewerTrashConfirmation : NSObject
@property(nonatomic, strong) NSArray* roots;
@property(nonatomic) NSUInteger count;
- (void)present;
@end
@implementation ViewerTrashConfirmation
- (void)present {
  if (viewer_trash::busy) return;
  viewer_trash::busy = true;
  NSArray* requested = self.roots;
  NSUInteger count = self.count;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      try {
        auto roots = std::make_shared<std::vector<viewer_trash::Root>>(viewer_trash::review(requested));
        dispatch_async(dispatch_get_main_queue(), ^{
          NSAlert* alert = [[NSAlert alloc] init];
          alert.alertStyle = NSAlertStyleWarning;
          alert.messageText = @"Empty Trash?";
          alert.informativeText = [NSString stringWithFormat:@"Permanently erase %lu %@, including the contents of trashed folders? This cannot be undone.", (unsigned long)count, count == 1 ? @"item" : @"items"];
          NSButton* cancel = [alert addButtonWithTitle:@"Cancel"];
          cancel.keyEquivalent = @"\r";
          NSButton* erase = [alert addButtonWithTitle:@"Empty Trash"];
          erase.keyEquivalent = @"";
          if ([alert runModal] != NSAlertSecondButtonReturn) { viewer_trash::busy = false; return; }
          dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            @autoreleasepool {
              NSString* failure = nil;
              try {
                // Check the entire reviewed inventory before the first removal.
                for (const auto& root : *roots) {
                  viewer_trash::stillInside(root, root.fd->value);
                  if (viewer_trash::names(root.fd->value, true).size() != root.children.size()) throw std::runtime_error("Trash changed after confirmation. Nothing was erased.");
                  for (const auto& node : root.children) viewer_trash::unchanged(root.fd->value, node);
                }
                for (const auto& root : *roots)
                  for (const auto& node : root.children) viewer_trash::remove(root, root.fd->value, node);
              } catch (const std::exception& error) { failure = [NSString stringWithUTF8String:error.what()]; }
              dispatch_async(dispatch_get_main_queue(), ^{
                viewer_trash::busy = false;
                if (failure) viewer_trash::showError(failure);
              });
            }
          });
        });
      } catch (const std::exception& error) {
        NSString* failure = [NSString stringWithUTF8String:error.what()];
        dispatch_async(dispatch_get_main_queue(), ^{ viewer_trash::busy = false; viewer_trash::showError(failure); });
      }
    }
  });
}
@end

static napi_value trashConfirmation(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 1, bytes = 0; napi_value args[1];
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &bytes) != napi_ok || bytes > 8 * 1024 * 1024) return invalid(env);
    std::string json(bytes + 1, '\0');
    napi_get_value_string_utf8(env, args[0], json.data(), json.size(), &bytes);
    NSData* data = [NSData dataWithBytes:json.data() length:bytes];
    NSDictionary* request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![request isKindOfClass:NSDictionary.class] || ![request[@"roots"] isKindOfClass:NSArray.class] || ![request[@"count"] isKindOfClass:NSNumber.class]) return invalid(env);
    ViewerTrashConfirmation* target = [[ViewerTrashConfirmation alloc] init];
    target.roots = request[@"roots"];
    target.count = [request[@"count"] unsignedIntegerValue];
    if (!target.count || target.count > 4000) return invalid(env);
    // Presenting this UI cannot supply an affirmative response. Cancel is the
    // default; NSAlertSecondButtonReturn from native human interaction is the
    // only continuation that can reach guarded removal.
    [target present];
    napi_value output; napi_get_undefined(env, &output); return output;
  }
}
#endif
