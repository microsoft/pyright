# This sample tests static expression forms that are supported
# in the binder.

import sys
import os

x: int

if sys.platform == "linux":
    x = 1
else:
    x = "error!"

if sys.version_info >= (3, 9):
    x = 1
else:
    x = "error!"

if os.name == "posix":
    x = 1
else:
    x = "error!"

if True:
    x = 1
else:
    x = "error!"

if not False:
    x = 1
else:
    x = "error!"

DEFINED_TRUE = True
DEFINED_FALSE = False

if DEFINED_TRUE:
    x = 1
else:
    x = "error!"

if not DEFINED_FALSE:
    x = 1
else:
    x = "error!"

DEFINED_STR = "hi!"

if DEFINED_STR == "hi!":
    x = 1
else:
    x = "error!"


class Dummy:
    DEFINED_FALSE: bool
    DEFINED_TRUE: bool
    DEFINED_STR: str


dummy = Dummy()

if dummy.DEFINED_TRUE:
    x = 1
else:
    x = "error!"

if not dummy.DEFINED_FALSE:
    x = 1
else:
    x = "error!"

if dummy.DEFINED_STR == "hi!":
    x = 1
else:
    x = "error!"
