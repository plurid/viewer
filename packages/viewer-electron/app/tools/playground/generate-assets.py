"""Recreate the small synthetic binary assets. Existing outputs are preserved.

Developer-only prerequisites: Python Pillow, FFmpeg, macOS sips for HEIC.
The normal playground command needs only the committed assets and Node.
"""

import math
import struct
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent / "assets"
ASSETS.mkdir(exist_ok=True)


def create(name, build):
    target = ASSETS / name
    if target.exists() or target.is_symlink():
        print(f"Preserved {target.name}")
        return
    build(target)
    print(f"Created {target.name}")


image = Image.new("RGB", (640, 480), "#192833")
draw = ImageDraw.Draw(image)
for column in range(640):
    ratio = column / 639
    draw.line([(column, 0), (column, 480)], fill=(int(25 + 25 * ratio), int(40 + 45 * ratio), int(51 + 65 * ratio)))
draw.rounded_rectangle((52, 56, 588, 424), radius=24, fill="#263c49", outline="#81b7cf", width=3)
draw.polygon([(172, 322), (320, 108), (468, 322)], fill="#81b7cf")
draw.ellipse((292, 226, 348, 282), fill="#d7a56b")
draw.text((80, 360), "VIEWER / IMAGE STUDY", fill="#e2edf2", font_size=22)
draw.text((80, 392), "640 x 480 | synthetic | no external assets", fill="#a9c0cc", font_size=14)

for name, kind in [
    ("study.png", "PNG"), ("study.jpg", "JPEG"), ("study.gif", "GIF"),
    ("study.webp", "WEBP"), ("study.bmp", "BMP"), ("study.ico", "ICO"),
    ("study.tiff", "TIFF"), ("study.jp2", "JPEG2000"), ("study.tga", "TGA"),
]:
    create(name, lambda target, kind=kind: image.save(target, format=kind))
create("study.icns", lambda target: image.resize((1024, 1024)).save(target, format="ICNS"))


def psd(target):
    # PSD v1, flattened 8-bit RGB; planar channel data with no compression.
    header = b"8BPS" + struct.pack(">H6sHIIHH", 1, b"\0" * 6, 3, image.height, image.width, 8, 3)
    channels = b"".join(channel.tobytes() for channel in image.split())
    with target.open("xb") as output:
        output.write(header + struct.pack(">IIIH", 0, 0, 0, 0) + channels)


create("study.psd", psd)


def ffmpeg(arguments, target):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-n", *arguments, str(target)],
        check=True,
        timeout=60,
    )


create("study.avif", lambda target: ffmpeg([
    "-i", str(ASSETS / "study.png"), "-frames:v", "1", "-c:v", "libsvtav1",
    "-preset", "10", "-crf", "36", "-threads", "2",
], target))
create("study.exr", lambda target: ffmpeg([
    "-i", str(ASSETS / "study.png"), "-frames:v", "1", "-c:v", "exr", "-compression", "zip1",
], target))
create("study.heic", lambda target: subprocess.run([
    "/usr/bin/sips", "-s", "format", "heic", str(ASSETS / "study.png"), "--out", str(target),
], check=True, timeout=60, stdout=subprocess.DEVNULL))


def tone(target):
    rate = 22050
    with wave.open(str(target), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        samples = bytearray()
        for index in range(rate * 2):
            fade = min(1, index / 1000, (rate * 2 - index) / 1000)
            value = round(math.sin(index / rate * 2 * math.pi * 440) * 2600 * fade)
            samples.extend(struct.pack("<h", value))
        output.writeframes(samples)


create("tone.wav", tone)
for name, codec in [
    ("tone.mp3", "libmp3lame"), ("tone.flac", "flac"), ("tone.m4a", "aac"),
    ("tone.aac", "aac"), ("tone.opus", "libopus"),
]:
    create(name, lambda target, codec=codec: ffmpeg([
        "-i", str(ASSETS / "tone.wav"), "-c:a", codec,
    ], target))
create("tone.ogg", lambda target: ffmpeg([
    "-i", str(ASSETS / "tone.wav"), "-ac", "2", "-c:a", "vorbis", "-strict", "experimental",
], target))
for name, codec in [("motion.mp4", "libx264"), ("motion.webm", "libvpx")]:
    create(name, lambda target, codec=codec: ffmpeg([
        "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=12", "-t", "2",
        "-c:v", codec, "-pix_fmt", "yuv420p", "-threads", "2",
    ], target))
for name, container in [("motion.mov", "mov"), ("motion.m4v", "ipod")]:
    create(name, lambda target, container=container: ffmpeg([
        "-i", str(ASSETS / "motion.mp4"), "-c", "copy", "-f", container,
    ], target))

# OGV uses the separately pinned, attributed Blender trailer. The installed
# Homebrew FFmpeg has a Theora decoder but no encoder.
