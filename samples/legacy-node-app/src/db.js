const { Client } = require("pg");

function connect() {
  return new Client();
}

module.exports = { connect };
