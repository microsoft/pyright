Motivation
==========

PEP 557 introduced the dataclass to the Python stdlib. Several popular
libraries (including attrs, pydantic, and various libraries that support
database ORMs such as django and edgedb) have behaviors that are similar
to dataclass, but these behaviors cannot be described using standard type
annotations.

To work around this limitation, mypy custom plugins have been developed for
many of these libraries, but these plugins don't work with other type
checkers, linters or language servers. They are also costly to maintain for
library authors, and they require that Python developers know about the
existence of these plugins and download and configure them within their
environment.

Most type checkers, linters and language servers have full support for
dataclass. This proposal aims to generalize this functionality and provide
a way for third-party libraries to indicate that certain decorator functions
or metaclasses provide behaviors similar to dataclass.

The desired behaviors include the following:
1. Optionally synthesizing an `__init__` method based on declared data fields.
2. Optionally synthesizing `__eq__` and `__ne__` methods.
3. Optionally synthesizing `__lt__`, `__le__`, `__gt__`, and `__ge__` methods.
4. Supporting "frozen" classes, a way to enforce immutability during static type
checking.
5. Supporting "field descriptors" that describe attributes of individual
fields that a static type checker must be aware of, such as whether a
default value is provided for the field.


Specification
=============

The `dataclass_transform` Decorator
-----------------------------------

This specification introduces a new decorator function exported from the
`typing` module named `dataclass_transform`. This decorator can be applied
to either a function (which is typically a decorator function itself) or a
class (which is intended to be used as a metaclass). The presence of
`dataclass_transform` tells a static type checker that the decorated function
or metaclass performs runtime "magic" that transforms a class, endowing it
dataclass-like behaviors.

If `dataclass_transform` is applied to a function, the use of this function
as a decorator will apply dataclass type semantics. If `dataclass_transform`
is applied to a class, dataclass type semantics will be assumed for any
class that uses the decorated class as a metaclass.

Here is an example of using `dataclass_transform` to decorate a decorator
function named `create_model`. We assume here that this function modifies
the class that it decorates in the following ways:
1. It synthesizes an `__init__` method using data fields declared within
the class and its parent classes.
2. It synthesizes an `__eq__` and `__ne__` method.

The implementation details of `create_model` are omitted for brevity.

```python
# The `create_model` decorator is defined by a library. This could be
# in a type stub or inline.
_T = TypeVar("_T")

@typing.dataclass_transform()
def create_model(cls: Type[_T]) -> Type[_T]:
    cls.__init__ = ...
    cls.__eq__ = ...
    cls.__ne__ = ...
    return cls
    

# The `create_model` decorator can now be used to create new model 
# classes, like this:
@create_model
class CustomerModel:
    id: int
    name: str
```

Here is an example of using `dataclass_transform` to decorate a metaclass.
We assume here that the `ModelMeta` class, when used as a metaclass, modifies
the classes that it creates in the following ways:
1. It synthesizes an `__init__` method using data fields declared within
the class and its parent classes.
2. It synthesizes an `__eq__` and `__ne__` method.
The implementation details of `ModelMeta` are omitted for brevity.

```python
# The `ModelMeta` metaclass and `ModelBase` class are defined by a library.
# This could be in a type stub or inline.
@typing.dataclass_transform()
class ModelMeta(type): ...

class ModelBase(metaclass=ModelMeta): ...


# The `ModelBase` class can now be used to create new model 
# subclasses, like this:
class CustomerModel(ModelBase):
    id: int
    name: str
```

In both of the above examples, the resulting `CustomerModel` class can now be
instantiated using the synthesized `__init__` method:

```python
# Using positional arguments
c1 = CustomerModel(327, "John Smith")

# Using keyword arguments
c2 = CustomerModel(id=327, name="John Smith")

# These will generate runtime errors and should likewise be flagged as
# errors by a static type checker.
c3 = CustomerModel()
c4 = CustomerModel(327, first_name="John")
c5 = CustomerModel(327, "John Smith", 0)
```

A decorator function or metaclass that provides dataclass-like functionality
may accept parameters that modify certain behaviors. This specification
defines the following parameters that static type checkers must honor if
they are used by a dataclass transform. Each of these parameters accepts a bool
argument, and it must be possible for the bool value (True or False) to be
statically evaluated.

`eq` is a parameter supported in the stdlib dataclass, and its meaning is
defined in PEP 557.

