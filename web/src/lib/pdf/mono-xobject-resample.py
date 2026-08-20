#!/usr/bin/env python3
# PERFECT_PDF_MONO_XOBJECT_V5
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from pikepdf import Name, Pdf, PdfImage


def fail(message: str) -> None:
    raise SystemExit(f"ERRO: {message}")


def object_key(obj):
    try:
        objgen = tuple(obj.objgen)
    except Exception:
        return ("direct", id(obj))
    return ("obj", objgen) if objgen != (0, 0) else ("direct", id(obj))


def get_resources(container):
    try:
        return container.get("/Resources")
    except Exception:
        return None


def has_filter(obj, filter_name: str) -> bool:
    try:
        value = obj.get("/Filter")
    except Exception:
        return False
    return filter_name in str(value)


def encode_jbig2_lossless(binary: Image.Image) -> bytes:
    with tempfile.TemporaryDirectory(prefix="perfect-mono-") as temp_dir:
        pbm = Path(temp_dir) / "image.pbm"
        binary.save(pbm)
        result = subprocess.run(
            ["jbig2", "-p", str(pbm)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    if result.returncode != 0:
        fail(
            "jbig2 falhou: "
            + result.stderr.decode("utf-8", errors="replace")
        )
    if not result.stdout:
        fail("jbig2 produziu stream vazio")
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--source-dpi", type=int, required=True)
    parser.add_argument("--target-dpi", type=int, required=True)
    parser.add_argument("--threshold", type=int, default=160)
    parser.add_argument("--min-dimension", type=int, default=1000)
    args = parser.parse_args()

    source = Path(args.input)
    output = Path(args.output)

    if not source.is_file():
        fail(f"arquivo não encontrado: {source}")
    if not (72 <= args.target_dpi < args.source_dpi):
        fail("target-dpi inválido")
    if not (1 <= args.threshold <= 254):
        fail("threshold inválido")

    ratio = args.target_dpi / args.source_dpi
    processed_images = set()
    visited_forms = set()
    changed = 0
    small = 0
    non_jbig2 = 0
    non_mono = 0
    masked = 0

    def process_image(obj) -> None:
        nonlocal changed, small, non_jbig2, non_mono, masked

        key = object_key(obj)
        if key in processed_images:
            return
        processed_images.add(key)

        if not has_filter(obj, "JBIG2Decode"):
            non_jbig2 += 1
            return

        try:
            width = int(obj.get("/Width", 0))
            height = int(obj.get("/Height", 0))
            bpc = int(obj.get("/BitsPerComponent", 0))
        except Exception:
            non_mono += 1
            return

        colorspace = str(obj.get("/ColorSpace", ""))
        if bpc != 1 or "DeviceGray" not in colorspace:
            non_mono += 1
            return

        if (
            bool(obj.get("/ImageMask", False))
            or obj.get("/SMask") is not None
            or obj.get("/Mask") is not None
        ):
            masked += 1
            return

        if width < args.min_dimension or height < args.min_dimension:
            small += 1
            return

        new_width = max(1, round(width * ratio))
        new_height = max(1, round(height * ratio))

        try:
            pil = PdfImage(obj).as_pil_image().convert("L")
        except Exception as exc:
            fail(f"não foi possível decodificar imagem JBIG2: {exc}")

        resized = pil.resize(
            (new_width, new_height),
            Image.Resampling.LANCZOS,
        )
        lut = [0 if value <= args.threshold else 255 for value in range(256)]
        binary = resized.point(lut).convert("1", dither=Image.Dither.NONE)
        encoded = encode_jbig2_lossless(binary)

        obj.write(encoded, filter=Name("/JBIG2Decode"))
        obj["/Type"] = Name("/XObject")
        obj["/Subtype"] = Name("/Image")
        obj["/Width"] = new_width
        obj["/Height"] = new_height
        obj["/ColorSpace"] = Name("/DeviceGray")
        obj["/BitsPerComponent"] = 1

        for obsolete in ("/Decode", "/DecodeParms"):
            if obsolete in obj:
                del obj[obsolete]

        changed += 1

    def walk(resources) -> None:
        if resources is None:
            return
        try:
            xobjects = resources.get("/XObject")
        except Exception:
            xobjects = None
        if not xobjects:
            return

        for _, obj in xobjects.items():
            try:
                subtype = obj.get("/Subtype")
            except Exception:
                continue

            if subtype == Name("/Image"):
                process_image(obj)
                continue

            if subtype == Name("/Form"):
                key = object_key(obj)
                if key in visited_forms:
                    continue
                visited_forms.add(key)
                walk(get_resources(obj))

    with Pdf.open(source) as pdf:
        for page in pdf.pages:
            walk(get_resources(page.obj))

        if changed == 0:
            fail("nenhum XObject JBIG2 bilevel grande foi alterado")

        output.parent.mkdir(parents=True, exist_ok=True)
        pdf.save(output)

    if not output.is_file() or output.stat().st_size <= 0:
        fail("candidato não foi gravado")

    print(
        "PERFECT_MONO_XOBJECT "
        f"changed={changed} "
        f"small={small} non_jbig2={non_jbig2} "
        f"non_mono={non_mono} masked={masked} "
        f"target_dpi={args.target_dpi} threshold={args.threshold}"
    )


if __name__ == "__main__":
    main()
