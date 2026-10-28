// Fixed local inference boundary: verified model, language, bounded raw PCM on stdin.
#include "whisper.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <dlfcn.h>
#include <string>
#include <vector>

template <typename T> static T symbol(void *library, const char *name) {
    auto address = dlsym(library, name);
    if (!address) { std::fputs("Speech engine API mismatch.\n", stderr); std::exit(3); }
    return reinterpret_cast<T>(address);
}
static std::string json(const std::string &value) {
    std::string out = "\"";
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
        else if (c < 32) { char text[7]; std::snprintf(text, sizeof(text), "\\u%04x", c); out += text; }
        else out += static_cast<char>(c);
    }
    return out + '"';
}
int main(int argc, char **argv) {
    if (argc != 4) return 2;
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!library) { std::fputs("Speech engine could not load.\n", stderr); return 3; }
#define API(name) auto name##_fn = symbol<decltype(&name)>(library, #name)
    API(whisper_context_default_params); API(whisper_init_from_file_with_params);
    API(whisper_full_default_params); API(whisper_full); API(whisper_full_n_segments);
    API(whisper_full_get_segment_text); API(whisper_full_lang_id); API(whisper_lang_str);
    API(whisper_lang_id); API(whisper_free);
    if (std::string(argv[3]) != "auto" && whisper_lang_id_fn(argv[3]) < 0) return 2;
    constexpr size_t maximum = 16000 * 60 * 2;
    std::vector<unsigned char> bytes;
    unsigned char block[8192];
    while (size_t count = std::fread(block, 1, sizeof(block), stdin)) {
        if (bytes.size() + count > maximum) return 2;
        bytes.insert(bytes.end(), block, block + count);
    }
    if (std::ferror(stdin) || bytes.size() < 3200 || bytes.size() % 2) return 2;
    std::vector<float> samples(bytes.size() / 2);
    for (size_t i = 0; i < samples.size(); i++) {
        const auto value = static_cast<int16_t>(static_cast<uint16_t>(bytes[2*i]) | static_cast<uint16_t>(bytes[2*i+1]) << 8);
        samples[i] = value / 32768.0f;
    }
    auto context_params = whisper_context_default_params_fn();
    // CPU/Accelerate avoids shader compilation and keeps per-utterance ownership predictable.
    context_params.use_gpu = false;
    auto *context = whisper_init_from_file_with_params_fn(argv[2], context_params);
    if (!context) return 4;
    auto params = whisper_full_default_params_fn(WHISPER_SAMPLING_GREEDY);
    params.n_threads = 4;
    params.language = argv[3];
    params.translate = false;
    params.no_context = true;
    params.print_realtime = false;
    params.print_progress = false;
    params.print_timestamps = false;
    params.print_special = false;
    const int status = whisper_full_fn(context, params, samples.data(), static_cast<int>(samples.size()));
    if (status) { whisper_free_fn(context); return 5; }
    std::string text;
    for (int i = 0, count = whisper_full_n_segments_fn(context); i < count; i++) {
        const char *segment = whisper_full_get_segment_text_fn(context, i);
        if (segment) text += segment;
        if (text.size() > 48000) { whisper_free_fn(context); return 6; }
    }
    const char *language = whisper_lang_str_fn(whisper_full_lang_id_fn(context));
    std::printf("{\"text\":%s,\"language\":%s}\n", json(text).c_str(), json(language ? language : "unknown").c_str());
    whisper_free_fn(context);
    dlclose(library);
    return 0;
}
