# comment_heavy.py — many type: ignore / pyright: ignore / noqa comments
# Stresses the tokenizer's comment directive scanning paths.

from typing import Any, Dict, List, Optional, Tuple, Union

# --- type: ignore variants ---

x1: int = "not_int"  # type: ignore
x2: str = 42  # type: ignore
x3: float = "nope"  # type: ignore
x4: bool = 123  # type: ignore
x5: bytes = 456  # type: ignore

x6: int = "a"  # type: ignore[assignment]
x7: str = 1  # type: ignore[assignment]
x8: float = True  # type: ignore[assignment]
x9: bool = None  # type: ignore[assignment]
x10: bytes = []  # type: ignore[assignment]

x11 = undefined_name  # type: ignore[name-defined]
x12 = another_undefined  # type: ignore[name-defined]
x13 = yet_another  # type: ignore[name-defined]

# --- pyright: ignore variants ---

y1: int = "not_int"  # pyright: ignore
y2: str = 42  # pyright: ignore
y3: float = "nope"  # pyright: ignore
y4: bool = 123  # pyright: ignore
y5: bytes = 456  # pyright: ignore

y6: int = "a"  # pyright: ignore[reportAssignmentType]
y7: str = 1  # pyright: ignore[reportAssignmentType]
y8: float = True  # pyright: ignore[reportAssignmentType]
y9: bool = None  # pyright: ignore[reportAssignmentType]
y10: bytes = []  # pyright: ignore[reportAssignmentType]

y11: int = "str"  # pyright: ignore[reportAssignmentType, reportGeneralClassIssues]
y12: str = 42  # pyright: ignore[reportAssignmentType, reportGeneralClassIssues]

# --- noqa comments ---

import os  # noqa: F401
import sys  # noqa: F401
import re  # noqa
import json  # noqa: E302
import csv  # noqa: F401, E302
import io  # noqa

# --- Mixed comments ---

z1: int = "str"  # type: ignore  # noqa: F841
z2: str = 42  # type: ignore[assignment]  # noqa
z3 = undefined  # type: ignore[name-defined]  # noqa: F821
z4: int = "nope"  # pyright: ignore  # noqa: F841
z5: int = "nope"  # pyright: ignore[reportAssignmentType]  # noqa

# --- Regular comments (should be fast-rejected by directive scanner) ---

# This is a regular comment
# Another regular comment
# Yet another regular comment that is quite long and spans many characters to stress the scanner
# Regular comment with some keywords: def class import return if else
# Regular comment mentioning ignore but not as a directive
# A comment that says "type" but is not a type: ignore
# type: This looks similar but is not a valid directive
# pyright: This also looks similar but is not valid

# --- Doc comments (hash-prefixed) ---

# Module: comment_heavy
# Purpose: Stress test comment directive scanning
# Author: Benchmark generator
# Date: 2024-01-01
# Version: 1.0.0

# --- Function with many ignored lines ---


def poorly_typed_function(
    a,  # type: ignore
    b,  # type: ignore
    c,  # type: ignore
    d,  # type: ignore
    e,  # type: ignore
) -> None:  # type: ignore
    result = a + b  # type: ignore
    result2 = c * d  # type: ignore
    result3 = e ** 2  # type: ignore
    final = result + result2 + result3  # type: ignore
    return final  # type: ignore


def another_poorly_typed(x, y, z):  # type: ignore
    # type: ignore on every line
    a: int = x  # type: ignore
    b: str = y  # type: ignore
    c: float = z  # type: ignore
    d: bool = a + b  # type: ignore
    e: bytes = c + d  # type: ignore
    f: list = e * 2  # type: ignore
    g: dict = f + 1  # type: ignore
    h: tuple = g - 1  # type: ignore
    i: set = h / 2  # type: ignore
    j: int = i + j  # type: ignore  # noqa: F821
    return (a, b, c, d, e, f, g, h, i, j)  # type: ignore


# --- Class with pyright: ignore ---


class IgnoredClass:
    x: int = "not_int"  # pyright: ignore[reportAssignmentType]
    y: str = 42  # pyright: ignore[reportAssignmentType]

    def __init__(self) -> None:
        self.a: int = "str"  # pyright: ignore[reportAssignmentType]
        self.b: str = 42  # pyright: ignore[reportAssignmentType]
        self.c: float = "3.14"  # pyright: ignore[reportAssignmentType]
        self.d: bool = "True"  # pyright: ignore[reportAssignmentType]

    def method1(self) -> int:  # type: ignore
        return "not_int"  # type: ignore

    def method2(self) -> str:  # type: ignore
        return 42  # type: ignore

    def method3(self) -> float:  # type: ignore
        return True  # type: ignore

    def method4(self) -> bool:  # type: ignore
        return 3.14  # type: ignore

    def method5(self) -> bytes:  # type: ignore
        return "string"  # type: ignore

    def method6(self) -> list:  # type: ignore
        return 123  # type: ignore

    def method7(self) -> dict:  # type: ignore
        return [1, 2, 3]  # type: ignore

    def method8(self) -> tuple:  # type: ignore
        return {1: 2}  # type: ignore

    def method9(self) -> set:  # type: ignore
        return (1, 2, 3)  # type: ignore

    def method10(self) -> None:  # type: ignore
        pass  # type: ignore