`order` is a parameter supported in the stdlib dataclass, and its meaning is
defined in PEP 557.

`frozen` is a parameter supported in the stdlib dataclass, and its meaning is
defined in PEP 557.

`kw_only` is a parameter supported by some dataclass-like libraries
(for example, attrs and pydantic) that controls whether the synthesized
`__init__` method uses keyword-only parameters or whether parameters
are positional.


Parameters to `dataclass_transform` allow for some basic customization of
default behaviors.

```python
_T = TypeVar("_T")

def dataclass_transform(
    *,
    eq_default: bool = True,
    order_default: bool = False,
    kw_only_default: bool = False,
    field_descriptors: Tuple[type, ...] = (()),
) -> Callable[[_T], _T]: ...
```

`eq_default` indicates whether the `eq` parameter is assumed to be True
or False if it is omitted by the caller. If not specified, it will default
to True (the default assumption for dataclass).

`order_default` indicates whether the `order` parameter is assumed to be
True or False if it is omitted by the caller. If not specified, it will default
to False (the default assumption for dataclass).

`kw_only_default` indicates whether the `kw_only` parameter is
assumed to be True or False if it is omitted by the caller. If not specified,
it will default to False (the default assumption for dataclass).

`field_descriptors` specifies a static list of supported classes that describe
fields. Some libraries also supply functions to allocate instances of field
descriptors, and those functions may also be specified in this tuple. If not
specified, it will default to an empty tuple (no field descriptors supported).
The standard dataclass behavior supports only one type of field descriptor
called `Field` plus a helper function (`field`) that instantiates this class,
so if we were describing the stdlib dataclass behavior, we would provide the
following tuple argument: `(dataclasses.Field, dataclasses.field)`.


Here are some additional examples that show how these parameters are used.

Example of using `dataclass_transform` to decorate a decorator function:
```python
# Indicate that the `create_model` function assumes keyword-only
# parameters for the synthesized `__init__` method unless it is invoked
# with `kw_only=False`. It always synthesizes order-related methods
# and provides no way to override this behavior.
@typing.dataclass_transform(kw_only_default=True, order_default=True)
def create_model(
    *,
    frozen: bool = False,
    kw_only: bool = True,
) -> Callable[[Type[_T]], Type[_T]]: ...


# Example of how this decorator would be used by code that imports
# from this library:
@create_model(frozen=True, kw_only=False)
class CustomerModel:
    id: int
    name: str
```

Example of using `dataclass_transform` to decorate a metaclass.
```python
# Indicate that classes that use this metaclass default to synthesizing
# comparison methods.
@typing.dataclass_transform(eq_default=True, order_default=True)
class ModelMeta(type):
    def __init_subclass__(
        cls,
        *,
        init: bool = True,
        frozen: bool = False,
        eq: bool = True,
        order: bool = True,
    ):
        ...

class ModelBase(metaclass=ModelMeta):
    ...


# Example of how this class would be used by code that imports
# from this library:
class CustomerModel(ModelBase, init=False, frozen=True, eq=False, order=False):
    id: int
    name: str
```



Field descriptors
-----------------

Most libraries that support dataclass-like semantics provide one or more
"field descriptor" types that allow a class definition to provide additional
metadata about each field in the class. This metadata can describe, for example,
default values or indicate whether the field should be included in the
synthesized `__init__` method.

Field descriptors can be omitted in cases where additional metadata is not
required.

```python
@dataclass
class Employee:
    # Field with no descriptor
    name: str

    # Field that uses field descriptor class instance
    age: Optional[int] = field(default=None, init=False)

    # Field with type annotation and simple initializer to
    # describe default value
    is_paid_hourly: bool = True

    # Not a field (but rather a class variable) because type annotation
    # is not provided.
    office_number = "unassigned"
```

Libraries that support dataclass-like semantics and support field descriptor
classes typically use common parameter names to construct these field
descriptors. This specification formalizes the names and meanings of the
parameters that must be understood for static type checkers. These standardized
parameters must be keyword-only parameters. Field descriptor classes are
allowed to use other parameters in their constructors, and those parameters
can be positional and may use other names.


`init` is an optional bool parameter that indicates whether the field should
be included in the synthesized `__init__` method. If unspecified, it defaults
to True. Field descriptor functions can use overloads that implicitly specify
the value of `init` using a literal bool value type (Literal[False] or
Literal[True]).


