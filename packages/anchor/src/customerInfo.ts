import {z} from 'zod';
import type {AnchorInfo} from './stellarToml';
import type {SessionToken} from './webAuth';

/** The small, non-sensitive field catalogue used by the SEP-12 demo. */
export const customerInfoFieldSchema = z.object({
  description: z.string().optional(),
  optional: z.boolean().optional(),
  choices: z.array(z.string()).optional(),
});

export type CustomerInfoField = z.infer<typeof customerInfoFieldSchema>;

export const customerInfoStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['NEEDS_INFO', 'PROCESSING', 'ACCEPTED', 'REJECTED']),
  fields: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
});

export type CustomerInfoStatus = z.infer<typeof customerInfoStatusSchema>;

export class CustomerInfoError extends Error {
  override readonly name = 'CustomerInfoError';
  constructor(readonly code: 'KYC_UNSUPPORTED' | 'KYC_REQUEST_FAILED' | 'KYC_INVALID_RESPONSE', message: string) {
    super(message);
  }
}

export type CustomerInfoQuery = {
  anchor: AnchorInfo;
  session: SessionToken;
  /** Optional existing record id returned by the anchor. */
  customerId?: string;
  fetcher?: typeof fetch;
};

export type SubmitCustomerInfoInput = CustomerInfoQuery & {
  fields: Record<string, string>;
};

function customerUrl(anchor: AnchorInfo, account: string, customerId?: string): URL {
  if (!anchor.kycServer) {
    throw new CustomerInfoError('KYC_UNSUPPORTED', `${anchor.homeDomain} does not offer SEP-12 customer information`);
  }
  const url = new URL(`${anchor.kycServer.replace(/\/$/, '')}/customer`);
  url.searchParams.set('account', account);
  if (customerId) url.searchParams.set('id', customerId);
  return url;
}

async function readStatus(response: Response, anchor: AnchorInfo): Promise<CustomerInfoStatus> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CustomerInfoError('KYC_INVALID_RESPONSE', `${anchor.homeDomain} returned invalid SEP-12 JSON`);
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message
      : `${anchor.homeDomain} refused the SEP-12 request`;
    throw new CustomerInfoError('KYC_REQUEST_FAILED', message);
  }
  const parsed = customerInfoStatusSchema.safeParse(body);
  if (!parsed.success) {
    throw new CustomerInfoError('KYC_INVALID_RESPONSE', `${anchor.homeDomain} returned an unreadable SEP-12 status`);
  }
  return parsed.data;
}

/** Reads required/optional customer fields and the current KYC status. */
export async function getCustomerInfo(query: CustomerInfoQuery): Promise<CustomerInfoStatus> {
  const {anchor, session, fetcher = fetch} = query;
  const url = customerUrl(anchor, session.account, query.customerId);
  try {
    const response = await fetcher(url, {headers: {authorization: `Bearer ${session.token}`}});
    return await readStatus(response, anchor);
  } catch (error) {
    if (error instanceof CustomerInfoError) throw error;
    throw new CustomerInfoError('KYC_REQUEST_FAILED', `${anchor.homeDomain} could not report customer information`);
  }
}

/** Alias used by screens that only need the anchor's field catalogue. */
export async function getCustomerInfoFields(query: CustomerInfoQuery): Promise<{
  id: string;
  status: CustomerInfoStatus['status'];
  fields: Record<string, CustomerInfoField>;
}> {
  const status = await getCustomerInfo(query);
  const fields: Record<string, CustomerInfoField> = {};
  for (const [name, value] of Object.entries(status.fields ?? {})) {
    const parsed = customerInfoFieldSchema.safeParse(value);
    if (!parsed.success) {
      throw new CustomerInfoError('KYC_INVALID_RESPONSE', `${query.anchor.homeDomain} returned an invalid SEP-12 field`);
    }
    fields[name] = parsed.data;
  }
  return {id: status.id, status: status.status, fields};
}

/** Explicit status naming for callers that already have the record id. */
export const getCustomerInfoStatus = getCustomerInfo;

/** Sends the demo/customer fields without ever logging or persisting their values. */
export async function submitCustomerInfo(input: SubmitCustomerInfoInput): Promise<CustomerInfoStatus> {
  const {anchor, session, fetcher = fetch} = input;
  const url = customerUrl(anchor, session.account, input.customerId);
  try {
    const response = await fetcher(url, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${session.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({account: session.account, ...(input.customerId ? {id: input.customerId} : {}), ...input.fields}),
    });
    return await readStatus(response, anchor);
  } catch (error) {
    if (error instanceof CustomerInfoError) throw error;
    throw new CustomerInfoError('KYC_REQUEST_FAILED', `${anchor.homeDomain} could not accept customer information`);
  }
}

/**
 * A deterministic in-memory SEP-12 server for the hackathon walkthrough.
 * It stores only field names and status, never the submitted identity values.
 * It is intentionally a fetcher rather than a production anchor implementation.
 */
export function createMockSep12Anchor(options: {baseUrl?: string} = {}): {
  baseUrl: string;
  fetcher: typeof fetch;
  reset: () => void;
} {
  const baseUrl = (options.baseUrl ?? 'https://mock-anchor.example.test/sep12').replace(/\/$/, '');
  const records = new Map<string, {id: string; provided: Set<string>; status: CustomerInfoStatus['status']}>();
  const fields: Record<string, CustomerInfoField> = {
    first_name: {description: 'Given name', optional: false},
    last_name: {description: 'Family name', optional: false},
    email: {description: 'Contact email', optional: false},
    country: {description: 'Country of residence', optional: false, choices: ['TR', 'US', 'GB']},
  };
  const requiredFields = Object.keys(fields);

  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    if (!url.pathname.endsWith('/customer')) return response({message: 'Not found'}, 404);
    const authorization = init?.headers instanceof Headers
      ? init.headers.get('authorization')
      : new Headers(init?.headers).get('authorization');
    if (!authorization?.startsWith('Bearer ')) return response({message: 'Authorization required'}, 401);
    const account = url.searchParams.get('account') ?? (() => {
      try {
        const body = init?.body ? JSON.parse(String(init.body)) as {account?: string} : undefined;
        return body?.account ?? null;
      } catch {
        return null;
      }
    })();
    if (!account) return response({message: 'account is required'}, 400);
    let record = records.get(account);
    if (!record) {
      record = {id: `mock-${records.size + 1}`, provided: new Set(), status: 'NEEDS_INFO'};
      records.set(account, record);
    }
    const requestedId = url.searchParams.get('id');
    if (requestedId && requestedId !== record.id) return response({message: 'Unknown customer id'}, 404);

    if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        return response({message: 'invalid JSON'}, 400);
      }
      if (body.id !== undefined && body.id !== record.id) return response({message: 'Unknown customer id'}, 404);
      for (const field of requiredFields) {
        if (typeof body[field] === 'string' && body[field]!.trim()) record.provided.add(field);
      }
      record.status = requiredFields.every(field => record!.provided.has(field)) ? 'ACCEPTED' : 'NEEDS_INFO';
    }

    return response({
      id: record.id,
      status: record.status,
      fields: record.status === 'ACCEPTED' ? {} : fields,
    });
  }) as typeof fetch;

  return {baseUrl, fetcher, reset: () => records.clear()};
}
