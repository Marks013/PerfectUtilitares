"""Reconstruct editable worksheets without interpreting PDF text as formulas."""

import re
from decimal import Decimal, InvalidOperation

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


def _value(text):
    text = str(text or "").strip()
    # Bare integers can be identifiers. Only explicit decimal/currency notation
    # is sufficiently unambiguous to promote to a spreadsheet number.
    match = re.fullmatch(r"(R\$\s*)?(-?(?:[1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d*|0),\d{1,6})", text)
    if match:
        number = match.group(2).replace(".", "").replace(",", ".")
        if len(number.replace("-", "").replace(".", "")) <= 15:
            try:
                return Decimal(number), '"R$" #,##0.00' if match.group(1) else "0." + "0" * len(number.split(".")[1])
            except InvalidOperation:
                pass
    return text, None


def _write(sheet, row, column, text, header=False):
    value, number_format = _value(text)
    cell = sheet.cell(row, column, value)
    if isinstance(value, str):
        # Assignment normally treats '=...' as formula and '#N/A' as an error.
        cell.data_type = "s"
    if number_format:
        cell.number_format = number_format
    cell.alignment = Alignment(vertical="top", wrap_text=True)
    if header:
        cell.font = Font(bold=True, color="17365D")
        cell.fill = PatternFill("solid", fgColor="E8EFF7")
    return cell


def _inside(word, bbox):
    x = (word["x0"] + word["x1"]) / 2
    y = (word["top"] + word["bottom"]) / 2
    return bbox[0] - 1 <= x <= bbox[2] + 1 and bbox[1] - 1 <= y <= bbox[3] + 1


def _rows(words):
    rows = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        if not rows or abs(word["top"] - rows[-1][0]["top"]) > 3:
            rows.append([word])
        else:
            rows[-1].append(word)
    return [sorted(row, key=lambda item: item["x0"]) for row in rows]


def _confident_borderless(table, words):
    data = [row for row in table.extract() if any(cell and cell.strip() for cell in row)]
    if len(data) < 3 or len(data[0]) < 2 or len(data[0]) > 30:
        return False
    columns = len(data[0])
    if sum(sum(bool(cell and cell.strip()) for cell in row) >= columns * .7 for row in data) < len(data) * .8:
        return False
    # Text strategy can split an ordinary paragraph at every aligned word.
    # Require genuinely separated fields on most physical lines.
    lines = _rows([word for word in words if _inside(word, table.bbox)])
    separated = sum(any(right["x0"] - left["x1"] >= 14 for left, right in zip(line, line[1:])) for line in lines)
    return len(lines) >= 3 and separated >= len(lines) * .7


def _tables(page, words):
    ruled = [table for table in page.find_tables() if len(table.rows) >= 2 and len(table.columns) >= 2]
    candidates = page.find_tables({
        "vertical_strategy": "text", "horizontal_strategy": "text",
        "min_words_vertical": 3, "min_words_horizontal": 1,
        "text_x_tolerance": 2, "text_y_tolerance": 3,
    })
    for table in candidates:
        # Keep ruled extraction authoritative; overlapping text tables duplicate it.
        overlaps = any(not (table.bbox[2] <= other.bbox[0] or table.bbox[0] >= other.bbox[2]
                                or table.bbox[3] <= other.bbox[1] or table.bbox[1] >= other.bbox[3]) for other in ruled)
        if not overlaps and _confident_borderless(table, words):
            ruled.append(table)
    return sorted(ruled, key=lambda table: (table.bbox[1], table.bbox[0]))


def _write_table(sheet, start, table):
    data = table.extract(x_tolerance=2, y_tolerance=3)
    boundaries = sorted(set(round(cell[0], 2) for cell in table.cells) | set(round(cell[2], 2) for cell in table.cells))
    row_number = start
    first = True
    for source_row, cells in zip(table.rows, data):
        if not any(value and value.strip() for value in cells):
            continue
        # Coordinates, rather than None values, identify genuine spanning cells.
        for rectangle, text in zip(source_row.cells, cells):
            if rectangle is None:
                continue
            left = min(range(len(boundaries)), key=lambda index: abs(boundaries[index] - rectangle[0]))
            right = min(range(len(boundaries)), key=lambda index: abs(boundaries[index] - rectangle[2]))
            column = left + 1
            _write(sheet, row_number, column, text, header=first)
            if right > left + 1:
                sheet.merge_cells(start_row=row_number, end_row=row_number, start_column=column, end_column=right)
        first = False
        row_number += 1
    return row_number


def _write_text(sheet, start, words):
    for line in _rows(words):
        # Keep sentences intact; large whitespace separates real column fields.
        fields = [[]]
        previous = None
        for word in line:
            if previous is not None and word["x0"] - previous["x1"] >= 24:
                fields.append([])
            fields[-1].append(word["text"])
            previous = word
        for column, field in enumerate(fields, 1):
            _write(sheet, start, column, " ".join(field))
        start += 1
    return start


def export_excel(pdf, output_path):
    workbook = Workbook()
    workbook.remove(workbook.active)
    table_count = 0
    for page_number, original in enumerate(pdf.pages, 1):
        page = original
        try:
            if original.cropbox and original.cropbox != original.bbox:
                page = original.crop(original.cropbox, strict=False)
            sheet = workbook.create_sheet(f"Página {page_number}")
            words = page.extract_words(x_tolerance=2, y_tolerance=3)
            tables = _tables(page, words)
            table_count += len(tables)
            outside = [word for word in words if not any(_inside(word, table.bbox) for table in tables)]
            row = 1
            for table in tables:
                before = [word for word in outside if word["top"] < table.bbox[1]]
                outside = [word for word in outside if word["top"] >= table.bbox[1]]
                row = _write_text(sheet, row, before)
                row = _write_table(sheet, row, table) + 1
            _write_text(sheet, row, outside)
            if not words and not tables:
                _write(sheet, 1, 1, "Página sem texto reconhecível.")
            for column in sheet.columns:
                populated = [cell for cell in column if cell.value is not None]
                if populated:
                    width = max(max(len(line) for line in str(cell.value).splitlines() or [""]) for cell in populated)
                    sheet.column_dimensions[get_column_letter(column[0].column)].width = min(70, max(12, width + 2))
            sheet.freeze_panes = "A2"
            sheet.sheet_view.showGridLines = True
        finally:
            page.close()
            if page is not original:
                original.close()
    if not workbook.worksheets:
        workbook.create_sheet("Documento")
    workbook.save(output_path)
    workbook.close()
    return {"pages": len(pdf.pages), "tables": table_count}
