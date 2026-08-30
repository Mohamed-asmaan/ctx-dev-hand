package db;

import java.sql.Connection;
import java.sql.DriverManager;
// A comment mentioning import org.postgresql should not be matched

import org.postgresql.Driver;
import static org.postgresql.util.PSQLException.getKnownCauses;
import org.postgresql.*;
import java.sql.SQLException;

public class Connection {
    public static java.sql.Connection get() throws SQLException {
        return DriverManager.getConnection("jdbc:postgresql://localhost/db");
    }
}