`default` is an optional parameter that provides the default value for the
field.

`default_factory` is an optional parameter that provides a runtime callback
that returns the default value for the field. If `default` and `default_value`
are both unspecified, the field is assumed to have no default value and must be
provided a value when the class is instantiated.

`alias` is an optional str parameter that provides an alternative name for
the field. This alternative name is used in the synthesized `__init__` method.



This example demonstrates 
```python
# Library code (within type stub or inline):
@overload
def model_field(
        *,
        default: Optional[Any] = ...,
        resolver: Callable[[], Any],
        init: Literal[False] = False,
    ) -> Any: ...

@overload
def model_field(
        *,
        default: Optional[Any] = ...,
        resolver: None = None,
        init: bool = True,
    ) -> Any: ...

@typing.dataclass_transform(kw_only_default=True, field_descriptors=(model_field, ))
def create_model(
    *,
    init: bool = True
) -> Callable[[Type[_T]], Type[_T]]: ...


# Code that imports this library:
@create_model(init=False)
class CustomerModel:
    id: int = ModelField(resolver=lambda : 0)
    name: str
```


Runtime Behavior
----------------

At runtime, the `dataclass_transform` decorator has no effect. It simply returns
a function that accepts a single argument and returns that argument as the
return value.

Here is its complete implementation.

```python
def dataclass_transform(
    *,
    eq_default: bool = True,
    order_default: bool = False,
    kw_only_default: bool = False,
    field_descriptors: Tuple[Union[type, Callable[..., Any]], ...] = (()),
) -> Callable[[_T], _T]:
    return lambda a: a
```


Dataclass Semantics
-------------------

The following dataclass semantics are implied when dataclass_transform is
specified.

Frozen classes cannot inherit from non-frozen classes. A class that
directly specifies a metaclass that has been decorated with
`dataclass_transform` will not be considered non-frozen. In the example

```python
@typing.dataclass_transform()
class ModelMeta(type): ...

# ModelBase is not considered either "frozen" or "non-frozen"
# because it directly specifies ModelMeta as its metaclass.
class ModelBase(metaclass=ModelMeta): ...

# Vehicle is considered non-frozen because it does not specify
# "frozen=True".
class Vehicle(ModelBase):
    name: str

# Car is a frozen class that derives from Vehicle, which is a
# non-frozen class, which is an error condition.
class Car(Vehicle, frozen=True):
    wheel_count: int
```

Field ordering and inheritance is assumed to follow the same rules specified
in PEP 557. This includes the effects of overrides (redefining a field
in a child class that has already been defined in a parent class).

PEP 557 indicates that all fields without default values must appear before
fields with default values. Although not explicitly stated in PEP 557, this
rule is ignored when `init=False`, and this specification likewise ignores
this requirement in this situation. Likewise, there is no need to enforce
this ordering when keyword-only parameters are used for `__init__`, so the
rule is not enforced if `kw_only` semantics are in effect.

As with dataclass, method synthesis is skipped if it would overwrite
a method that is explicitly declared within the class. For example, if a class
declares an `__init__` method explicitly, an `__init__` method will not be
synthesized for that class.


Alternate Form
--------------

To avoid delaying adoption of this proposal until after `dataclass_transform`
has been added to the `typing` module, type checkers may support an alternative
form `__dataclass_transform__`. This form can be defined locally without any
reliance on the `typing` or `typing_extensions` modules. It allows immediate
adoption of the specification by library authors. Type checkers that have
not yet adopted this specification will retain their current behavior.

To use this alternate form, library authors should include the following
declaration within their type stubs or source files.

```python
_T = TypeVar("_T")

def __dataclass_transform__(
    *,
    eq_default: bool = True,
    order_default: bool = False,
    kw_only_default: bool = False,
    field_descriptors: Tuple[Union[type, Callable[..., Any]], ...] = (()),
) -> Callable[[_T], _T]:
    # If used within a stub file, the following implementation can be
    # replaced with "...".
    return lambda a: a
```


Limitations
===========

Attrs
-----

The attrs library supports an "auto_attribs" parameter that indicates whether
class members decorated with PEP 526 variable annotations but with no assignment
should be treated as data fields. We considered supporting "auto_attribs" and
a corresponding "auto_attribs_default" parameter. We decided against this
because it is specific to attrs and appears to be a legacy behavior. Instead
of supporting this in the new standard, we recommend that the maintainers of
attrs move away from the legacy semantics and adopt "auto_attribs" behaviors
by default.

