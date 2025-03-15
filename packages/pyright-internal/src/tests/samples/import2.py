# This sample tests import resolution for relative imports.

from datetime import datetime

# This should generate an error because relative imports can
# be used only with the "from . import A" form.
import .package1 as p0

from . import package1 as p1
a = p1.foo()

from .package1 import foo
b = foo()

# This should generate an error because there is no
# directory or file named packageXXX.
from . import packageXXX as p2

from .package1.sub import subfoo
# subfoo should resolve to the package1/sub/__init__.py,
# which returns a datetime. Verify that it does.
c: datetime = subfoo()

from .package1.psyche import psyche1
# This should resolve to package1/psyche.py even though
# there is a package1/psyche directory present.
d: int = psyche1()
