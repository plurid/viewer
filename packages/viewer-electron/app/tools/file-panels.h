#import <Quartz/Quartz.h>

@interface ViewerQuickLookItems : NSObject <QLPreviewPanelDataSource, QLPreviewPanelDelegate>
@property(nonatomic, strong) NSArray<NSURL *> *items;
@end
@implementation ViewerQuickLookItems
- (NSInteger)numberOfPreviewItemsInPreviewPanel:(QLPreviewPanel *)panel { return self.items.count; }
- (id<QLPreviewItem>)previewPanel:(QLPreviewPanel *)panel previewItemAtIndex:(NSInteger)index {
  return index >= 0 && index < self.items.count ? self.items[index] : nil;
}
- (void)windowWillClose:(NSNotification *)notification { self.items = nil; }
@end
static ViewerQuickLookItems *viewerQuickLook = nil;
static NSSharingServicePicker *viewerSharePicker = nil;
static napi_value filePanel(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 2; napi_value args[2]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSString *kind = count == 2 ? stringArg(env, args[0]) : nil;
    bool array = false; uint32_t length = 0;
    if ((! [kind isEqualToString:@"preview"] && ![kind isEqualToString:@"share"]) ||
      napi_is_array(env, args[1], &array) != napi_ok || !array ||
      napi_get_array_length(env, args[1], &length) != napi_ok || !length || length > 100) return invalid(env);
    if (!NSThread.isMainThread) { napi_throw_error(env, nullptr, "Native file panels require the application thread."); return nullptr; }
    NSMutableArray<NSURL *> *urls = [NSMutableArray array];
    for (uint32_t index = 0; index < length; index++) {
      napi_value item; napi_get_element(env, args[1], index, &item);
      NSString *file = stringArg(env, item);
      if (!file.isAbsolutePath) return invalid(env);
      [urls addObject:[NSURL fileURLWithPath:file]];
    }
    @try {
      if ([kind isEqualToString:@"preview"]) {
        if (!viewerQuickLook) viewerQuickLook = [ViewerQuickLookItems new];
        viewerQuickLook.items = urls;
        QLPreviewPanel *panel = QLPreviewPanel.sharedPreviewPanel;
        panel.dataSource = viewerQuickLook; panel.delegate = viewerQuickLook;
        [panel reloadData]; panel.currentPreviewItemIndex = 0; [panel makeKeyAndOrderFront:nil];
      } else {
        NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow;
        if (!window.contentView) { napi_throw_error(env, nullptr, "Open a Viewer window before sharing files."); return nullptr; }
        viewerSharePicker = [[NSSharingServicePicker alloc] initWithItems:urls];
        [viewerSharePicker showRelativeToRect:NSMakeRect(NSMidX(window.contentView.bounds), NSMaxY(window.contentView.bounds) - 40, 1, 1) ofView:window.contentView preferredEdge:NSMinYEdge];
      }
    } @catch (NSException *error) {
      napi_throw_error(env, nullptr, (error.reason ?: @"Could not open the native file panel.").UTF8String); return nullptr;
    }
    napi_value result; napi_get_undefined(env, &result); return result;
  }
}
static napi_value dismissFilePanels(napi_env env, napi_callback_info info) {
  if (NSThread.isMainThread) {
    if (QLPreviewPanel.sharedPreviewPanelExists) [QLPreviewPanel.sharedPreviewPanel orderOut:nil];
    viewerQuickLook.items = nil; viewerSharePicker = nil;
  }
  napi_value result; napi_get_undefined(env, &result); return result;
}
static void registerFilePanels(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"filePanel", nullptr, filePanel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"dismissFilePanels", nullptr, dismissFilePanels, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods)/sizeof(methods[0]), methods);
}
