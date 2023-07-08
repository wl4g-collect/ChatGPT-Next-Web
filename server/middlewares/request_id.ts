import { Request, Response, NextFunction } from 'express';
import onHeaders from 'on-headers';
import { v4 as uuidv4 } from 'uuid';
import { ServerResponse } from 'http';
const X_REQUEST_ID = "x-request-id";

const withRequestId = (reqId: string) => {
  return function addRequestId(this: ServerResponse) {
    // set if not set by end of request
    if (!this.getHeader(X_REQUEST_ID)) {
      this.setHeader(X_REQUEST_ID, reqId);
    }
  };
};

export default async function requestID(req: Request, res: Response, next: NextFunction) {
  const reqId = req.get(X_REQUEST_ID) || uuidv4().replace(/-/g, "");
  req.headers[X_REQUEST_ID] = reqId;
  next();
  onHeaders(res as ServerResponse, withRequestId(reqId));
}
