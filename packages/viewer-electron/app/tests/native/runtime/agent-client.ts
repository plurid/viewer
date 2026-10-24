import net from 'node:net';

/** One bounded request to the owned application's authenticated local agent endpoint. */
export function requestAgent<T>(
  socketPath: string,
  token: string,
  request: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setEncoding('utf8');
    let buffer = '';
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error('Owned agent request timed out.')), 15_000);
    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (!settled) finish(new Error('Owned agent connection closed before its reply.'));
    });
    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: 'native-acceptance', token, request }) + '\n');
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 1024 * 1024)
        return finish(new Error('Owned agent reply exceeded its test limit.'));
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const reply = JSON.parse(buffer.slice(0, newline)) as { error?: string; value: T };
        finish(reply.error ? new Error(reply.error) : undefined, reply.value);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