The attrs library also supports a concept called "converters", which we
propose not to support in this proposal. Converters can still be used, but
an explicit type annotation must be provided.

```python
@attr.s
class C:
    x: int = attr.ib(converter=int)
```

The attrs library also performs automatic aliasing of field names that start
with a single underscore. This proposal omits this behavior.

The attrs library determines the order of fields within a class hierarchy
based not on MRO but based on some other algorithm. It allows callers to
specify MRO behavior by specifying `collect_by_mro=True`. Dataclass field
order is based on MRO, and this proposal would not support the legacy attrs
ordering. This affects only cases of multiple inheritance and only when
`collect_by_mro=False`.

The attrs library supports a bool parameter `cmp` that is the equivalent of
setting `eq` and `order` to True. This is not supported in this proposal.
Attrs users should use the dataclass-standard parameter names.

The attrs library also supports a "kw_only" parameter for individual fields.
This is not currently supported in this spec, but it could be added in the
future if there was sufficient demand.

The attrs library also differs from stdlib dataclasses in how it handles
inherited fields that are redeclared in subclasses. The dataclass specification
preserves the original order, but attrs defines a new order based on subclasses.
Users of attrs who rely on this ordering will not see the correct order
of parameters in the synthesized `__init__` method.

The attrs library also differs from stdlib dataclasses in that it uses the
parameter name `factory` rather than `default_factory` in its `attr.ib` and
`attr.field` functions.


Django
------

Django does not support declaring fields using type annotations only, so
users of this mechanism would need to know that they should always supply
assigned values.

Furthermore, django applies additional logic for primary keys and foreign
keys. For example, it automatically adds an "id" field (and `__init__`
parameter) if there is no field designated as a primary key. This additional
logic is not accommodated with this proposal, so users of django would need
to explicitly declare the id field.

These limitations may make it impractical to use the dataclass_transform
mechanism with django.


Using Dataclass Transform In Existing Libraries
===============================================

Applying To Attrs
-----------------

This section explains which modifications need to be made to attrs to
incorporate support for this specification. This assumes recent versions of
attrs (I used 20.3.0).

Step 1: Open `attr/__init__.pyi` and paste the following function declaration
somewhere within the file:

```python
def __dataclass_transform__(
    *,
    eq_default: bool = True,
    order_default: bool = False,
    kw_only_default: bool = False,
    field_descriptors: Tuple[Union[type, Callable[..., Any]], ...] = (()),
) -> Callable[[_T], _T]: ...
```

Step 2: Within the same file, search for the definition of the `attrs` function.
It is an overloaded function with two overloads. Paste the following line
between `@overload` and `def attrs(`. Repeat this for each of the two overloads.

```python
@__dataclass_transform__(order_default=True, field_descriptors=(attrib, field))
```

Step 3: Within the same file, search for the definition of the `define`
function. Paste the following line between `@overload` and `def define(`. Repeat
this for each of the two overloads.

```python
@__dataclass_transform__(field_descriptors=(attrib, field))
```


Applying To Pydantic
--------------------

This section explains which modifications need to be made to pydantic to
incorporate support for this specification. This assumes recent versions of
pydantic (I used 1.8.1).

Step 1: Open `pydantic/main.py` and search for the class definition for
`ModelMetaclass`. Before this class definition, paste the following function
declaration:

```python
def __dataclass_transform__(
    *,
    eq_default: bool = True,
    order_default: bool = False,
    kw_only_default: bool = False,
    field_descriptors: Tuple[Union[type, Callable[..., Any]], ...] = (()),
) -> Callable[[_T], _T]:
    return lambda a: a
```

Step 2: Add the following decorator to the `ModelMetaclass` class definition:

```python
@__dataclass_transform__(kw_only_default=True, field_descriptors=(Field, FieldInfo))
```


Change History
==============

18-May-2021: Documented additional limitations for attrs (factory vs default_factory).

15-May-2021: Documented additional limitations for attrs and django.

29-Apr-2021: Clarified that fields with no type annotation are not included
in the synthesized `__init__` method.

24-Apr-2021: Fixed bugs in the spec relating to return types of decorators.
