from .foo import exported_function
#                ^^^^^^^^^^^^^^^^^ reference lsif-pyright pypi bar 0.0 bar/exported_function.
from .foo import this_class

if True:
    exported_function()
#   ^^^^^^^^^^^^^^^^^ reference lsif-pyright pypi bar 0.0 bar/exported_function.

    this_class.exported_function()
#              ^^^^^^^^^^^^^^^^^ reference lsif-pyright pypi bar 0.0 MyClass#exported_function().

