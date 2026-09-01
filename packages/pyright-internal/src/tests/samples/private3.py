# This sample tests that __all__ membership suppresses reportPrivateUsage
# for module-level single-underscore names.

__all__ = ["_exported_via_all", "Public"]


def _exported_via_all() -> int:
    return 1


def _not_exported() -> int:
    return 2


class Public:
    pass
