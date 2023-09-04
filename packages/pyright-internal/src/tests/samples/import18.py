# This should generate two errors because b and c overwrite declared
# types in an incompatible manner.
from .import17 import *

a: str
b: str
c: str

_d: str
__e__: str
g: str
