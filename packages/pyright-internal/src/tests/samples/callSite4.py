# This sample tests that call-site return type inference is not suppressed
# when an unannotated factory performs isinstance narrowing on a
# parameter-derived local.


class Geometry:
    def geo_method(self) -> None: ...


class Document:
    def newfolder(self) -> None: ...

    def newschema(self) -> None: ...


class Container:
    def _newfeature(self, cls, **kwargs):
        feat = cls(**kwargs)
        # The isinstance narrowing below must not suppress call-site
        # return type inference for callers that pass a concrete class.
        if isinstance(feat, Geometry):
            pass
        return feat

    def newdocument(self, **kwargs):
        return self._newfeature(Document, **kwargs)


kml = Container()

# Direct call to the factory with a concrete class argument. The isinstance
# narrowing in the body must not suppress call-site return type inference, so
# the concrete Document arm (and thus its members) is preserved.
direct = kml._newfeature(Document)
reveal_type(direct, expected_text="<subclass of Document and Geometry> | Document")

# Nested factory call (newdocument -> _newfeature) forwarding **kwargs.
doc = kml.newdocument()
reveal_type(doc, expected_text="<subclass of Document and Geometry> | Document")

# Document-only members are available on both arms of the union.
doc.newfolder()
doc.newschema()


# --- Guard coverage: the call-site fall-through must be narrowly scoped. ---


class Factory:
    # Declared (annotated) return type that is itself partly unknown
    # (`list` == `list[Unknown]`). Even though the params are unannotated and a
    # call site is available, the declared return type must be preserved -- the
    # fall-through to call-site body inference must NOT replace it.
    def make(self, cls, **kwargs) -> list:
        return [cls(**kwargs)]

    # Unannotated function with a fully-known body. It has no cached partly-unknown
    # specialized return, so ordinary (pre-existing) call-site inference applies and
    # the fall-through gate is not the deciding factor -- included as a regression
    # anchor that the fall-through does not break simple factories.
    def constant(self, cls, **kwargs):
        return 42


factory = Factory()

# Guard: a declared (partly-unknown) return type is preserved, not re-inferred.
# If the `!declaredReturnType` conjunct were dropped, this would become "list[int]".
declared = factory.make(int)
reveal_type(declared, expected_text="list[Unknown]")

# Regression anchor: a simple unannotated factory still resolves at the call site.
known = factory.constant(int)
reveal_type(known, expected_text="Literal[42]")

# Guard: when the argument is not a concrete class, call-site inference cannot
# improve the result, so a partly-unknown union is preserved (no regression / crash).
cls_var: type = Document
weird = kml._newfeature(cls_var)
reveal_type(weird, expected_text="Geometry | Any")


# --- Regression: recursive isinstance-narrowing factories must not drop the
# call-site inferred type. Call-site refinement of a recursive factory comes back
# incomplete during the recursion; the cached specialized return type must be used
# as a fallback so caller-side `reveal_type` still resolves (rather than being
# silently suppressed because the type result is incomplete). ---


class Node:
    def child(self) -> None: ...


class Rec:
    # Self-recursive factory with a base case that returns the isinstance-narrowed
    # local.
    def build(self, cls, depth):
        feat = cls()
        if isinstance(feat, Geometry):
            pass
        if depth > 0:
            return self.build(cls, depth - 1)
        return feat


a = Rec().build(Node, 5)
reveal_type(a, expected_text="Unknown | Geometry")


class PingPong:
    # Mutually-recursive factory pair.
    def ping(self, cls, depth):
        feat = cls()
        if isinstance(feat, Geometry):
            pass
        if depth > 0:
            return self.pong(cls, depth - 1)
        return feat

    def pong(self, cls, depth):
        feat = cls()
        if isinstance(feat, Geometry):
            pass
        if depth > 0:
            return self.ping(cls, depth - 1)
        return feat


b = PingPong().ping(Node, 5)
reveal_type(b, expected_text="Unknown | Geometry | <subclass of Node and Geometry> | Node")
