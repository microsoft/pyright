# This sample tests the type analyzer's handling of the built-in
# __import__ function.

# This should not generate a type error.
__path__ = __import__('pkgutil').extend_path(__path__, __name__)

