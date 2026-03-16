const fetch = require('node-fetch'); // we can just use native fetch if node 18+, which we probably have.
async function test() {
  const cookie = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({username: 'finance', password: 'finance123'})
  }).then(r => r.headers.get('set-cookie'));
  const res = await fetch('http://localhost:3000/api/ca', {
    headers: { 'cookie': cookie }
  });
  console.log(await res.text());
}
test();
