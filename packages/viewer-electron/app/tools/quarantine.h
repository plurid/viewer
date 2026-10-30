#import <CoreServices/CoreServices.h>

// Marks a file Viewer saved from an email as Mail marks one: Launch Services records it as an
// email attachment, so Gatekeeper checks it before it first opens. Only a regular file is marked;
// a symbolic link in its place is refused, never followed.
static napi_value quarantineAttachment(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 1; napi_value args[1]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSString *file = count == 1 ? stringArg(env, args[0]) : nil;
    if (!file.isAbsolutePath) return invalid(env);
    struct stat item{};
    if (lstat(file.fileSystemRepresentation, &item) != 0 || !S_ISREG(item.st_mode)) {
      napi_throw_error(env, nullptr, "Only a saved file can be marked as downloaded."); return nullptr;
    }
    NSDictionary *properties = @{
      (__bridge NSString *)kLSQuarantineAgentNameKey: @"Viewer",
      (__bridge NSString *)kLSQuarantineTypeKey: (__bridge NSString *)kLSQuarantineTypeEmailAttachment,
    };
    NSError *error = nil;
    if (![[NSURL fileURLWithPath:file isDirectory:NO] setResourceValue:properties forKey:NSURLQuarantinePropertiesKey error:&error]) {
      napi_throw_error(env, nullptr, (error.localizedDescription ?: @"The file could not be marked as downloaded.").UTF8String);
      return nullptr;
    }
    napi_value result; napi_get_undefined(env, &result); return result;
  }
}
static void registerQuarantine(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"quarantineAttachment", nullptr, quarantineAttachment, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods)/sizeof(methods[0]), methods);
}
