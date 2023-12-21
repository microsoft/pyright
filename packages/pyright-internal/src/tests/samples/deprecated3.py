# This sample tests the @warning.deprecated decorator introduced in PEP 702.

# This should generate an error if reportDeprecated is enabled.
from .deprecated2 import func1

# This should generate an error if reportDeprecated is enabled.
from .deprecated2 import ClassA as A

from .deprecated2 import func2
from .deprecated2 import ClassC as C

func2("hi")

# This should generate an error if reportDeprecated is enabled.
func2(1)

# This should generate an error if reportDeprecated is enabled.
c1 = C.method1


c2 = C()
c2.method2()

# This should generate an error if reportDeprecated is enabled.
c2.method2(3)
