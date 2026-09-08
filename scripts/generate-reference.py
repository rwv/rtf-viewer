#!/usr/bin/env python3
"""Generate the repository's original CC0 RTF fixtures and image payloads."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SYNTHETIC = ROOT / "fixtures" / "synthetic"
ASSETS = SYNTHETIC / "assets"


def write_text(name: str, value: str) -> None:
    (SYNTHETIC / name).write_bytes(value.replace("\n", "\r\n").encode("ascii"))


def image_bytes(image_format: str) -> bytes:
    image = Image.new("RGB", (16, 12))
    pixels = image.load()
    for y in range(12):
        for x in range(16):
            pixels[x, y] = (
                220 if x < 8 else 35,
                65 if y < 6 else 175,
                45 if (x + y) % 2 == 0 else 210,
            )
    output = io.BytesIO()
    options = {"optimize": False, "quality": 90, "subsampling": 0} if image_format == "JPEG" else {"optimize": False}
    image.save(output, format=image_format, **options)
    return output.getvalue()


def hex_lines(payload: bytes, width: int = 64) -> str:
    encoded = payload.hex().upper()
    return "\n".join(encoded[index : index + width] for index in range(0, len(encoded), width))


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)

    png = image_bytes("PNG")
    jpeg = image_bytes("JPEG")
    (ASSETS / "inline-pattern.png").write_bytes(png)
    (ASSETS / "inline-pattern.jpg").write_bytes(jpeg)

    write_text(
        "common-text-styles.rtf",
        r"""{\rtf1\ansi\ansicpg1252\deff0
{\fonttbl{\f0\froman\fcharset0 Liberation Serif;}}
\paperw12240\paperh15840\margl1800\margr1800\margt1440\margb1440
\f0\fs24 Plain text.\par
\b Bold text.\b0\par
\i Italic text.\i0\par
\ul Underlined text.\ulnone\par
\strike Struck text.\strike0\par
\b\i\ul Combined style.\ulnone\i0\b0\par
}""",
    )

    write_text(
        "unicode-en-zh.rtf",
        r"""{\rtf1\ansi\ansicpg1252\deff0\uc1
{\fonttbl{\f0\fswiss\fcharset0 Liberation Sans;}}
\paperw12240\paperh15840\margl1800\margr1800\margt1440\margb1440
\f0\fs24 English: Hello, world!\par
Chinese: \u20013?\u25991? \u20320?\u22909?\u19990?\u30028?\par
Mixed: RTF \u25991?\u26412? 2026.\par
}""",
    )

    auto_lines = "\n".join(f"Automatic line {index:02d}.\\par" for index in range(1, 25))
    write_text(
        "automatic-pagination.rtf",
        """{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Liberation Serif;}}
\\paperw4320\\paperh4320\\margl360\\margr360\\margt360\\margb360
\\f0\\fs24\\sl-240\\slmult0
""" + auto_lines + "\n}",
    )

    write_text(
        "explicit-pages.rtf",
        r"""{\rtf1\ansi\ansicpg1252\deff0
{\fonttbl{\f0\froman\fcharset0 Liberation Serif;}}
\paperw12240\paperh15840\margl1800\margr1800\margt1440\margb1440
\f0\fs24 Page one marker.\page
Page two marker.\page
Page three marker.\par
}""",
    )

    write_text(
        "indents-spacing.rtf",
        r"""{\rtf1\ansi\ansicpg1252\deff0
{\fonttbl{\f0\froman\fcharset0 Liberation Serif;}}
\paperw12240\paperh15840\margl1800\margr1800\margt1440\margb1440
\f0\fs24
\pard\li720\ri720\fi360\sb240\sa360 First-line indent marker followed by enough words to wrap onto a second line within the narrowed paragraph measure.\par
\pard\li1080\fi-360\sl360\slmult1 Hanging indent marker followed by enough words to wrap onto a second line and demonstrate the hanging body position.\par
}""",
    )

    write_text(
        "inline-png-jpeg.rtf",
        """{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\fswiss\\fcharset0 Liberation Sans;}}
