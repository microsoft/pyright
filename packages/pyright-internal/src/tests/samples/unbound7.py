# This sample tests that assignments in unreachable code still make
# a name local, matching CPython.

variable = "global"


def example_with_local():
    # This should generate an error because the later assignment makes
    # "variable" a local, so this read is unbound.
    return variable
    variable = "local"


def example_without_local():
    return variable


def outer():
    def inner():
        # This should not generate an error; the assignment below binds
        # "variable" in outer even though it is unreachable.
        nonlocal variable

    return
    variable = "local"


g_var = "global"


def example_with_unreachable_global():
    # This should not generate an error; the unreachable global directive makes
    # g_var global rather than local.
    return g_var
    global g_var
    g_var = "local"


def example_with_unreachable_nonlocal():
    n_var = "outer"

    def inner():
        # This should not generate an error; the unreachable nonlocal directive makes
        # n_var nonlocal rather than local.
        return n_var
        nonlocal n_var
        n_var = "local"


lambda_body_var = "global"


def example_with_unreachable_lambda_body():
    # This should not generate an error; the assignment expression belongs to the
    # lambda's scope rather than the enclosing function.
    return lambda_body_var
    _ = lambda: (lambda_body_var := "lambda")


lambda_default_var = "global"


def example_with_unreachable_lambda_default():
    # This should generate an error because the default value is evaluated in the
    # enclosing scope, making lambda_default_var a local.
    return lambda_default_var
    _ = lambda a=(lambda_default_var := "default"): a


func_default_var = "global"


def example_with_unreachable_func_default():
    # This should generate an error because parameter defaults are evaluated in the
    # enclosing scope, making func_default_var a local.
    return func_default_var

    def nested_func(a=(func_default_var := "default")):
        pass


func_decorator_var = "global"


def example_with_unreachable_func_decorator():
    # This should generate an error because decorators are evaluated in the enclosing
    # scope, making func_decorator_var a local.
    return func_decorator_var

    @(func_decorator_var := (lambda fn: fn))
    def nested_func():
        pass


class_base_var = "global"


def example_with_unreachable_class_base():
    # This should generate an error because class bases are evaluated in the enclosing
    # scope, making class_base_var a local.
    return class_base_var

    class NestedClass((class_base_var := object)):
        pass


class_decorator_var = "global"


def example_with_unreachable_class_decorator():
    # This should generate an error because class decorators are evaluated in the
    # enclosing scope, making class_decorator_var a local.
    return class_decorator_var

    @(class_decorator_var := (lambda cls: cls))
    class NestedClass:
        pass
