from _typeshed import Incomplete

from pony.orm.core import Database, Entity

db: Database

class Person(Entity):
    id: Incomplete
    name: Incomplete
    dob: Incomplete
    ssn: Incomplete

class Student(Person):
    group: Incomplete
    mentor: Incomplete
    attend_courses: Incomplete

class Teacher(Person):
    teach_courses: Incomplete
    apprentices: Incomplete
    salary: Incomplete

class Assistant(Student, Teacher): ...

class Professor(Teacher):
    position: Incomplete

class Group(Entity):
    number: Incomplete
    students: Incomplete

class Course(Entity):
    name: Incomplete
    semester: Incomplete
    students: Incomplete
    teachers: Incomplete

def populate_database() -> None: ...
def show_all_persons() -> None: ...
