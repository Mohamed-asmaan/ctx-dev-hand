package db;

// Connection.java — legacy JDBC connection helper
// This file is a fixture for ctx acceptance tests.
//
// Copyright (c) example corp. All rights reserved.
//
// This class wraps raw JDBC and is tightly coupled to the
// PostgreSQL driver version declared in pom.xml.
//
// DO NOT upgrade the driver without running ctx check first.
//
import org.postgresql.Driver;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

public class Connection {

    static {
        try {
            DriverManager.registerDriver(new Driver());
        } catch (SQLException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public static java.sql.Connection get(String url, String user, String password) throws SQLException {
        return DriverManager.getConnection(url, user, password);
    }
}
