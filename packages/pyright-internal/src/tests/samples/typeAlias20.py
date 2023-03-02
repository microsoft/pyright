# This sample is used to test that TypeAlias can be aliased
# and re-exported. It is used with typeAlias19.py.

from .typeAlias19 import TA as TA2

TA3 = TA2

x: TA2 = dict[str, str]

y: x = {"": ""}
