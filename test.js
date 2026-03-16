const http = require('http');

const req = http.request('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  const cookie = res.headers['set-cookie'][0];
  
  http.get('http://localhost:3000/api/ca', {
    headers: { 'Cookie': cookie }
  }, (res2) => {
    let data = '';
    res2.on('data', chunk => data += chunk);
    res2.on('end', () => console.log(data));
  });
});
req.write(JSON.stringify({username: 'finance', password: 'finance123'}));
req.end();
