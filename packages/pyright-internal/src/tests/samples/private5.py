# This sample tests that single-underscore names remain private when __all__
# uses an unsupported (computed) form. The binder cannot determine the
# contents of __all__ here, so deferred resolution should still mark _name
# as private.

_base: list[str] = []
__all__ = _base + ["public"]


def _name() -> int:
    return 1


def public() -> int:
    return 2
