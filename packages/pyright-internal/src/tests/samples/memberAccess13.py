# This sample tests a member access when the member is a class
# that inherits from Any.

from unittest.mock import Mock


class MockProducer:
    produce: type[Mock] = Mock


reveal_type(MockProducer.produce, expected_text="type[Mock]")
reveal_type(MockProducer().produce, expected_text="type[Mock]")


reveal_type(MockProducer.produce(), expected_text="Mock")
reveal_type(MockProducer().produce(), expected_text="Mock")
