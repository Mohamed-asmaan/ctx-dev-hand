package main

import (
	"database/sql"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

func main() {
	db, _ := sql.Open("postgres", "postgres://localhost/app?sslmode=disable")
	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		_ = db
		c.String(200, "ok")
	})
	_ = r.Run(":8080")
}
