import sys

from gevent.resolver.ares import *

if sys.platform != "win32":
    __all__ = ["Resolver"]
