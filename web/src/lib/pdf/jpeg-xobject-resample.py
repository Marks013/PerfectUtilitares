"""Re-encode supported JPEG XObjects without rebuilding PDF pages."""

import argparse
import io
import math
import selectors
import subprocess
import sys
import time

import pikepdf
from PIL import Image


MAX_PAGES = 300
MAX_IMAGES = 300
MAX_IMAGE_PIXELS = 24_000_000
MAX_TOTAL_PIXELS = 250_000_000
MAX_LIST_BYTES = 1_048_576
LIST_TIMEOUT_SECONDS = 8


class NotApplicable(Exception):
    """The original must be left to the existing fallback."""


def list_images(source):
    deadline = time.monotonic() + LIST_TIMEOUT_SECONDS
    listing = bytearray()
    with subprocess.Popen(
        ["pdfimages", "-list", source],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as process:
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while selector.select(max(0, deadline - time.monotonic())):
                    chunk = process.stdout.read1(64 * 1024)
                    if not chunk:
                        break
                    listing.extend(chunk)
                    if len(listing) > MAX_LIST_BYTES:
                        raise NotApplicable()
                    if time.monotonic() >= deadline:
                        raise NotApplicable()
                else:
                    raise NotApplicable()
            if process.wait(timeout=max(0, deadline - time.monotonic())) != 0:
                raise NotApplicable()
        finally:
            if process.poll() is None:
                process.kill()

    lines = listing.decode("ascii").splitlines()
    if len(lines) < 2 or lines[0].split()[:3] != ["page", "num", "type"]:
        raise NotApplicable()
    for line in lines[2:]:
        row = line.split()
        if len(row) < 10:
            raise NotApplicable()
        if row[2] == "image":
            yield row
        elif row[2] not in ("mask", "smask", "stencil"):
            raise NotApplicable()


def get_uses(source, grayscale):
    uses = {}
    for row in list_images(source):
        # Inline images have no stable object reference for in-place replacement.
        if len(row) != 16 or not row[10].isdigit() or not row[11].isdigit():
            if grayscale:
                raise NotApplicable()
            continue
        key = int(row[10]), int(row[11])
        width, height = int(row[3]), int(row[4])
        # Poppler reports integer PPI. Use the lower bound of the rounded value
        # and the lowest PPI over all uses, so a reused image is not over-reduced.
        dpi = min(int(row[12]), int(row[13])) - 0.5
        supported = (
            row[8] == "jpeg"
            and row[7] == "8"
            and (row[5], row[6]) in (("rgb", "3"), ("gray", "1"))
            and dpi > 0
        )
        current = (width, height, row[5], supported, dpi)
        if key in uses:
            previous = uses[key]
            if previous[:3] != current[:3]:
                raise NotApplicable()
            current = (
                width,
                height,
                row[5],
                previous[3] and supported,
                min(previous[4], dpi),
            )
        uses[key] = current
        if len(uses) > MAX_IMAGES:
            raise NotApplicable()
    return uses


def is_plain_jpeg(obj):
    image_filter = obj.get("/Filter")
    params = obj.get("/DecodeParms")
    if isinstance(image_filter, pikepdf.Array):
        return (
            list(image_filter) == [pikepdf.Name.DCTDecode]
            and (params is None or isinstance(params, pikepdf.Array) and list(params) == [None])
        )
    return image_filter == pikepdf.Name.DCTDecode and params is None


def transform(source, output, target_dpi, quality, grayscale):
    changed = False
    pixels = 0
    with pikepdf.Pdf.open(source, attempt_recovery=False) as pdf:
        if (
            pdf.is_encrypted
            or len(pdf.pages) > MAX_PAGES
            or any(key in pdf.Root for key in ("/AcroForm", "/Perms"))
        ):
            raise NotApplicable()
        if grayscale and any(
            isinstance(obj, pikepdf.Dictionary)
            and any(key in obj for key in ("/DefaultRGB", "/DefaultGray"))
            for obj in pdf.objects
        ):
            raise NotApplicable()

        for key, (width, height, color, supported, dpi) in get_uses(
            source, grayscale
        ).items():
            if grayscale and not supported and color not in ("gray", "mono"):
                raise NotApplicable()
            if not supported:
                continue
            obj = pdf.get_object(key)
            expected = pikepdf.Name.DeviceRGB if color == "rgb" else pikepdf.Name.DeviceGray
            to_gray = grayscale and color == "rgb"
            if (
                not isinstance(obj, pikepdf.Stream)
                or obj.get("/Subtype") != pikepdf.Name.Image
                or not is_plain_jpeg(obj)
                or obj.get("/ColorSpace") != expected
                or obj.get("/BitsPerComponent") != 8
                or obj.get("/Width") != width
                or obj.get("/Height") != height
                or any(
                    prop in obj
                    for prop in (
                        "/ImageMask", "/Mask", "/SMask", "/SMaskInData",
                        "/Decode", "/Alternates",
                    )
                )
            ):
                if to_gray:
                    raise NotApplicable()
                continue
            if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                raise NotApplicable()
            pixels += width * height
            if pixels > MAX_TOTAL_PIXELS:
                raise NotApplicable()

            raw = obj.read_raw_bytes()
            with Image.open(io.BytesIO(raw), formats=("JPEG",)) as jpeg:
                if (
                    jpeg.size != (width, height)
                    or jpeg.mode != ("RGB" if color == "rgb" else "L")
                    or "icc_profile" in jpeg.info
                ):
                    if to_gray:
                        raise NotApplicable()
                    continue
                ratio = min(1, target_dpi / dpi)
                size = (math.ceil(width * ratio), math.ceil(height * ratio))
                with jpeg.convert("L" if to_gray else jpeg.mode) as converted:
                    with converted.resize(size, Image.Resampling.LANCZOS) as image:
                        encoded = io.BytesIO()
                        image.save(encoded, format="JPEG", quality=quality, optimize=True)
                replacement = encoded.getvalue()
            if not to_gray and len(replacement) >= len(raw):
                continue

            obj.write(replacement, filter=pikepdf.Name.DCTDecode)
            if "/DecodeParms" in obj:
                del obj["/DecodeParms"]
            obj["/Width"], obj["/Height"] = size
            if to_gray:
                obj["/ColorSpace"] = pikepdf.Name.DeviceGray
            changed = True

        if not changed:
            raise NotApplicable()
        pdf.save(output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--target-dpi", type=int, required=True, choices=range(72, 601), metavar="72..600")
    parser.add_argument("--quality", type=int, required=True, choices=range(1, 96), metavar="1..95")
    parser.add_argument("--mode", choices=("grayscale", "preserve"), required=True)
    args = parser.parse_args()

    try:
        transform(args.input, args.output, args.target_dpi, args.quality, args.mode == "grayscale")
    except NotApplicable:
        return 2
    except (OSError, ValueError, RuntimeError, pikepdf.PdfError, Image.DecompressionBombError):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
