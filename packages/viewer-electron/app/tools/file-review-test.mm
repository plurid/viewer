// Compile the production native adapter with only the OS Trash selector replaced.
// Every file, coordination claim and review check remains real; no item is removed.
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <atomic>

static std::atomic<uint32_t> recordedTrashCalls{0};

@interface NSFileManager (ViewerReviewRecordingTrash)
- (BOOL)viewerReviewRecordingTrashItemAtURL:(NSURL *)url
  resultingItemURL:(NSURL **)result
  error:(NSError **)error;
@end

@implementation NSFileManager (ViewerReviewRecordingTrash)
- (BOOL)viewerReviewRecordingTrashItemAtURL:(NSURL *)url
  resultingItemURL:(NSURL **)result
  error:(NSError **)error {
  (void)error;
  recordedTrashCalls.fetch_add(1);
  if (result) *result = url;
  return YES;
}
@end

static napi_value recordingCount(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_uint32(env, recordedTrashCalls.load(), &result);
  return result;
}

#undef NAPI_MODULE
#define NAPI_MODULE(moduleName, registerModule) \
  NAPI_MODULE_INIT() { \
    registerModule(env, exports); \
    napi_value recording; \
    napi_get_boolean(env, true, &recording); \
    napi_property_descriptor methods[] = { \
      {"recordingTrash", nullptr, nullptr, nullptr, nullptr, recording, napi_default, nullptr}, \
      {"recordedTrashCalls", nullptr, recordingCount, nullptr, nullptr, nullptr, napi_default, nullptr}, \
    }; \
    napi_define_properties(env, exports, 2, methods); \
    return exports; \
  }

#define trashItemAtURL viewerReviewRecordingTrashItemAtURL
#include "macos-files.mm"
#undef trashItemAtURL
