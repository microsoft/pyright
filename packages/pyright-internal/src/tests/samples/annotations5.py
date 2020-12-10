# This sample tests the handling of tuple expressions within a subscript
# when used with type annotations.

from typing import Dict, List


a: Dict[(str, str)] = {"hi": "there"}

b: List[(int,)] = [3, 4, 5]
