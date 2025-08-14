from _typeshed import Incomplete

from pony.orm.core import Database, Entity

db: Database

class Customer(Entity):
    id: Incomplete
    name: Incomplete
    email: Incomplete
    orders: Incomplete

class Order(Entity):
    id: Incomplete
    total_price: Incomplete
    customer: Incomplete
    items: Incomplete

class Product(Entity):
    id: Incomplete
    name: Incomplete
    price: Incomplete
    items: Incomplete

class OrderItem(Entity):
    quantity: Incomplete
    order: Incomplete
    product: Incomplete

def populate_database() -> None: ...
