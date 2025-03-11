# This sample tests accesses to standard attributes of a module.

import datetime

reveal_type(datetime.__name__, expected_text="str")
reveal_type(datetime.__loader__, expected_text="Any")
reveal_type(datetime.__package__, expected_text="str | None")
reveal_type(datetime.__spec__, expected_text="Any")
reveal_type(datetime.__path__, expected_text="MutableSequence[str]")
reveal_type(datetime.__file__, expected_text="str")
reveal_type(datetime.__cached__, expected_text="str")
reveal_type(datetime.__dict__, expected_text="dict[str, Any]")
reveal_type(datetime.__annotations__, expected_text="dict[str, Any]")
reveal_type(datetime.__builtins__, expected_text="Any")
reveal_type(datetime.__doc__, expected_text="str | None")
