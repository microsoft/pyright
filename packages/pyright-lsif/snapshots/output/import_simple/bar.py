from .foo import exported_function
#                ^^^^^^^^^^^^^^^^^ reference  foo 0.1 exported_function().
from .foo import this_class
#                ^^^^^^^^^^ reference  bar 0.0 foo/

if True:
    exported_function()
#   ^^^^^^^^^^^^^^^^^ reference  foo 0.1 exported_function().

    this_class.exported_function()
#   ^^^^^^^^^^ reference  bar 0.0 foo/
#              ^^^^^^^^^^^^^^^^^ reference  foo 0.1 MyClass#exported_function().

