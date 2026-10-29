/**
 * A local stand-in for a model in documentation captures: it speaks the chat completions protocol
 * of a local endpoint and answers each request with `answer`, from the request's instructions and
 * input. Captures show real Viewer behaviour around fixed, truthful answers about the sample.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface DemoModel {
  endpoint: string;
  close(): Promise<void>;
}

export async function demoModel(
  answer: (instructions: string, input: unknown) => unknown,
): Promise<DemoModel> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions'))
          throw new Error('Unsupported route');
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          messages: { role: string; content: string }[];
        };
        const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
        const user = body.messages.find((message) => message.role === 'user')?.content ?? 'null';
        const content = JSON.stringify(answer(system, JSON.parse(user)));
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }),
        );
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
