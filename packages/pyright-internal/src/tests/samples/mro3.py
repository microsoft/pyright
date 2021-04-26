# This sample tests a more complicated class hierarchy to ensure
# that the MRO calculation does not detect a conflict.


class Object:
    pass


class QualifiedObject(Object):
    pass


class DerivableObject(QualifiedObject):
    pass


class SubclassableObject(Object):
    pass


class InheritingObject(DerivableObject, SubclassableObject):
    pass


class Source(QualifiedObject, SubclassableObject):
    pass


class ObjectType(InheritingObject, Source):
    pass
