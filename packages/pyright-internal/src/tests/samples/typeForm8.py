# This sample tests that a string literal nested within a container literal
# is interpreted as a stringified TypeForm when the expected element
# type is a TypeForm.

# pyright: reportMissingModuleSource=false

from typing import Union
from typing_extensions import TypeForm


# The string elements should be interpreted as stringified TypeForms
# (rather than as plain strs), so these assignments should not generate errors.
v1: list[TypeForm] = ["int", "str"]
v2: dict[str, TypeForm] = {"key": "int"}
v3: tuple[TypeForm, TypeForm] = ("int", "str | None")
v4: set[TypeForm] = {"int | str"}
v5: list[TypeForm[int]] = ["int"]


# Nested containers should propagate the expected TypeForm type as well.
v6: list[list[TypeForm]] = [["int", "str"]]
v7: dict[str, list[TypeForm]] = {"key": ["int", "str"]}


# This should generate an error because "int[str]" is not a valid type
# expression, so it falls back to a plain str that is not assignable to a
# TypeForm element.
v8: list[TypeForm] = ["int[str]"]

# This should generate an error because "int" is interpreted as TypeForm[int],
# which is not assignable to a TypeForm[str] element. (Compare with v5, which
# uses TypeForm[int] and is accepted. This confirms the string is interpreted
# as a type rather than left as a plain str.)
v9: list[TypeForm[str]] = ["int"]


# When the expected element type is not a TypeForm, the string should remain
# a plain str.
v10: list[str] = ["int"]
reveal_type(v10, expected_text="list[str]")

# A Union element type that includes a TypeForm should still trigger
# interpretation of the string as a stringified TypeForm.
v11: list[Union[TypeForm, int]] = ["int"]
