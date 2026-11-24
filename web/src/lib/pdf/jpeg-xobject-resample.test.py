"""Exercise the offline budget strategy with synthetic JPEG streams."""

import importlib.util
import io
import random
import unittest
from pathlib import Path
from unittest.mock import patch

import pikepdf
from PIL import Image


SPEC = importlib.util.spec_from_file_location(
    "jpeg_xobject_resample", Path(__file__).with_name("jpeg-xobject-resample.py")
)
RESAMPLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RESAMPLE)


def make_pdf():
    output = io.BytesIO()
    with pikepdf.Pdf.new() as pdf:
        pdf.docinfo["/Title"] = "Synthetic compression fixture"
        for index, texture in enumerate(("ramp", "noise")):
            image_bytes = io.BytesIO()
            data = (
                bytes((x + y) % 256 for y in range(64) for x in range(64))
                if texture == "ramp"
                else random.Random(849).randbytes(64 * 64)
            )
            with Image.frombytes("L", (64, 64), data) as image:
                image.save(image_bytes, format="JPEG", quality=95)
            stream = pdf.make_stream(
                image_bytes.getvalue(),
                Type=pikepdf.Name.XObject,
                Subtype=pikepdf.Name.Image,
                Filter=pikepdf.Name.DCTDecode,
                ColorSpace=pikepdf.Name.DeviceGray,
                BitsPerComponent=8,
                Width=64,
                Height=64,
            )
            page = pdf.add_blank_page(page_size=(300, 300))
            page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Scan=stream))
            page.Contents = pdf.make_stream(f"% page {index}\nq 16 0 0 16 24 24 cm /Scan Do Q".encode("ascii"))
        pdf.save(output)
    return output.getvalue()


def inspect(blob):
    with pikepdf.Pdf.open(io.BytesIO(blob), attempt_recovery=False) as pdf:
        streams = [page.Resources.XObject.Scan for page in pdf.pages]
        return (
            str(pdf.docinfo["/Title"]),
            [page.Contents.read_bytes() for page in pdf.pages],
            [int(stream.Width) for stream in streams],
            [stream.objgen for stream in streams],
        )


class BudgetPriorityTest(unittest.TestCase):
    def test_prefers_high_yield_image_under_same_budget_without_changing_pages(self):
        original = make_pdf()
        title, page_contents, widths, keys = inspect(original)
        uses = {key: (64, 64, "gray", True, 300) for key in keys}
        baseline, ordered = io.BytesIO(), io.BytesIO()
        with (
            patch.object(RESAMPLE, "get_uses", return_value=uses),
            patch.object(RESAMPLE, "MAX_TOTAL_PIXELS", 64 * 64),
        ):
            old = RESAMPLE.transform(io.BytesIO(original), baseline, 150, 72, False, True)
            new = RESAMPLE.transform(
                io.BytesIO(original), ordered, 150, 72, False, True, prioritize_savings=True
            )

        self.assertEqual(widths, [64, 64])
        self.assertEqual(inspect(baseline.getvalue())[:3], (title, page_contents, [32, 64]))
        self.assertEqual(inspect(ordered.getvalue())[:3], (title, page_contents, [64, 32]))
        self.assertLess(len(ordered.getvalue()), len(baseline.getvalue()))
        self.assertEqual(old["decodedPixels"], new["decodedPixels"])
        self.assertEqual(new["decodedPixels"], 64 * 64)
        self.assertEqual(new["budgetSkippedImages"], 1)
        self.assertTrue(old["stoppedEarly"])
        self.assertFalse(new["stoppedEarly"])

    def test_priority_cannot_be_used_for_conversion_or_strict_recompression(self):
        for grayscale, partial in ((True, True), (False, False)):
            with self.assertRaises(ValueError):
                RESAMPLE.transform(None, None, 150, 72, grayscale, partial, prioritize_savings=True)

    def test_strict_default_returns_no_candidate_when_budget_is_exceeded(self):
        original = make_pdf()
        keys = inspect(original)[3]
        output = io.BytesIO()
        with (
            patch.object(RESAMPLE, "get_uses", return_value={key: (64, 64, "gray", True, 300) for key in keys}),
            patch.object(RESAMPLE, "MAX_TOTAL_PIXELS", 64 * 64),
            self.assertRaises(RESAMPLE.NotApplicable),
        ):
            RESAMPLE.transform(io.BytesIO(original), output, 150, 72, False)
        self.assertEqual(output.getvalue(), b"")


if __name__ == "__main__":
    unittest.main()