# --- Bulk ignore blocks (100 lines) ---


def bulk_ignores_1():
    v1 = undefined_1  # type: ignore[name-defined]
    v2 = undefined_2  # type: ignore[name-defined]
    v3 = undefined_3  # type: ignore[name-defined]
    v4 = undefined_4  # type: ignore[name-defined]
    v5 = undefined_5  # type: ignore[name-defined]
    v6 = undefined_6  # type: ignore[name-defined]
    v7 = undefined_7  # type: ignore[name-defined]
    v8 = undefined_8  # type: ignore[name-defined]
    v9 = undefined_9  # type: ignore[name-defined]
    v10 = undefined_10  # type: ignore[name-defined]
    v11 = undefined_11  # pyright: ignore[reportUndefinedVariable]
    v12 = undefined_12  # pyright: ignore[reportUndefinedVariable]
    v13 = undefined_13  # pyright: ignore[reportUndefinedVariable]
    v14 = undefined_14  # pyright: ignore[reportUndefinedVariable]
    v15 = undefined_15  # pyright: ignore[reportUndefinedVariable]
    v16 = undefined_16  # pyright: ignore[reportUndefinedVariable]
    v17 = undefined_17  # pyright: ignore[reportUndefinedVariable]
    v18 = undefined_18  # pyright: ignore[reportUndefinedVariable]
    v19 = undefined_19  # pyright: ignore[reportUndefinedVariable]
    v20 = undefined_20  # pyright: ignore[reportUndefinedVariable]
    return None


def bulk_ignores_2():
    # 20 more lines with mixed directives
    a1: int = "wrong"  # type: ignore[assignment]
    a2: str = 42  # type: ignore[assignment]
    a3: float = True  # type: ignore[assignment]
    a4: bool = 3.14  # type: ignore[assignment]
    a5: bytes = None  # type: ignore[assignment]
    a6: list = 42  # type: ignore[assignment]
    a7: dict = "str"  # type: ignore[assignment]
    a8: tuple = False  # type: ignore[assignment]
    a9: set = 3.14  # type: ignore[assignment]
    a10: int = None  # type: ignore[assignment]
    b1: int = "wrong"  # pyright: ignore[reportAssignmentType]
    b2: str = 42  # pyright: ignore[reportAssignmentType]
    b3: float = True  # pyright: ignore[reportAssignmentType]
    b4: bool = 3.14  # pyright: ignore[reportAssignmentType]
    b5: bytes = None  # pyright: ignore[reportAssignmentType]
    b6: list = 42  # pyright: ignore[reportAssignmentType]
    b7: dict = "str"  # pyright: ignore[reportAssignmentType]
    b8: tuple = False  # pyright: ignore[reportAssignmentType]
    b9: set = 3.14  # pyright: ignore[reportAssignmentType]
    b10: int = None  # pyright: ignore[reportAssignmentType]
    return None


# --- Lines with NO comments at all (to test non-comment fast path) ---


def clean_function_1(a: int, b: str, c: float) -> Tuple[int, str, float]:
    x = a + 1
    y = b + " world"
    z = c * 2.0
    return (x, y, z)


def clean_function_2(items: List[int]) -> Dict[str, int]:
    result: Dict[str, int] = {}
    total = 0
    for i, item in enumerate(items):
        key = f"item_{i}"
        result[key] = item
        total += item
    result["total"] = total
    result["count"] = len(items)
    result["average"] = total // max(len(items), 1)
    return result


def clean_function_3(
    data: Dict[str, Any],
    keys: List[str],
    default: Any = None,
) -> List[Any]:
    return [data.get(k, default) for k in keys]


def clean_function_4(matrix: List[List[int]]) -> List[List[int]]:
    if not matrix:
        return []
    rows = len(matrix)
    cols = len(matrix[0])
    transposed: List[List[int]] = []
    for j in range(cols):
        row: List[int] = []
        for i in range(rows):
            row.append(matrix[i][j])
        transposed.append(row)
    return transposed


def clean_function_5(text: str, width: int = 80) -> List[str]:
    words = text.split()
    lines: List[str] = []
    current_line: List[str] = []
    current_length = 0
    for word in words:
        if current_length + len(word) + len(current_line) > width:
            lines.append(" ".join(current_line))
            current_line = [word]
            current_length = len(word)
        else:
            current_line.append(word)
            current_length += len(word)
    if current_line:
        lines.append(" ".join(current_line))
    return lines


# --- Inline type comments (old-style annotations) ---


def old_style_annotations():
    a = 42  # type: int
    b = "hello"  # type: str
    c = 3.14  # type: float
    d = True  # type: bool
    e = None  # type: Optional[int]
    f = [1, 2, 3]  # type: List[int]
    g = {"a": 1}  # type: Dict[str, int]
    h = (1, "a")  # type: Tuple[int, str]
    i = {1, 2, 3}  # type: Set[int]
    return (a, b, c, d, e, f, g, h, i)


# End of comment_heavy.py
