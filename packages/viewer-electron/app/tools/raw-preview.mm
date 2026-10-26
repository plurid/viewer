// Viewer RAW preview helper. Reads only inherited descriptor 3; writes JPEG to stdout.
// LibRaw stays a separate, replaceable LGPL library. No filenames or shell arguments.
#include <libraw/libraw.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <CoreGraphics/CoreGraphics.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <cstring>

static constexpr size_t inputLimit = 256u * 1024u * 1024u;
static bool writeBytes(const void *bytes, size_t count) {
  auto cursor = static_cast<const unsigned char *>(bytes);
  while (count) {
    auto written = write(STDOUT_FILENO, cursor, count);
    if (written <= 0) return false;
    cursor += written; count -= written;
  }
  return true;
}
static CFDataRef jpeg(CGImageRef image, int flip) {
  const size_t w = CGImageGetWidth(image), h = CGImageGetHeight(image);
  if (!w || !h || w > 40000 || h > 40000 || w * h > 120000000) return nullptr;
  bool swap = (flip & 4) != 0;
  // dcraw uses top-down pixel coordinates; CGContext's y-axis points up. A
  // transpose therefore reverses both flip bits in the drawing transform.
  if (swap) flip ^= 3;
  double scale = std::min(1.0, 4096.0 / std::max(w, h));
  size_t width = std::max(size_t(1), size_t((swap ? h : w) * scale));
  size_t height = std::max(size_t(1), size_t((swap ? w : h) * scale));
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(nullptr, width, height, 8, width * 4, space,
    kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!context) return nullptr;
  CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
  CGContextTranslateCTM(context, width / 2.0, height / 2.0);
  // LibRaw flip flags match dcraw's transform: transpose, vertical/horizontal reverse.
  if (swap) CGContextConcatCTM(context, CGAffineTransformMake(0, 1, 1, 0, 0, 0));
  CGContextScaleCTM(context, (flip & 1) ? -scale : scale, (flip & 2) ? -scale : scale);
  CGContextDrawImage(context, CGRectMake(-double(w) / 2, -double(h) / 2, w, h), image);
  CGImageRef final = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  if (!final) return nullptr;
  CFMutableDataRef data = CFDataCreateMutable(nullptr, 0);
  CGImageDestinationRef destination = CGImageDestinationCreateWithData(data, CFSTR("public.jpeg"), 1, nullptr);
  if (destination) {
    NSDictionary *options = @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @0.9};
    CGImageDestinationAddImage(destination, final, (__bridge CFDictionaryRef)options);
    if (!CGImageDestinationFinalize(destination)) { CFRelease(data); data = nullptr; }
    CFRelease(destination);
  } else { CFRelease(data); data = nullptr; }
  CGImageRelease(final);
  return data;
}
static CGImageRef bitmap(libraw_processed_image_t *memory) {
  if (!memory || memory->bits != 8 || (memory->colors != 3 && memory->colors != 1) ||
      !memory->width || !memory->height ||
      size_t(memory->width) * memory->height > 120000000 ||
      memory->data_size != size_t(memory->width) * memory->height * memory->colors) return nullptr;
  CFDataRef data = CFDataCreate(nullptr, memory->data, memory->data_size);
  CGDataProviderRef provider = CGDataProviderCreateWithCFData(data);
  CGColorSpaceRef space = memory->colors == 3 ? CGColorSpaceCreateWithName(kCGColorSpaceSRGB) : CGColorSpaceCreateDeviceGray();
  CGImageRef image = CGImageCreate(memory->width, memory->height, 8, 8 * memory->colors,
    memory->width * memory->colors, space, kCGImageAlphaNone, provider, nullptr, false, kCGRenderingIntentDefault);
  CGColorSpaceRelease(space); CGDataProviderRelease(provider); CFRelease(data);
  return image;
}
int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 2 || (strcmp(argv[1], "camera") && strcmp(argv[1], "raw"))) return 2;
    struct rlimit memoryLimit = {1536u * 1024u * 1024u, 1536u * 1024u * 1024u};
    setrlimit(RLIMIT_AS, &memoryLimit);
    struct rlimit cpuLimit = {30, 30}; setrlimit(RLIMIT_CPU, &cpuLimit);
    struct stat info;
    if (fstat(3, &info) || !S_ISREG(info.st_mode) || info.st_size <= 0 || size_t(info.st_size) > inputLimit) return 3;
    void *input = mmap(nullptr, info.st_size, PROT_READ, MAP_PRIVATE, 3, 0);
    if (input == MAP_FAILED) return 3;
    CGImageRef image = nullptr;
    int flip = 0;
    bool camera = false;
    try {
      LibRaw decoder(LIBRAW_OPTIONS_NO_DATAERR_CALLBACK);
      decoder.imgdata.rawparams.max_raw_memory_mb = 512;
      int error = decoder.open_buffer(input, info.st_size);
      if (error != LIBRAW_SUCCESS) return 4;
      if (!strcmp(argv[1], "camera")) {
        int best = -1; size_t area = 0;
        for (int i = 0; i < decoder.imgdata.thumbs_list.thumbcount; ++i) {
          auto &thumb = decoder.imgdata.thumbs_list.thumblist[i];
          if (thumb.tlength <= 64u * 1024u * 1024u && size_t(thumb.twidth) * thumb.theight > area) {
            best = i; area = size_t(thumb.twidth) * thumb.theight;
          }
        }
        error = best >= 0 ? decoder.unpack_thumb_ex(best) : decoder.unpack_thumb();
        if (error == LIBRAW_SUCCESS) {
          libraw_processed_image_t *thumb = decoder.dcraw_make_mem_thumb(&error);
          if (thumb && thumb->data_size <= 64u * 1024u * 1024u) {
            if (thumb->type == LIBRAW_IMAGE_JPEG) {
              CFDataRef data = CFDataCreate(nullptr, thumb->data, thumb->data_size);
              CGImageSourceRef source = CGImageSourceCreateWithData(data, nullptr);
              if (source) {
                NSDictionary *options = @{(__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways:@YES,
                  (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize:@4096,
                  (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform:@NO};
                image = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
                CFRelease(source);
              }
              CFRelease(data);
            } else image = bitmap(thumb);
          }
          LibRaw::dcraw_clear_mem(thumb);
          if (image) { camera = true; flip = decoder.imgdata.sizes.flip; }
        }
      }
      if (!image) {
        // A fresh decoder avoids carrying a failed embedded-image extraction into demosaic.
        LibRaw raw(LIBRAW_OPTIONS_NO_DATAERR_CALLBACK);
        raw.imgdata.rawparams.max_raw_memory_mb = 512;
        raw.imgdata.params.half_size = 1;
        raw.imgdata.params.use_camera_wb = 1;
        raw.imgdata.params.output_color = 1;
        raw.imgdata.params.output_bps = 8;
        raw.imgdata.params.user_qual = 0;
        if (raw.open_buffer(input, info.st_size) || raw.unpack() || raw.error_count() ||
            raw.dcraw_process() || raw.error_count()) return 5;
        auto *pixels = raw.dcraw_make_mem_image(&error);
        if (pixels) image = bitmap(pixels);
        LibRaw::dcraw_clear_mem(pixels);
      }
      if (!image) return 6;
      CFDataRef output = jpeg(image, flip); CGImageRelease(image);
      if (!output || CFDataGetLength(output) > 32u * 1024u * 1024u) { if (output) CFRelease(output); return 7; }
      const char *header = camera ? "{\"kind\":\"camera\"}\n" : "{\"kind\":\"raw\"}\n";
      bool ok = writeBytes(header, strlen(header)) && writeBytes(CFDataGetBytePtr(output), CFDataGetLength(output));
      CFRelease(output); munmap(input, info.st_size);
      return ok ? 0 : 8;
    } catch (...) { return 9; }
  }
}
