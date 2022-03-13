# This sample tests the handling of an unresolved import.
# It should report a single error but not have cascading
# errors when the unresolved symbol is used.

# This should generate an error.
import unresolved_import


def test_zero_division():
    with unresolved_import.raises(ZeroDivisionError):
        v = 1 / 0
