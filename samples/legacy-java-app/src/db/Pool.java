package db;

// Pool.java — legacy JDBC connection pool
// This file is a fixture for ctx acceptance tests.
//
// Uses PGPoolingDataSource which was deprecated in PostgreSQL JDBC 42.x
// and removed in later versions. Keep the version pinned in pom.xml.
import org.postgresql.ds.PGPoolingDataSource;

import java.sql.Connection;
import java.sql.SQLException;

public class Pool {

    private static final PGPoolingDataSource source = new PGPoolingDataSource();

    static {
        source.setDataSourceName("main");
        source.setServerName("localhost");
        source.setDatabaseName("appdb");
        source.setUser("app");
        source.setPassword("secret");
        source.setMaxConnections(10);
    }

    public static Connection get() throws SQLException {
        return source.getConnection();
    }
}
