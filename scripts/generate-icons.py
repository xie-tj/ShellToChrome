import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "extension" / "icons"
OUT.mkdir(parents=True, exist_ok=True)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_icon(size):
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            margin = max(1, size // 8)
            inside = margin <= x < size - margin and margin <= y < size - margin
            if not inside:
                color = (0, 0, 0, 0)
            else:
                color = (53, 104, 240, 255)
                bar = max(1, size // 10)
                gap = max(1, size // 14)
                base = size - margin * 2
                start = margin + gap
                heights = (base * 4 // 10, base * 7 // 10, base * 5 // 10)
                for index, height in enumerate(heights):
                    left = start + index * (bar + gap)
                    if left <= x < left + bar and size - margin - gap - height <= y < size - margin - gap:
                        color = (255, 255, 255, 255)
            pixels.extend(color)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(pixels), 9)) + chunk(b"IEND", b"")
    (OUT / f"icon{size}.png").write_bytes(png)


for icon_size in (16, 48, 128):
    write_icon(icon_size)
