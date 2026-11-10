# This sample tests that a module-scope "Final" variable resolves to the
# literal value of its initializer when it is read from another module, where
# code flow analysis can't narrow the declared type.

from typing import Literal

from typing_extensions import assert_type  # pyright: ignore[reportMissingModuleSource]

from . import final9

from .final9 import (
    Base,
    ClassWithFinal,
    IS_WIN,
    IS_WIN_INFERRED,
    ITEMS,
    MAYBE_WIN,
    NO_INFO,
)

# The declared type is "bool", but the variable can't be rebound, so the
# literal value is exposed. This keeps a platform check usable as a static
# condition in every module that reads it.
assert_type(IS_WIN, Literal[False])
assert_type(IS_WIN_INFERRED, Literal[False])
assert_type(final9.IS_WIN, Literal[False])

# A non-"Final" annotation can be assigned a different value, so the declared
# type is retained.
assert_type(MAYBE_WIN, bool)

# Only literal values are exposed. Widening any other inferred type would leak
# a subclass into every variable that is inferred from such a read.
assert_type(NO_INFO, Base)

# "Final" members declared in a class can still be assigned in a constructor,
# so the declared type remains authoritative.
assert_type(ClassWithFinal.class_final, int)
assert_type(ClassWithFinal.class_var, int)

# A mutable value has no statically known truthiness, so it isn't exposed as a
# literal.
assert_type(ITEMS, list[int])
