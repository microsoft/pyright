# This sample tests that __all__ membership suppresses reportPrivateUsage
# for module-level single-underscore names.

from .private3 import _exported_via_all, _not_exported

# This should NOT generate an error: _exported_via_all is listed in
# private3.__all__, so it is part of the module's public interface despite
# the leading underscore.
a = _exported_via_all()

# This should generate an error: _not_exported is not in __all__.
b = _not_exported()
