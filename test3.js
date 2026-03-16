const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/ayas/project/duitkau/duitkau.db');

db.all("SELECT ca.* FROM cash_advances ca", (err, rows) => {
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
