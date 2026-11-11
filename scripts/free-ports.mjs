// Free ports for the check scripts. Each script asks for the ports its
// servers and mocks need, instead of fixed numbers, so two runs at once (two
// clones, or two sessions' after-edit hooks) never take the same ports.
//   const [PORT, OR_PORT] = await freePorts(2);
// The operating system picks each port (listen on port 0, on every address,
// as server.js does); all n are held open together, so one call never
// returns the same port twice, then released for the script's own servers to take straight away.
import { createServer } from 'node:net';

export async function freePorts(n) {
  const servers = [];
  try {
    for (let i = 0; i < n; i++) {
      const s = createServer();
      servers.push(s);
      await new Promise((resolve, reject) => { s.once('error', reject); s.listen(0, resolve); });
    }
    return servers.map((s) => s.address().port);
  } finally {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  }
}