\\paperw12240\\paperh15840\\margl1800\\margr1800\\margt1440\\margb1440
\\f0\\fs24 PNG, 16 by 12 pixels, displayed at 36 by 27 points:\\par
{\\pict\\pngblip\\picw16\\pich12\\picwgoal720\\pichgoal540
""" + hex_lines(png) + "\n}\n\\par\nJPEG, 16 by 12 pixels, displayed at 36 by 27 points:\\par\n{\\pict\\jpegblip\\picw16\\pich12\\picwgoal720\\pichgoal540\n" + hex_lines(jpeg) + "\n}\n\\par\n}",
    )

    row_definition = (
        r"\trowd\trgaph0"
        r"\trpaddfl3\trpaddl60\trpaddfr3\trpaddr60\trpaddft3\trpaddt40\trpaddfb3\trpaddb40"
        r"\trbrdrt\brdrs\brdrw20\trbrdrl\brdrs\brdrw20"
        r"\trbrdrb\brdrs\brdrw20\trbrdrr\brdrs\brdrw20"
        r"\trbrdrh\brdrs\brdrw10\trbrdrv\brdrs\brdrw10"
    )
    boundaries = r"\cellx1200\cellx2400\cellx3600"
    cell_start = r"\pard\intbl\sl-240\slmult0 "

    def table_row(cells: list[str], extra: str = "") -> str:
        definition = row_definition + extra + boundaries
        body = "".join(cell_start + text + "\\cell" for text in cells)
        return definition + "\n" + body + "\\row"

    tall_cell = "\\par ".join(f"Line {index}." for index in range(1, 9))
    write_text(
        "ordinary-table.rtf",
        r"""{\rtf1\ansi\ansicpg1252\deff0
{\fonttbl{\f0\froman\fcharset0 Liberation Serif;}}
{\colortbl;\red32\green84\blue147;}
\paperw4320\paperh4320\margl360\margr360\margt360\margb360
\f0\fs24\sl-240\slmult0
"""
        + "\n".join(
            [
                table_row(["Region", "Units", "Share"]),
                table_row(["North", "1200", "42%"]),
                table_row([r"Two\line lines", "980", "34%"]),
                table_row(["Exact", "700", "24%"], extra=r"\trrh-480"),
                table_row([tall_cell, "Right", "Cell"]),
            ]
        )
        + "\n\\pard\\sl-240\\slmult0 After the table.\\par\n}",
    )

    fill_row_definition = (
        r"\trowd\trgaph0"
        r"\trpaddfl3\trpaddl60\trpaddfr3\trpaddr60\trpaddft3\trpaddt40\trpaddfb3\trpaddb40"
        r"\trbrdrt\brdrs\brdrw20\trbrdrl\brdrs\brdrw20"
        r"\trbrdrb\brdrs\brdrw20\trbrdrr\brdrs\brdrw20"
        r"\trbrdrh\brdrs\brdrw10\trbrdrv\brdrs\brdrw10"
    )

    def fill_row(cells: list[str], properties: list[str], extra: str = "") -> str:
        definition = fill_row_definition + extra
        for cell_properties, boundary in zip(properties, [1200, 2400, 3600], strict=True):
            definition += cell_properties + f"\\cellx{boundary}"
        body = "".join(cell_start + text + "\\cell" for text in cells)
        return definition + "\n" + body + "\\row"

    write_text(
        "table-cell-fill-align.rtf",
        r"""{\rtf1\ansi\ansicpg1252\deff0
{\fonttbl{\f0\froman\fcharset0 Liberation Serif;}}
{\colortbl;\red32\green84\blue147;\red230\green230\blue230;}
\paperw4320\paperh4320\margl360\margr360\margt360\margb360
\f0\fs24\sl-240\slmult0
"""
        + "\n".join(
            [
                # The row declares one background and every cell inherits it.
                fill_row(["Head A", "Head B", "Head C"], ["", "", ""], extra=r"\trcbpat2"),
                # A half-intensity blend, then centred and bottom-aligned single lines beside
                # a cell that is two lines tall.
                fill_row(
                    [r"Two\line lines", "Middle", "Bottom"],
                    [r"\clcbpat2\clcfpat1\clshdng5000", r"\clvertalc", r"\clvertalb"],
                ),
                # Alignment against an exact row height rather than the tallest cell.
                fill_row(
                    ["Centred", "Plain", "Plain"],
                    [r"\clvertalc", "", ""],
                    extra=r"\trrh-480",
                ),
            ]
        )
        + "\n\\pard\\sl-240\\slmult0 After the table.\\par\n}",
    )

    def merged_row(cells: list[str], properties: list[str], boundaries: list[int]) -> str:
        definition = fill_row_definition
        for cell_properties, boundary in zip(properties, boundaries, strict=True):
            definition += cell_properties + f"\\cellx{boundary}"
        body = "".join(cell_start + text + "\\cell" for text in cells)
        return definition + "\n" + body + "\\row"

    write_text(
        "table-merged-cells.rtf",
        r"""{\rtf1\ansi\ansicpg1252\deff0
{\fonttbl{\f0\froman\fcharset0 Liberation Serif;}}
\paperw4320\paperh4320\margl360\margr360\margt360\margb360
\f0\fs24\sl-240\slmult0
"""
        + "\n".join(
            [
                # A header whose first two columns are one merged cell.
                merged_row(
                    ["Merged head", "", "Third"],
                    [r"\clmgf", r"\clmrg", ""],
                    [1200, 2400, 3600],
                ),
                # An ordinary row underneath keeps all three columns.
                merged_row(["One", "Two", "Three"], ["", "", ""], [1200, 2400, 3600]),
                # A merge that runs to the end of the row.
                merged_row(
                    ["First", "Spans the rest", ""],
                    ["", r"\clmgf", r"\clmrg"],
                    [1200, 2400, 3600],
                ),
            ]
        )
        + "\n\\pard\\sl-240\\slmult0 After the table.\\par\n}",
    )

    write_text(
        "showcase.rtf",
        """{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1
{\\fonttbl{\\f0\\froman\\fcharset0 Liberation Serif;}{\\f1\\fswiss\\fcharset0 Liberation Sans;}}
{\\colortbl;\\red32\\green84\\blue147;}
\\paperw8640\\paperh10800\\margl900\\margr900\\margt900\\margb900
\\f1\\fs36\\b\\cf1 RTF Rendering Showcase\\cf0\\b0\\par
\\fs20 Original CC0 compatibility document\\par
\\f0\\fs24\\sb240\\sa160 This page combines \\b bold\\b0, \\i italic\\i0, and \\ul underlined\\ulnone{} text.\\par
\\li540\\fi-270 A hanging paragraph makes continuation lines begin to the right of this marker and exercises paragraph geometry.\\par
\\pard\\sb180 English and Chinese Unicode: Hello / \\u20320?\\u22909? / \\u19990?\\u30028?.\\par
\\pard\\sb240 Inline PNG pattern:\\par
{\\pict\\pngblip\\picw16\\pich12\\picwgoal1440\\pichgoal1080
""" + hex_lines(png) + "\n}\n\\page\n\\f1\\fs28\\b Second page\\b0\\par\n\\f0\\fs24\\sb240 This marker follows an explicit page break.\\par\n\\sb240 Inline JPEG pattern:\\par\n{\\pict\\jpegblip\\picw16\\pich12\\picwgoal1440\\pichgoal1080\n" + hex_lines(jpeg) + "\n}\n\\par\n}",
    )


if __name__ == "__main__":
    main()
