import type { NextFunction, Request, Response } from 'express';
import {
  DESKTOP_ACCESS_HEADER,
  mcpBodyParser,
  requireAccessToken,
} from './bootstrap';

describe('mcpBodyParser', () => {
  // Regression: registering express.json() itself (named `jsonParser`) made Nest skip its own
  // global JSON parser, and every other route received an empty body.
  it('is not named like express.json, so Nest still registers the global parser', () => {
    expect(mcpBodyParser().name).not.toBe('jsonParser');
  });
});

function run(header: string | undefined): { status?: number; next: boolean } {
  const result: { status?: number; next: boolean } = { next: false };
  const request = {
    headers: header === undefined ? {} : { [DESKTOP_ACCESS_HEADER]: header },
  } as unknown as Request;
  const response = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    result.next = true;
  };
  requireAccessToken('s3cret-token')(request, response, next);
  return result;
}

describe('requireAccessToken (desktop)', () => {
  it('lets a request with the right token through', () => {
    expect(run('s3cret-token')).toEqual({ next: true });
  });

  it('answers 403 without the header, with a wrong or a longer token', () => {
    expect(run(undefined)).toEqual({ status: 403, next: false });
    expect(run('s3cret-tokem')).toEqual({ status: 403, next: false });
    expect(run('s3cret-token-and-more')).toEqual({ status: 403, next: false });
  });

  it('lets /api/mcp through with an MCP access token only (the route checks it itself)', () => {
    const pass = (url: string, authorization?: string) => {
      let passed = false;
      const response = {
        status: () => response,
        json: () => response,
      } as unknown as Response;
      requireAccessToken('s3cret-token')(
        {
          originalUrl: url,
          url,
          headers: authorization ? { authorization } : {},
        } as unknown as Request,
        response,
        () => {
          passed = true;
        },
      );
      return passed;
    };
    const pat = `Bearer lkmcp_${'y'.repeat(43)}`;
    expect(pass('/api/mcp', pat)).toBe(true);
    expect(pass('/api/mcp?x=1', pat)).toBe(true);
    expect(pass('/api/mcp')).toBe(false);
    expect(pass('/api/mcp', 'Bearer something-else')).toBe(false);
    expect(pass('/api/projects', pat)).toBe(false);
    expect(pass('/api/mcp/../projects', pat)).toBe(false);
  });
});
