# This sample tests the "reportConstantRedefinition" feature.

ALL_CAPS_123_ = 234
# This should generate an error if the feature is enabled.
ALL_CAPS_123_ = 233

_ = 234
# This should not be considered a constant
_ = 234


a = True


def foo():
    LOCALVAR = 3

    if a:
        # This should generate an error if the feature is enabled.
        LOCALVAR = 23


from typing import TYPE_CHECKING

# This should generate an error if the feature is enabled.
TYPE_CHECKING = True


class Foo(object):
    CONST_VAR = 3

    # This should generate an error if the feature is enabled.
    CONST_VAR = 4

    def __init__(self):
        self.HELLO = "3"

    def foo(self):
        # This should generate an error if the feature is enabled.
        self.HELLO = "324"
