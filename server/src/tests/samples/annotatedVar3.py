# This sample tests annotated types on local variables.

from typing import Optional, Union

class ClassB(object):
    def __enter__(self) -> bytes:
        return b'hello'

def func2():
        local_var = 3 # type: Union[int, str]
        local_var = 'hello'

        # This should generate an error because the assigned
        # type doesn't match the declared type.
        local_var = b'hello'

        local_var2 = 3 # type: int

        if (local_var):
            # This should generate an error because the
            # assigned type doesn't match.
            local_var = 3.4
        else:
            # This should generate an error because the assigned
            # type doesn't match the declared type.
            local_var2 = b'hello'

        # This should generate an error because the declared type
        # of local_var is not compatible.
        with ClassB() as local_var:
            pass

        bytes_list = [b'hello']

        # This should generate an error because the declared type
        # of local_var is not compatible.
        for local_var in bytes_list:
            pass

        # This should generate an error.
        (local_var, local_var2) = (b'hello', 3)

        # This should generate an error.
        (local_var, local_var2) = ('hello', b'h')

