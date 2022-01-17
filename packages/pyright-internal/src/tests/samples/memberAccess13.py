# This sample tests a member access when the member is a class
# that inherits from Any.

from typing import Type
from unittest.mock import Mock


class MockProducer:
    produce: Type[Mock] = Mock


reveal_type(MockProducer.produce, expected_text="Type[Mock]")
reveal_type(MockProducer().produce, expected_text="Type[Mock]")


reveal_type(MockProducer.produce(), expected_text="Mock")
reveal_type(MockProducer().produce(), expected_text="Mock")
