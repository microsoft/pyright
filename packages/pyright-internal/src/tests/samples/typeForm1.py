# This sample tests basic usage of the TypeForm special form
# when used as a call.

# pyright: reportMissingModuleSource=false

from typing import Annotated
from typing_extensions import TypeForm

# This should generate an error because TypeForm requires one arg.
t1 = TypeForm()

# This should generate an error because TypeForm uses positional args only.
t2 = TypeForm(x=int)

# This should generate an error because TypeForm accepts only one arg.
t3 = TypeForm(int, str)

# This should generate an error because the type expression is invalid.
t4 = TypeForm("int[str]")


s1 = TypeForm(int)
reveal_type(s1, expected_text="TypeForm[int]")

s2 = TypeForm("int | str")
reveal_type(s2, expected_text="TypeForm[int | str]")

s3 = TypeForm(list["str"])
reveal_type(s3, expected_text="TypeForm[list[str]]")

s4 = TypeForm(Annotated[int, "meta"])
reveal_type(s4, expected_text="TypeForm[int]")
