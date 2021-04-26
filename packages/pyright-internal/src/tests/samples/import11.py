# This sample tests that the type checker properly handles
# the "from .decoder import JSONDecodeError" statement in
# the json/__init__.pyi type stub file. According to PEP 484,
# this import statement should cause the json module to export
# not only the symbol JSONDecodeError but also the symbol
# "decoder".

import json

a = json.decoder.JSONDecodeError
b = json.JSONDecodeError
