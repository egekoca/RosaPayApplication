import {createMockSep12Anchor, getCustomerInfo, submitCustomerInfo} from '@rosapay/anchor';

const mock = createMockSep12Anchor();
const session = {
  token: 'demo-token',
  account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  homeDomain: 'mock-anchor.example.test',
  authProtocol: 'SEP-10' as const,
};
const anchor = {
  homeDomain: session.homeDomain,
  networkPassphrase: 'Test SDF Network ; September 2015',
  signingKey: session.account,
  kycServer: mock.baseUrl,
  currencies: [],
};

const before = await getCustomerInfo({anchor, session, fetcher: mock.fetcher});
console.log(JSON.stringify({step: 'fields', id: before.id, status: before.status, fields: Object.keys(before.fields ?? {})}));

const after = await submitCustomerInfo({
  anchor,
  session,
  customerId: before.id,
  fields: {first_name: 'Demo', last_name: 'Customer', email: 'demo@example.test', country: 'TR'},
  fetcher: mock.fetcher,
});
console.log(JSON.stringify({step: 'submitted', id: after.id, status: after.status}));
