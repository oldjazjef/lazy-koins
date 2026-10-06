import type { NextFunction, Request, Response } from 'express';
import { DESKTOP_ACCESS_HEADER, requireAccessToken } from './bootstrap';

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
});
