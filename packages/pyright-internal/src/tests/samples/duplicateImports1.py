# This sample tests the duplicate import detection.

import sys

# This should generate an error because Any is duplicated
from typing import Any, Dict, Any

# This should generate an error because sys is duplicated
import sys


a: Dict[Any, Any]
b = sys.api_version
