import psycopg2


def connect():
    return psycopg2.connect("dbname=app")
