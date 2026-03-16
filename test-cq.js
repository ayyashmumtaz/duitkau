const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/ayas/project/duitkau/duitkau.db');

const caSelect = `
  SELECT ca.*,
    req.full_name  AS request_by_name,
    opn.full_name  AS open_by_name,
    cls.full_name  AS closed_by_name,
    crq.full_name  AS close_requested_by_name,
    pr.name        AS project_name
  FROM cash_advances ca
  LEFT JOIN users req ON ca.request_by = req.id
  LEFT JOIN users opn ON ca.open_by    = opn.id
  LEFT JOIN users cls ON ca.closed_by  = cls.id
  LEFT JOIN users crq ON ca.close_requested_by = crq.id
  LEFT JOIN projects pr ON ca.project_id = pr.id
`;

db.all(`${caSelect} ORDER BY ca.created_at DESC`, (err, rows) => {
  if (err) console.error(err);
  else console.log(rows.length);
});
