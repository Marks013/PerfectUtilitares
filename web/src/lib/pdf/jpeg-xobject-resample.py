"""Re-encode supported JPEG XObjects without rebuilding PDF pages."""

import argparse
import io
import json
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


def estimated_gain_priority(pdf, use, target_dpi):
    key, (width, height, _color, supported, dpi) = use
    pixels = width * height
    if not supported or not 0 < pixels <= MAX_IMAGE_PIXELS or dpi <= target_dpi:
        return (0.0, 0.0, key)
    obj = pdf.get_object(key)
    length = obj.get("/Length", 0) if isinstance(obj, pikepdf.Stream) else 0
    if not isinstance(length, int) or length <= 0:
        return (0.0, 0.0, key)
    # An ordering heuristic, not a predicted compression result. No JPEG is
    # loaded or decoded to score it, and ties use the PDF's object identity.
    gain = length * (1 - (target_dpi / dpi) ** 2)
    return (-gain / pixels, -gain, key)


def transform(source, output, target_dpi, quality, grayscale, allow_partial=False, *, prioritize_savings=False):
    if prioritize_savings and (grayscale or not allow_partial):
        raise ValueError("Savings prioritization requires partial, tone-preserving recompression")
    changed = 0
    pixels = 0
    skipped = 0
    stopped_early = False
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

        uses = get_uses(source, grayscale).items()
        if prioritize_savings:
            uses = sorted(uses, key=lambda use: estimated_gain_priority(pdf, use, target_dpi))
        for key, (width, height, color, supported, dpi) in uses:
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
            image_pixels = width * height
            if pixels + image_pixels > MAX_TOTAL_PIXELS:
                # Keep work already done only for a tone-preserving request.
                if allow_partial and not grayscale:
                    skipped += 1
                    if prioritize_savings:
                        continue
                    stopped_early = True
                    break
                raise NotApplicable()
            pixels += image_pixels

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
            changed += 1

        if not changed:
            raise NotApplicable()
        pdf.save(output)
    return {
        "imagesRewritten": changed,
        "decodedPixels": pixels,
        "budgetSkippedImages": skipped,
        "stoppedEarly": stopped_early,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--target-dpi", type=int, required=True, choices=range(72, 601), metavar="72..600")
    parser.add_argument("--quality", type=int, required=True, choices=range(1, 96), metavar="1..95")
    parser.add_argument("--mode", choices=("grayscale", "preserve"), required=True)
    parser.add_argument("--allow-partial", action="store_true")
    parser.add_argument("--prioritize-savings", action="store_true", help="Offline experiment: order eligible JPEGs by estimated savings per source pixel")
    parser.add_argument("--report", action="store_true", help="Print aggregate recompression counters after success")
    args = parser.parse_args()
    if args.prioritize_savings and (not args.allow_partial or args.mode != "preserve"):
        parser.error("--prioritize-savings requires --mode preserve and --allow-partial")

    try:
        stats = transform(
            args.input, args.output, args.target_dpi, args.quality, args.mode == "grayscale", args.allow_partial,
            prioritize_savings=args.prioritize_savings,
        )
    except NotApplicable:
        return 2
    except (OSError, ValueError, RuntimeError, pikepdf.PdfError, Image.DecompressionBombError):
        return 1
    if args.report:
        print(json.dumps(stats, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
