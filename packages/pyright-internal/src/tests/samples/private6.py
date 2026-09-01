# This sample tests that single-underscore names remain private when the
# defining module's __all__ uses an unsupported (computed) form.

from .private5 import _name, public

# This should generate an error: private5.__all__ is computed, so _name
# stays private.
a = _name()

b = public()
