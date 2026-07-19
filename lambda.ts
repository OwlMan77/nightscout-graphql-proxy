import { timingSafeEqual } from 'node:crypto';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';
import { createYogaInstance } from './src/server';

const yoga = createYogaInstance();

/** Constant-time string compare that won't throw on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * AWS Lambda handler fronted by an API Gateway v2 HTTP API. When `PROXY_API_KEY` is set,
 * requests must present a matching `x-api-key` header (constant-time compare);
 * if the env var is unset, auth is skipped and all requests pass through.
 * Otherwise it manually adapts the API Gateway v2 event into a WHATWG Request,
 * calls `yoga.fetch`, and maps the Response back to a Lambda result.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  lambdaContext: Context
): Promise<APIGatewayProxyResultV2> {
  const expectedKey = process.env.PROXY_API_KEY;
  if (expectedKey) {
    const provided = event.headers?.['x-api-key'] ?? event.headers?.['X-Api-Key'] ?? '';
    if (!provided || !safeEqual(provided, expectedKey)) {
      return {
        statusCode: 401,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ errors: [{ message: 'Unauthorized' }] }),
      };
    }
  }

  const url = new URL(
    event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : ''),
    `https://${event.requestContext.domainName}`
  );

  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body
    : undefined;

  const response = await yoga.fetch(
    url,
    {
      method: event.requestContext.http.method,
      headers: event.headers as HeadersInit,
      body,
    },
    { event, lambdaContext }
  );

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: await response.text(),
  };
}
