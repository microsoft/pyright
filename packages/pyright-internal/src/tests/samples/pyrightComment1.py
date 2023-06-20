# This sample tests error handling for pyright comments.

# This should generate an error because "stricter" isn't a valid directive.
#  pyright:    basic  ,   stricter

# This should generate an error because it's missing a directive.
#   pyright:

# This should generate an error because the value is missing.
# pyright: reportMissingTypeStubs

# This should generate an error because the value is missing.
# pyright: reportMissingTypeStubs=

# This should generate two errors because the values are invalid.
# pyright: reportMissingTypeStubs = blah , strictListInference = none

# This should generate two errors because the rule is invalid.
# pyright: reportBlahBlah = true

# This should generate an error because it's not on its own line.
a = 1  # pyright: reportGeneralTypeIssues=false


def func1():
    # This should generate an error because it's not on its own line.
    # pyright: reportGeneralTypeIssues=false
    pass
