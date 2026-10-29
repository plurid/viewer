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
# Uncompressed formats use a small copy, which keeps the committed files small
small = image.resize((160, 120))
create("study-small.png", lambda target: small.save(target, format="PNG"))
# Netpbm: bitmap, greymap and pixmap
create("study.pbm", lambda target: small.convert("1").save(target, format="PPM"))
create("study.pgm", lambda target: small.convert("L").save(target, format="PPM"))
create("study.ppm", lambda target: small.save(target, format="PPM"))


def animated(target):
    # APNG: the study, then the same frame with the sun lowered
    second = image.copy()
    ImageDraw.Draw(second).ellipse((292, 266, 348, 322), fill="#d7a56b")
    image.save(target, format="PNG", save_all=True, append_images=[second], duration=500, loop=0)


create("study.apng", animated)


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
for name, kind, source in [
    ("study.heic", "heic", "study.png"),
    ("study.ktx", "ktx", "study-small.png"),
    ("study.astc", "astc", "study-small.png"),
]:
    create(name, lambda target, kind=kind, source=source: subprocess.run([
        "/usr/bin/sips", "-s", "format", kind, str(ASSETS / source), "--out", str(target),
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

# Containers Chromium cannot play, which Viewer shows through a compatibility copy
for name, arguments in [
    ("motion.avi", ["-c:v", "mpeg4", "-b:v", "80k"]),
    ("motion.mkv", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]),
    ("motion.mpg", ["-c:v", "mpeg2video", "-b:v", "80k", "-f", "mpeg"]),
    ("motion.m2ts", ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-f", "mpegts", "-mpegts_m2ts_mode", "1"]),
    ("motion.wmv", ["-c:v", "wmv2", "-b:v", "80k", "-f", "asf"]),
    ("motion.flv", ["-c:v", "flv", "-b:v", "80k"]),
    ("motion.3gp", ["-c:v", "mpeg4", "-b:v", "80k", "-f", "3gp"]),
    ("motion.3g2", ["-c:v", "mpeg4", "-b:v", "80k", "-f", "3g2"]),
    ("motion.vob", ["-c:v", "mpeg2video", "-b:v", "80k", "-f", "vob"]),
    ("motion.mxf", ["-c:v", "mpeg2video", "-b:v", "80k", "-r", "25", "-f", "mxf"]),
]:
    create(name, lambda target, arguments=arguments: ffmpeg([
        "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=12", "-t", "2", "-threads", "2",
        "-maxrate", "100k", "-bufsize", "200k",
        *arguments,
    ], target))
for name, arguments in [
    ("tone.aiff", ["-c:a", "pcm_s16be"]),
    ("tone.caf", ["-c:a", "pcm_s16le"]),
    ("tone.wma", ["-c:a", "wmav2"]),
    ("tone.mka", ["-c:a", "flac"]),
    ("tone.ac3", ["-c:a", "ac3", "-ar", "48000"]),
    ("tone.wv", ["-c:a", "wavpack"]),
]:
    create(name, lambda target, arguments=arguments: ffmpeg([
        "-i", str(ASSETS / "tone.wav"), *arguments,
    ], target))


def library(target):
    # A small read-only SQLite example: two tables, an index and a view
    import sqlite3

    connection = sqlite3.connect(target)
    connection.executescript("""
        CREATE TABLE materials (id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER);
        CREATE TABLE notes (id INTEGER PRIMARY KEY, material INTEGER REFERENCES materials(id),
            note TEXT, photo BLOB);
        CREATE INDEX notes_material ON notes(material);
        CREATE VIEW stocked AS SELECT name, quantity FROM materials WHERE quantity > 0;
        INSERT INTO materials (name, quantity) VALUES
            ('Aluminum panel', 12), ('Nylon cord', 24), ('Brass hinge', 0);
        INSERT INTO notes (material, note, photo) VALUES
            (1, 'Cut to 200 x 100 mm.', x'89504e47'), (2, 'Keep dry.', NULL);
    """)
    connection.commit()
    connection.close()


create("library.sqlite", library)
