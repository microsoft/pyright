import sys

from gevent.resolver.cares import *

if sys.platform != "win32":
    __all__ = ["channel"]
