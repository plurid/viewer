#import <Quartz/Quartz.h>

// The running print sheet keeps its document until the sheet reports that it ended.
static PDFDocument *viewerPrintDocument = nil;
static NSPrintOperation *viewerPrintOperation = nil;
@interface ViewerPrintDelegate : NSObject
- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)contextInfo;
@end
@implementation ViewerPrintDelegate
- (void)printOperationDidRun:(NSPrintOperation *)operation success:(BOOL)success contextInfo:(void *)contextInfo {
  viewerPrintOperation = nil; viewerPrintDocument = nil;
}
@end
static ViewerPrintDelegate *viewerPrintDelegate = nil;
// Prints a PDF through PDFKit's print sheet. The document is only read from its path; a
// locked document prints only after the password the person entered unlocks it, and a
// document whose permissions forbid printing is refused.
static napi_value printPDF(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 2; napi_value args[2]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    NSString *file = count >= 1 ? stringArg(env, args[0]) : nil;
    if (!file.isAbsolutePath) return invalid(env);
    NSString *password = nil;
    if (count == 2) {
      napi_valuetype type; napi_typeof(env, args[1], &type);
      if (type == napi_string) password = stringArg(env, args[1]);
      else if (type != napi_undefined) return invalid(env);
    }
    if (!NSThread.isMainThread) { napi_throw_error(env, nullptr, "Printing requires the application thread."); return nullptr; }
    if (viewerPrintOperation) { napi_throw_error(env, nullptr, "Another document is being printed."); return nullptr; }
    PDFDocument *document = [[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:file]];
    if (!document) { napi_throw_error(env, nullptr, "This file is not a PDF that macOS can read."); return nullptr; }
    if (document.isLocked && !(password.length && [document unlockWithPassword:password])) {
      napi_throw_error(env, nullptr, "Enter this PDF's password before printing."); return nullptr;
    }
    if (!document.allowsPrinting) { napi_throw_error(env, nullptr, "This PDF does not allow printing."); return nullptr; }
    NSPrintInfo *printInfo = [NSPrintInfo.sharedPrintInfo copy];
    NSPrintOperation *operation = [document printOperationForPrintInfo:printInfo scalingMode:kPDFPrintPageScaleToFit autoRotate:YES];
    if (!operation) { napi_throw_error(env, nullptr, "This PDF could not be prepared for printing."); return nullptr; }
    operation.jobTitle = file.lastPathComponent;
    NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow;
    @try {
      if (window) {
        if (!viewerPrintDelegate) viewerPrintDelegate = [ViewerPrintDelegate new];
        viewerPrintDocument = document; viewerPrintOperation = operation;
        [operation runOperationModalForWindow:window delegate:viewerPrintDelegate
          didRunSelector:@selector(printOperationDidRun:success:contextInfo:) contextInfo:nil];
      } else [operation runOperation];
    } @catch (NSException *error) {
      viewerPrintOperation = nil; viewerPrintDocument = nil;
      napi_throw_error(env, nullptr, (error.reason ?: @"Could not open the print sheet.").UTF8String); return nullptr;
    }
    napi_value result; napi_get_undefined(env, &result); return result;
  }
}
static void registerPDFPrinting(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"printPDF", nullptr, printPDF, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods)/sizeof(methods[0]), methods);
}
