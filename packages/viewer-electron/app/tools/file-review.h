#ifndef VIEWER_FILE_REVIEW_H
#define VIEWER_FILE_REVIEW_H

#import <CommonCrypto/CommonDigest.h>
#include <array>
#include <cmath>
#include <cstdio>
#include <optional>
#include <unistd.h>

static constexpr uint64_t reviewedFileByteLimit = 64 * 1024 * 1024;

struct ReviewedFileVersion {
  NSString *identity = nil;
  NSString *sha256 = nil;
  double modified = 0;
  uint64_t size = 0;
};

static bool reviewNumber(napi_env env, napi_value object, const char *name, double &output) {
  napi_value value;
  return napi_get_named_property(env, object, name, &value) == napi_ok &&
    napi_get_value_double(env, value, &output) == napi_ok && std::isfinite(output);
}

static bool readReviewedFileVersion(
  napi_env env,
  napi_value value,
  ReviewedFileVersion &output
) {
  napi_value version, identity, hash;
  double size = 0;
  if (napi_get_named_property(env, value, "version", &version) != napi_ok ||
    napi_get_named_property(env, version, "identity", &identity) != napi_ok ||
    napi_get_named_property(env, value, "sha256", &hash) != napi_ok ||
    !reviewNumber(env, version, "modified", output.modified) ||
    !reviewNumber(env, version, "size", size)) return false;
  output.identity = stringArg(env, identity);
  output.sha256 = stringArg(env, hash);
  NSCharacterSet *invalidIdentity =
    [[NSCharacterSet characterSetWithCharactersInString:@"0123456789:"] invertedSet];
  NSCharacterSet *invalidHash =
    [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
  NSArray<NSString *> *identityParts = [output.identity componentsSeparatedByString:@":"];
  if (!output.identity.length || identityParts.count != 2 ||
    !identityParts.firstObject.length || !identityParts.lastObject.length ||
    [output.identity rangeOfCharacterFromSet:invalidIdentity].location != NSNotFound ||
    output.sha256.length != CC_SHA256_DIGEST_LENGTH * 2 ||
    [output.sha256 rangeOfCharacterFromSet:invalidHash].location != NSNotFound ||
    size < 0 || size > reviewedFileByteLimit || std::floor(size) != size) return false;
  output.size = static_cast<uint64_t>(size);
  return true;
}

static bool sameReviewedStat(const struct stat &before, const struct stat &after) {
  return before.st_dev == after.st_dev && before.st_ino == after.st_ino &&
    before.st_mode == after.st_mode && before.st_size == after.st_size &&
    before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec &&
    before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec &&
    before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec &&
    before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec;
}

/** The descriptor remains open through the caller's coordinated native Trash action.
 * This detects stale versions; it is not an atomic compare-and-Trash primitive.
 */
struct ReviewedFileHandle {
  int descriptor = -1;

  ~ReviewedFileHandle() {
    if (descriptor >= 0) close(descriptor);
  }

  bool matches(NSURL *url, const ReviewedFileVersion &expected, NSString **error) {
    const auto changed = [&]() {
      *error = @"The reviewed file changed after confirmation. It was preserved.";
      return false;
    };
    descriptor = open(url.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    if (descriptor < 0) return changed();
    struct stat before{}, after{}, current{};
    if (fstat(descriptor, &before) != 0 || !S_ISREG(before.st_mode) || before.st_size < 0)
      return changed();
    NSString *identity = [NSString stringWithFormat:@"%llu:%llu",
      static_cast<unsigned long long>(before.st_dev),
      static_cast<unsigned long long>(before.st_ino)];
    const double modified = before.st_mtimespec.tv_sec * 1000.0 +
      before.st_mtimespec.tv_nsec / 1000000.0;
    if (![identity isEqualToString:expected.identity] ||
      modified != expected.modified ||
      static_cast<uint64_t>(before.st_size) != expected.size ||
      expected.size > reviewedFileByteLimit) return changed();

    CC_SHA256_CTX context;
    CC_SHA256_Init(&context);
    std::array<unsigned char, 65536> buffer;
    uint64_t bytes = 0;
    unsigned interrupted = 0;
    for (;;) {
      const ssize_t count = read(descriptor, buffer.data(), buffer.size());
      if (count < 0) {
        if (errno == EINTR && ++interrupted < 64) continue;
        return changed();
      }
      if (count == 0) break;
      bytes += static_cast<uint64_t>(count);
      if (bytes > expected.size || bytes > reviewedFileByteLimit) return changed();
      CC_SHA256_Update(&context, buffer.data(), static_cast<CC_LONG>(count));
    }
    if (bytes != expected.size || fstat(descriptor, &after) != 0 ||
      lstat(url.fileSystemRepresentation, &current) != 0 ||
      !sameReviewedStat(before, after) || !sameReviewedStat(before, current)) return changed();

    std::array<unsigned char, CC_SHA256_DIGEST_LENGTH> digest;
    CC_SHA256_Final(digest.data(), &context);
    char hexadecimal[CC_SHA256_DIGEST_LENGTH * 2 + 1]{};
    for (size_t index = 0; index < digest.size(); ++index)
      std::snprintf(hexadecimal + index * 2, 3, "%02x", digest[index]);
    if (![expected.sha256 isEqualToString:[NSString stringWithUTF8String:hexadecimal]])
      return changed();
    return true;
  }
};

#endif
